'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {checkNodeVersion}=require('./preflight-node');
const {verifyClosedCommsP2PRules}=require('./comms-p2p-legacy-rules');
const usage='node scripts/reconcile-comms-p2p-legacy.js --project=<id> --out=<absolute-new-file> [--mode=inventory|cutover|prepare|apply|status] [--cutover-id=<uuid>] [--manifest=<absolute-file>] [--expected-rules-sha256=<sha256>] [--require-clean]';
function args(values){
  const result={mode:'inventory',requireClean:false},seen=new Set();
  for(const value of values){
    if(value==='--require-clean'){if(seen.has(value))throw Error();seen.add(value);result.requireClean=true;continue;}
    const at=value.indexOf('='),name=value.slice(0,at),item=value.slice(at+1);
    if(at<0||!['--project','--out','--mode','--cutover-id','--manifest','--expected-rules-sha256'].includes(name)||!item||seen.has(name))throw Error();
    seen.add(name);result[name.slice(2)]=item;
  }
  if(!/^[a-z][a-z0-9-]{5,29}$/.test(result.project??'')||!path.isAbsolute(result.out??'')||
    !['inventory','cutover','prepare','apply','status'].includes(result.mode)||result.requireClean&&result.mode!=='inventory'||
    ['cutover','prepare'].includes(result.mode)&&!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(result['cutover-id']??'')||
    ['apply','status'].includes(result.mode)&&!path.isAbsolute(result.manifest??'')||
    ['cutover','prepare','apply'].includes(result.mode)&&!/^[a-f0-9]{64}$/.test(result['expected-rules-sha256']??'')||
    result.mode==='inventory'&&['cutover-id','manifest','expected-rules-sha256'].some(key=>result[key])||
    result.mode==='cutover'&&result.manifest||result.mode==='prepare'&&result.manifest||
    ['apply','status'].includes(result.mode)&&result['cutover-id'])throw Error();
  return result;
}
async function main(values=process.argv.slice(2)){
  if(values.includes('--help')){process.stdout.write(usage+'\n');return;}
  let input;try{checkNodeVersion();input=args(values);
    if(process.env.FIRESTORE_EMULATOR_HOST||process.env.STORAGE_EMULATOR_HOST||process.env.FIREBASE_STORAGE_EMULATOR_HOST)throw Error();
    if(fs.existsSync(input.out))throw Error();
  }catch{process.stderr.write('Contexto inválido; nenhum acesso foi feito. '+usage+'\n');process.exitCode=2;return;}
  const api=require('../functions/lib/commsP2PLegacy');
  if(['cutover','apply'].includes(input.mode)&&!api.COMMS_P2P_LEGACY_RECONCILIATION_ENABLED){process.stderr.write('Reconciliação bloqueada pelo gate de lançamento. Nenhum acesso foi feito.\n');process.exitCode=2;return;}
  let manifest=null;
  if(input.manifest){
    const stat=fs.lstatSync(input.manifest);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4_000_000)throw Error();
    manifest=JSON.parse(fs.readFileSync(input.manifest,'utf8').replace(/^\uFEFF/,''));
    if(manifest?.v!==1||manifest.projectId!==input.project||manifest.mode!=='prepared-plans'||!Array.isArray(manifest.plans)||manifest.plans.length>1000)throw Error();
    const parse=require('../functions/lib/commsP2PLegacyContract').parseCommsP2PLegacyPlan;
    manifest.plans=manifest.plans.map(parse);if(manifest.plans.some(plan=>plan.projectId!==input.project))throw Error();
  }
  const admin=require('../functions/node_modules/firebase-admin'),{GoogleAuth}=require('../functions/node_modules/google-auth-library');
  const app=admin.initializeApp({projectId:input.project},'comms-p2p-legacy-ops'),db=app.firestore();
  try{
    const auth=new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform.read-only','https://www.googleapis.com/auth/firebase']});
    const client=await auth.getClient();
    const project=(await client.request({url:`https://cloudresourcemanager.googleapis.com/v3/projects/${input.project}`,params:{fields:'name,projectId,state'},timeout:20000,retry:false})).data;
    if(project.projectId!==input.project||project.state!=='ACTIVE'||!/^projects\/[0-9]+$/.test(project.name))throw Error();
    const source=['cutover','prepare','apply'].includes(input.mode)?fs.readFileSync(path.resolve(__dirname,'../firestore.rules'),'utf8'):null;
    const deps={projectId:input.project,firestore:db,verifyRules:()=>verifyClosedCommsP2PRules(client,input.project,source,input['expected-rules-sha256'])};
    const base={v:1,projectId:input.project,databaseId:'(default)',generatedAt:new Date().toISOString(),bindingVerified:true};let result;
    if(input.mode==='cutover'){
      result={...base,mode:'cutover-record',...await api.recordCommsP2PLegacyCutover(input['cutover-id'],deps),productionMutations:'cutover-marker-only'};
    }else if(['apply','status'].includes(input.mode)){
      const outcomes=[];for(const plan of manifest.plans)outcomes.push(input.mode==='status'?await api.getCommsP2PLegacyPlanStatus(plan,deps):await api.applyCommsP2PLegacyPlan(plan,deps));
      result={...base,mode:input.mode,plans:outcomes,productionMutations:input.mode==='status'?0:'reviewed-plan-reconciliation'};
    }else{
      const totals={},plans=[];let complete=true;
      for(const source of['rooms','callerCandidates','calleeCandidates']){
        let afterPath=null,exhausted=false;totals[source]={scanned:0,kinds:{}};
        for(let page=0;page<1000;page++){
          const data=await api.inventoryCommsP2PLegacyPage({source,afterPath,limit:50},deps);totals[source].scanned+=data.scanned;
          for(const row of data.rows){totals[source].kinds[row.kind]=(totals[source].kinds[row.kind]??0)+1;
            if(input.mode==='prepare'&&(source==='rooms'&&row.kind==='legacy'||row.kind==='orphan')){
              if(plans.length>=1000)throw Error();plans.push(await api.prepareCommsP2PLegacyPlan({projectId:input.project,planId:randomUUID(),cutoverId:input['cutover-id'],kind:source==='rooms'?'room':'orphan',path:row.path},deps));
            }
          }
          if(data.exhausted){exhausted=true;break;}if(!data.nextAfterPath||data.nextAfterPath===afterPath)throw Error();afterPath=data.nextAfterPath;
        }
        if(!exhausted)complete=false;
      }
      const clean=complete&&!Object.entries(totals).some(([source,data])=>Object.entries(data.kinds).some(([kind,count])=>count>0&&!((source==='rooms'&&['modern','reconciled'].includes(kind))||(source!=='rooms'&&kind==='parent-modern'))));
      result={...base,mode:input.mode==='prepare'?'prepared-plans':'metadata-inventory',complete,clean,cleanScope:'known-legacy-signaling-metadata',totals,productionMutations:0,
        consistency:'Independent projected pages and current parent checks; v2 is identified by its declared version, with full v2 health checked separately. No global snapshot, SDP/ICE/labels or deletion authority from inventory.'};
      if(input.mode==='prepare')result.plans=plans;
      if(!complete||input.requireClean&&!clean)process.exitCode=1;
    }
    fs.writeFileSync(input.out,JSON.stringify(result,null,2)+'\n',{encoding:'utf8',flag:'wx'});
    process.stdout.write(JSON.stringify({output:input.out,mode:result.mode,projectId:input.project,complete:result.complete,clean:result.clean,productionMutations:result.productionMutations})+'\n');
  }finally{await app.delete();}
}
module.exports={args};
if(require.main===module)main().catch(()=>{process.stderr.write('Reconciliação não concluída. Conserva o manifesto/IDs e consulta os recibos antes de repetir qualquer alteração.\n');process.exitCode=1;});
