import {collection,doc,documentId,getDocFromServer,getDocsFromServer,limit,orderBy,query,startAfter,where,type QueryConstraint} from 'firebase/firestore';
import {db} from '../firebase';
import {PERSONAL_REVISION_WRITES_ENABLED} from '../config/releaseGates';
import {decryptMemoryEnvelope,isEncryptedMemoryEnvelope} from './memoryCrypto';
import {applyMemoryEdit,captureMemoryEditBaseline,hasPendingMemoryEdit,memoryEditStateDigest} from './memoryEditRecovery';
import {withPersonalMemoryMutation,type PersonalMemoryMutationDeps} from './personalMemoryMutation';

type Row={id:string;data:Record<string,unknown>};
export interface IdentityResetProgress {removed:number;total:number}
export interface PersonalIdentityResetDeps {
  enabled:()=>boolean;
  page:(uid:string,after:string|null)=>Promise<Row[]>;
  read:(id:string)=>Promise<Record<string,unknown>|undefined>;
  pending:(uid:string)=>boolean;
  digest:typeof memoryEditStateDigest;
  decrypt:typeof decryptMemoryEnvelope;
  capture:typeof captureMemoryEditBaseline;
  remove:typeof applyMemoryEdit;
  pause:()=>Promise<void>;
  mutation?:PersonalMemoryMutationDeps;
}
const defaults=():PersonalIdentityResetDeps=>({
  enabled:()=>PERSONAL_REVISION_WRITES_ENABLED,
  page:async(uid,after)=>{
    const constraints:QueryConstraint[]=[where('uid','==',uid),where('teamId','==',null),orderBy(documentId()),limit(20)];
    if(after!==null)constraints.push(startAfter(after));
    return (await getDocsFromServer(query(collection(db,'sessions'),...constraints))).docs.map(row=>({id:row.id,data:row.data()}));
  },
  read:async id=>(await getDocFromServer(doc(db,'sessions',id))).data(),
  pending:hasPendingMemoryEdit,digest:memoryEditStateDigest,decrypt:decryptMemoryEnvelope,
  capture:captureMemoryEditBaseline,remove:applyMemoryEdit,pause:()=>new Promise(resolve=>setTimeout(resolve,1000)),
});
export class PersonalIdentityResetError extends Error {
  readonly removed:number;
  constructor(removed:number){
    super('A remoção foi interrompida. A chave atual foi conservada. Confirma os pedidos pendentes antes de voltar a tentar.');
    this.removed=removed;
  }
}
function owned(uid:string,row:Row){
  if(!row.id||row.id.includes('/')||new TextEncoder().encode(row.id).length>1500||row.data.uid!==uid||row.data.teamId!==null||row.data.teamScopeAmbiguous===true)throw Error('scope');
}
function follows(id:string,after:string){
  const next=new TextEncoder().encode(id),previous=new TextEncoder().encode(after);
  for(let i=0;i<Math.min(next.length,previous.length);i++)if(next[i]!==previous[i])return next[i]>previous[i];
  return next.length>previous.length;
}
/** Soft-remove only the reviewed, canonical personal set. Each document retains its own durable receipt/history. */
export async function removePersonalMemoriesForIdentityReset(input:{
  uid:string;assertCurrent:()=>void;confirm:(count:number)=>Promise<boolean>;progress?:(value:IdentityResetProgress)=>void;
},deps=defaults()):Promise<{status:'cancelled'|'completed';removed:number}> {
  let removed=0;
  try{
    if(!deps.enabled())throw Error('closed');
    return await withPersonalMemoryMutation(input.uid,async context=>{
      const guard=()=>{context.assertCurrent();input.assertCurrent();if(!deps.enabled())throw Error('closed');};
      guard();if(deps.pending(input.uid))throw Error('pending');
      const plan:Array<{id:string;digest:string}>=[];
      let scanned=0,bytes=0;
      const scan=async(visit:(row:Row)=>Promise<void>)=>{
        let after:string|null=null;
        for(;;){
          guard();const rows=await deps.page(input.uid,after);guard();
          if(rows.length>20)throw Error('page');
          for(const row of rows){
            owned(input.uid,row);
            if(after!==null&&!follows(row.id,after))throw Error('cursor');
            after=row.id;if(++scanned>10000)throw Error('limit');
            await visit(row);guard();
          }
          if(rows.length<20)return;
        }
      };
      await scan(async row=>{
        if(row.data.deletedAt!=null)return;
        if(['nodes','links','generatedPrompt','generatedImagePrompt'].some(key=>row.data[key]!=null))throw Error('unsupported');
        const digest=await deps.digest(row.data);guard();
        bytes+=new TextEncoder().encode(row.id).length+digest.length;
        if(bytes>8*1024*1024)throw Error('limit');
        plan.push({id:row.id,digest});
      });
      guard();const confirmed=await input.confirm(plan.length);guard();
      if(!confirmed)return{status:'cancelled',removed:0};
      input.progress?.({removed,total:plan.length});guard();
      for(const entry of plan){
        if(removed){await deps.pause();guard();}
        if(deps.pending(input.uid))throw Error('pending');
        const data=await deps.read(entry.id);guard();
        if(!data)throw Error('missing');owned(input.uid,{id:entry.id,data});
        if(data.deletedAt!=null||await deps.digest(data)!==entry.digest)throw Error('changed');guard();
        let fields:{text:string;title:string|null};
        if(data.enc==null){
          if(typeof data.text!=='string'||data.title!=null&&typeof data.title!=='string')throw Error('content');
          fields={text:data.text,title:data.title as string|null??null};
        }else{
          if(!isEncryptedMemoryEnvelope(data.enc)||data.text!==''||data.title!=null)throw Error('content');
          fields=await deps.decrypt(data.enc);guard();
        }
        const baseline=await deps.capture({uid:input.uid,id:entry.id,teamId:null,viewDigest:entry.digest,
          expected:{...fields,authorUid:input.uid},assertCurrent:guard});guard();
        const result=await deps.remove({uid:input.uid,id:entry.id,teamId:null,operation:'delete',baseline,assertCurrent:guard});guard();
        if(result.status!=='committed'||result.operation!=='delete'||result.sessionId!==entry.id||result.teamId!==null)throw Error('receipt');
        removed++;input.progress?.({removed,total:plan.length});guard();
      }
      // Newly created or changed records require another reviewed plan, never an automatic extra deletion.
      scanned=0;
      await scan(async row=>{if(row.data.deletedAt==null)throw Error('new-memory');});
      guard();if(deps.pending(input.uid))throw Error('pending');
      return{status:'completed',removed};
    },deps.mutation);
  }catch{throw new PersonalIdentityResetError(removed);}
}
