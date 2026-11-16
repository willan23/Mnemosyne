'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),http=require('node:http'),zlib=require('node:zlib');
const ts=require('typescript'),root=path.resolve(__dirname,'../..');
const source=fs.readFileSync(path.join(root,'packages/sdk/src/index.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const sdk=import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
async function localServer(handler,work){
  const server=http.createServer((req,res)=>{res.setHeader('connection','close');handler(req,res);});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try{return await work('http://127.0.0.1:'+server.address().port);}finally{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
}
test('public SDK satisfies its standalone strict TypeScript configuration',()=>{
  const result=spawnSync(process.execPath,[path.join(root,'functions/node_modules/typescript/bin/tsc'),'-p',path.join(root,'packages/sdk/tsconfig.json'),'--noEmit'],{cwd:root,encoding:'utf8',timeout:30000});assert(!result.error);assert.equal(result.status,0,result.stdout||result.stderr);
});
test('SDK credentials are absent from object enumeration and JSON serialization',async()=>{
  const {MnemosyneClient}=await sdk,key='synthetic-sdk-credential';const client=new MnemosyneClient({apiKey:key});assert.equal(Object.keys(client).includes('apiKey'),false);assert.equal(JSON.stringify(client).includes(key),false);
});
test('SDK rejects invalid deadline and byte budgets before any request',async()=>{
  const {MnemosyneClient}=await sdk;let calls=0;
  for(const config of [{timeoutMs:0},{timeoutMs:120001},{timeoutMs:Infinity},{maxResponseBytes:0},{maxResponseBytes:16777217},{maxResponseBytes:Infinity}])assert.throws(()=>new MnemosyneClient({apiKey:'synthetic-sdk-credential',...config,fetch:async()=>{calls++;return new Response('{}');}}));
  assert.equal(calls,0);
});
for(const baseUrl of ['http://remote.example/','https://user:synthetic@example.test/','https://example.test/?token=synthetic','https://example.test/#synthetic','https://example.test/prefix'])test('SDK rejects a credential-bearing or unexpected endpoint shape before network: '+new URL(baseUrl).protocol+' '+new URL(baseUrl).hostname+' '+new URL(baseUrl).pathname,async()=>{
  const {MnemosyneClient}=await sdk;let calls=0;assert.throws(()=>new MnemosyneClient({apiKey:'synthetic-sdk-credential',baseUrl,fetch:async()=>{calls++;return new Response('{}');}}));assert.equal(calls,0);
});
test('SDK requests omit ambient credentials, referrer and cache and refuse redirects',async()=>{
  const {MnemosyneClient}=await sdk;let seen;const client=new MnemosyneClient({apiKey:'synthetic-sdk-credential',fetch:async(input,init)=>{seen={input,init};return new Response('{"memories":[]}',{status:200});}});
  const result=await client.listMemories();assert.deepEqual(result,{memories:[]});assert.equal(seen.init.redirect,'error');assert.equal(seen.init.credentials,'omit');assert.equal(seen.init.referrerPolicy,'no-referrer');assert.equal(seen.init.cache,'no-store');assert.equal(new Headers(seen.init.headers).get('authorization')==='Bearer synthetic-sdk-credential',true);
});
test('a real same-origin 307 cannot forward the SDK Bearer to another route',async()=>{
  const {MnemosyneClient,MnemosyneTransportError}=await sdk;let forwarded=0;
  await localServer((req,res)=>{if(req.url==='/capture'){forwarded++;res.end('{"memories":[]}');}else{res.writeHead(307,{location:'/capture'});res.end();}},async baseUrl=>{
    const client=new MnemosyneClient({apiKey:'synthetic-sdk-credential',baseUrl});let error;try{await client.listMemories();}catch(e){error=e;}
    assert.equal(forwarded,0);assert.equal(error instanceof MnemosyneTransportError,true);
  });
});
test('the SDK deadline includes a stalled successful response body',async()=>{
  const {MnemosyneClient,MnemosyneTransportError}=await sdk;
  await localServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.write('{"memories":');const timer=setTimeout(()=>res.end('[]}'),120);res.once('close',()=>clearTimeout(timer));},async baseUrl=>{
    const client=new MnemosyneClient({apiKey:'synthetic-sdk-credential',baseUrl,timeoutMs:20});let error;try{await client.listMemories();}catch(e){error=e;}assert.equal(error instanceof MnemosyneTransportError,true);assert.equal(error.code,'deadline_exceeded');
  });
});
test('the SDK bounds decoded gzip response bytes',async()=>{
  const {MnemosyneClient,MnemosyneTransportError}=await sdk;const body=zlib.gzipSync(Buffer.from(JSON.stringify({data:'x'.repeat(4000)})));
  await localServer((req,res)=>{res.writeHead(200,{'content-type':'application/json','content-encoding':'gzip','content-length':body.length});res.end(body);},async baseUrl=>{
    const client=new MnemosyneClient({apiKey:'synthetic-sdk-credential',baseUrl,maxResponseBytes:1000});let error;try{await client.listMemories();}catch(e){error=e;}assert.equal(error instanceof MnemosyneTransportError,true);assert.equal(error.code,'response_too_large');
  });
});
test('HTTP errors retain status and discard arbitrary remote messages and bodies',async()=>{
  const {MnemosyneClient,MnemosyneApiError}=await sdk,marker='SYNTHETIC_PRIVATE_ERROR_CONTENT';const client=new MnemosyneClient({apiKey:'synthetic-sdk-credential',fetch:async()=>new Response(JSON.stringify({detail:marker,privateField:marker}),{status:401})});
  let error;try{await client.listMemories();}catch(e){error=e;}assert.equal(error instanceof MnemosyneApiError,true);assert.equal(error.status,401);assert.equal(error.message.includes(marker),false);assert.equal(error.body===null,true);assert.equal(JSON.stringify(error).includes(marker),false);
});
test('raw network exceptions and malformed JSON never escape the SDK',async()=>{
  const {MnemosyneClient,MnemosyneTransportError}=await sdk,marker='SYNTHETIC_PRIVATE_ERROR_CONTENT';
  for(const fetch of [async()=>{throw Error(marker);},async()=>new Response(marker,{status:200})]){
    const client=new MnemosyneClient({apiKey:'synthetic-sdk-credential',fetch});let error;try{await client.listMemories();}catch(e){error=e;}assert.equal(error instanceof MnemosyneTransportError,true);assert.equal(error.message.includes(marker),false);assert.equal(JSON.stringify(error).includes(marker),false);
  }
});
test('versioned vector searches preserve model space and explicit memory IDs',async()=>{
  const {MnemosyneClient}=await sdk;let request;const client=new MnemosyneClient({apiKey:'synthetic-sdk-credential',fetch:async input=>{request=new URL(input);return new Response('{"results":[]}');}});
  await client.search({embedding:[0.1,0.2],embeddingModel:'synthetic-model@v1',ids:['synthetic-id-a','synthetic-id-b']});assert.equal(request.searchParams.get('embeddingModel')==='synthetic-model@v1',true);assert.equal(request.searchParams.get('ids')==='synthetic-id-a,synthetic-id-b',true);
});

test('SDK direct creation is retired before the network and reviewed tools never expose approval',async()=>{const {MnemosyneClient}=await sdk;let calls=0;const client=new MnemosyneClient({apiKey:'synthetic-sdk-credential',fetch:async()=>{calls++;return new Response('{}');}});assert.throws(()=>client.createMemory({enc:{v:1,iv:'synthetic',ct:'synthetic'}}),/retired/);assert.throws(()=>client.createMemory({enc:{},text:'Synthetic private text'}),/plaintext/);assert.equal(calls,0);assert.equal('approveMemoryChange' in client,false);});
test('SDK sends one ciphertext proposal and polls only its exact receipt identity',async()=>{const {MnemosyneClient}=await sdk;const seen=[];const client=new MnemosyneClient({apiKey:'synthetic-review-credential',fetch:async(url,init)=>{seen.push({url,init});return new Response('{"status":"pending"}',{status:202});}});const target={sessionId:'note',teamId:null},proposal={operationId:'32345678-1234-4234-8234-123456789012',operation:'edit',baseline:target,priorEnc:{v:1,iv:'synthetic',ct:'synthetic'},enc:{v:1,iv:'synthetic',ct:'synthetic-next'},metadata:{tags:['synthetic']}},identity={proposalId:proposal.operationId,digest:'a'.repeat(64)};await client.prepareMemoryChange(target);await client.proposeMemoryChange(proposal);await client.getMemoryChange(identity);assert.deepEqual(seen.map(row=>new URL(row.url).pathname),['/api/v1/agent/changes/prepare','/api/v1/agent/changes/propose','/api/v1/agent/changes/status']);assert.deepEqual(seen.map(row=>JSON.parse(row.init.body)),[target,proposal,identity]);for(const bad of [{...proposal,confirmed:true},{...proposal,metadata:{text:'Synthetic plaintext'}},{...proposal,enc:{...proposal.enc,ct:'C'.repeat(700000)}}])assert.throws(()=>client.proposeMemoryChange(bad));assert.equal(seen.length,3);});
