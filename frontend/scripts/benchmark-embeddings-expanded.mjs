/** Offline synthetic retrieval evaluation, one fresh process per pinned model. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { dataset as developmentDataset } from './fixtures/retrieval-v2.mjs';
import { dataset as calibrationDataset } from './fixtures/retrieval-calibration-v1.mjs';
import { evaluateDataset, validateDataset, calibrateRetrievalFloor } from './retrieval-eval.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),script=fileURLToPath(import.meta.url);
const flags=process.argv.slice(2),outIndex=flags.indexOf('--out'),modelIndex=flags.indexOf('--model');
const out=outIndex>=0?flags[outIndex+1]:null,model=modelIndex>=0?flags[modelIndex+1]:null;
const datasetIndex=flags.indexOf('--dataset'),datasetName=datasetIndex>=0?flags[datasetIndex+1]:'development';
assert(['development','calibration'].includes(datasetName),'Unknown fixed synthetic dataset');
const dataset=datasetName==='calibration'?calibrationDataset:developmentDataset;
assert(out&&path.isAbsolute(out),'Use --out with a new absolute output path');
try{await stat(out);throw Error('output_already_exists');}catch(error){if(error.code!=='ENOENT')throw error;}
const profiles=JSON.parse(await readFile(path.join(root,'src/services/embeddingProfiles.json'),'utf8'));
validateDataset(dataset);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const datasetSha256=digest(JSON.stringify(dataset));
const sourcePaths=['scripts/benchmark-embeddings-expanded.mjs','scripts/retrieval-eval.mjs','scripts/fixtures/retrieval-v2.mjs','scripts/fixtures/retrieval-calibration-v1.mjs','src/utils/searchMemories.ts','src/services/searchVectorRanking.ts','src/services/memoryReadScope.ts','src/services/embeddingModel.ts','src/services/semanticConnectionBackfill.ts','../functions/src/semanticRelationsGraph.ts','../functions/src/sharedEmbeddingSpace.ts','src/services/embeddingProfiles.json'];
const sources=await Promise.all(sourcePaths.map(async relative=>{const file=path.resolve(root,relative),bytes=await readFile(file);return{path:file.split(String.fromCharCode(92)).join('/'),bytes:bytes.length,sha256:digest(bytes)};}));
const summarizeTimes=values=>{const sorted=[...values].sort((a,b)=>a-b);return{count:values.length,totalMs:values.reduce((a,b)=>a+b,0),medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],maxMs:sorted.at(-1)};};
async function inventory(folder){const rows=[];for(const entry of await readdir(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())rows.push(...await inventory(file));else{const bytes=await readFile(file);rows.push({file:path.relative(folder,file),bytes:bytes.length,sha256:digest(bytes)});}}return rows;}
if(!model){
  const results=[];
  for(const id of Object.keys(profiles)){
    const childOut=out+'.'+id+'.json';
    await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[script,'--out',childOut,'--model',id,'--dataset',datasetName],{cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,HF_HUB_OFFLINE:'1'}});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('model_evaluation_failed')));});
    results.push(JSON.parse(await readFile(childOut,'utf8')));
  }
  const assets=await readdir(path.join(root,'dist/assets'));
  const bundle=[];for(const name of assets.filter(name=>/^(embeddingWorker|incrementalSearchWorker|transformers)-.*\.js$/.test(name))){const bytes=await readFile(path.join(root,'dist/assets',name));bundle.push({name,bytes:bytes.length,sha256:digest(bytes)});}
  let totalBuiltJavascriptBytes=0,totalBuiltWasmBytes=0;
  for(const name of assets){if(name.endsWith('.js'))totalBuiltJavascriptBytes+=(await stat(path.join(root,'dist/assets',name))).size;else if(name.endsWith('.wasm'))totalBuiltWasmBytes+=(await stat(path.join(root,'dist/assets',name))).size;}
  assert(bundle.some(row=>row.name.startsWith('embeddingWorker-')));
  const report={v:2,complete:true,synthetic:true,datasetName,datasetSha256,sources,corpusSize:dataset.corpus.length,queryCount:dataset.questions.length,languages:dataset.languages,models:results,builtWorkerAndTransformerAssets:bundle,totalBuiltJavascriptBytes,totalBuiltWasmBytes,
    limits:{warmLocalCache:true,coldNetworkDownloadMeasured:false,serverOrFirebaseAuthTested:false,browserOrNativeRuntimeTested:false,fullVaultReindexLifecycleTested:false,generativeAnsweringTested:false,releaseQualityApproved:false},productionMutations:0,generativeProviderCalls:0,secretPayloadReads:0};
  await writeFile(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({complete:true,output:out,corpusSize:report.corpusSize,queryCount:report.queryCount,models:results.length}));
}else{
  assert(Object.hasOwn(profiles,model));
  for(const name of ['DEBUG','NODE_DEBUG','GOOGLE_SDK_NODE_LOGGING'])delete process.env[name];
  const nativeFetch=globalThis.fetch;let unexpectedNetwork=0;
  globalThis.fetch=async()=>{unexpectedNetwork++;throw Error('evaluation_network_prohibited');};
  let extractor,timer;const baselineRss=process.memoryUsage().rss;let peakRss=baselineRss;
  try{
    const {pipeline,env}=await import('@huggingface/transformers');
    const {build}=await import('esbuild');
    env.allowLocalModels=true;env.allowRemoteModels=false;env.useFSCache=true;
    const product=await build({stdin:{contents:"export {searchMemories,filterSearchCandidates,parseSearchQuery} from './src/utils/searchMemories.ts'; export {rankSearchVectors} from './src/services/searchVectorRanking.ts'; export {canReadCachedMemory} from './src/services/memoryReadScope.ts';",resolveDir:root,loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
    const code=product.outputFiles[0].text;assert(!/firebase-admin|firebase\/|process\.env|secretmanager/.test(code));
    const {searchMemories,filterSearchCandidates,parseSearchQuery,rankSearchVectors,canReadCachedMemory}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
    const profile=profiles[model],assetDir=path.join(root,'node_modules/@huggingface/transformers/.cache',profile.modelId,profile.revision);
    const assets=await inventory(assetDir);assert(assets.some(row=>row.file.endsWith('.onnx')));
    timer=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);},10);
    console.log(JSON.stringify({model,stage:'loading-local-pinned-model'}));
    const start=performance.now();extractor=await pipeline('feature-extraction',profile.modelId,{dtype:profile.dtype,revision:profile.revision,local_files_only:true});const loadMs=performance.now()-start;
    const space=`${profile.modelId}@${profile.revision}:${profile.dtype}:${profile.pooling}:norm`;
    const docTimes=[],queryTimes=[],corpusVectors=[],queryVectors=[];
    for(const [items,vectors,times] of [[dataset.corpus,corpusVectors,docTimes],[dataset.questions,queryVectors,queryTimes]]){
      for(const [index,row] of items.entries()){const text=items===dataset.questions?parseSearchQuery(row.text).text:row.text;const started=performance.now(),output=await extractor(text,{pooling:profile.pooling,normalize:profile.normalize}),vector=Array.from(output.data);
        times.push(performance.now()-started);assert.equal(vector.length,profile.dimensions);assert(vector.every(Number.isFinite));vectors.push(vector);peakRss=Math.max(peakRss,process.memoryUsage().rss);
        if((index+1)%32===0)console.log(JSON.stringify({model,stage:items===dataset.corpus?'corpus':'questions',completed:index+1,total:items.length}));
      }
    }
    const memories=dataset.corpus.map((row,index)=>({...row,embedding:corpusVectors[index],embeddingModel:space}));
    const scope={uid:'synthetic-alice',teamIds:new Set(['active'])},rankingTimes=[];
    const policy={memoryPermission:'never-cloud',toolAuthorization:'read-only'};const policyBefore=JSON.stringify(policy);
    const referenceNow=Date.parse('2026-10-01T00:00:00Z'),realNow=Date.now;let evaluation;
    let calibration;
    try{Date.now=()=>referenceNow;
      const runEvaluation=(questions,floor=.38)=>evaluateDataset({...dataset,questions},question=>{
        const started=performance.now(),index=dataset.questions.indexOf(question);
        const authorized=memories.filter(row=>canReadCachedMemory(row,scope));
        const candidates=filterSearchCandidates(authorized,question.text);
        assert(candidates.every(row=>!row.encLocked&&canReadCachedMemory(row,scope)));
        const scores=new Map(rankSearchVectors({candidates,query:queryVectors[index],embeddingModel:space,floor}));
        const ranked=searchMemories(candidates,question.text,{semanticScores:scores,limit:question.k,semanticFloor:floor});
        const currentScope={...scope,teamIds:new Set(scope.teamIds)};if(question.revokeTeamAfterRanking)currentScope.teamIds.delete(question.revokeTeamAfterRanking);
        const visible=ranked.filter(hit=>!hit.memory.encLocked&&canReadCachedMemory(hit.memory,currentScope));
        assert(visible.every(hit=>canReadCachedMemory(hit.memory,currentScope)));assert.equal(JSON.stringify(policy),policyBefore);
        rankingTimes.push(performance.now()-started);
        return{ids:visible.map(hit=>hit.memory.id),diagnostics:{eligible:candidates.length,returnedBeforeRevalidation:ranked.length,removedAfterRevocation:ranked.length-visible.length,untrustedDocumentsReturned:visible.filter(hit=>hit.memory.untrusted).length,hits:visible.map(hit=>({id:hit.memory.id,matchKind:hit.matchKind,score:hit.score,semanticScore:hit.memory.semanticScore??0}))}};
      });
      if(datasetName==='calibration'){
        const fitting=dataset.questions.filter(row=>row.split==='calibration');
        const decision=calibrateRetrievalFloor([.38,.4,.45,.5,.55,.6,.65,.7,.75,.8,.85,.9,.95,1],floor=>runEvaluation(fitting,floor).cases);
        const heldOut=runEvaluation(dataset.questions.filter(row=>row.split==='validation'),decision.selectedFloor??.38);
        calibration={...decision,baselineFloor:.38,heldOutFloor:decision.selectedFloor??.38,heldOut,evaluationOnly:true,productionThresholdApplied:false};
      }
      evaluation=runEvaluation(dataset.questions);
    }finally{Date.now=realNow;}
    assert.equal(unexpectedNetwork,0);
    const report={v:2,complete:true,model,profile,space,datasetName,datasetSha256,sources,corpusSize:dataset.corpus.length,queryCount:dataset.questions.length,runtime:process.version,freshProcess:true,offline:true,networkAttempts:unexpectedNetwork,productEvaluationBundleSha256:digest(code),modelCacheAssets:assets,modelCacheBytes:assets.reduce((sum,row)=>sum+row.bytes,0),loadMs,calibration,
      documentInference:summarizeTimes(docTimes),queryInference:summarizeTimes(queryTimes),productRanking:summarizeTimes(rankingTimes),memory:{baselineRssMiB:baselineRss/1024/1024,sampledPeakRssMiB:peakRss/1024/1024,sampledPeakIncreaseMiB:(peakRss-baselineRss)/1024/1024,samplingIntervalMs:10},evaluation,
      security:{syntheticScopeOnly:true,productAclHelperUsedBeforeAndAfter:true,lockedOrUnauthorizedExposed:0,externalRequests:0,providerOrToolExecution:0,policyMutationObserved:false,promptInjectionBoundary:'Retrieved text remains inert data; no generative model or tool execution tested'},qualityThresholdsEnforced:false,releaseReady:false};
    await writeFile(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({model,complete:true,overall:evaluation.overall,peakRssMiB:report.memory.sampledPeakRssMiB}));
  }finally{clearInterval(timer);if(extractor)await extractor.dispose();globalThis.fetch=nativeFetch;}
}
