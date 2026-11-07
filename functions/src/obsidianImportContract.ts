import {canonicalSyncState,parseSyncCipher,parseSyncMetadata,syncHashValid,syncIdValid,syncInteger,type SyncCipher} from './mobileSyncImportContract';
import {attachmentActorIdValid} from './attachmentEnvelope';
import {ENCRYPTED_IMPORT_MAX_MEMORIES} from './importLimits';

export const OBSIDIAN_CREATE_BATCH_SIZE=10;
export const OBSIDIAN_LINK_BATCH_SIZE=50;
export const OBSIDIAN_PLAN_MAX_BYTES=4_000_000;
export const OBSIDIAN_IMPORT_MAX_MEMORIES=ENCRYPTED_IMPORT_MAX_MEMORIES;
export interface ObsidianImportMemory {sessionId:string;role:'hub'|'note';enc:SyncCipher;metadata:Record<string,unknown>}
export interface ObsidianImportEdge {sourceId:string;targetId:string;kind:'parent'|'wikilink'}
export interface ObsidianImportPlan {importId:string;source:'obsidian-vault'|'starter-universe'|'capsule-import';memories:ObsidianImportMemory[];edges:ObsidianImportEdge[];capsule?:{shareId:string|null}}
export interface ObsidianImportIdentity {importId:string;planDigest:string}
export interface ObsidianImportBatch extends ObsidianImportIdentity {batchIndex:number;phase:'create'|'link';memories:ObsidianImportMemory[];edges:ObsidianImportEdge[]}
export interface ObsidianImportStatus extends ObsidianImportIdentity {status:'unknown'|'pending'|'complete'|'cancelled';nextBatch:number;createdCount:number;linkedCount:number;memoryCount:number;edgeCount:number}
const fail=()=>new Error('Invalid encrypted import');
function record(value:unknown,fields:string[]):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...fields].sort().join(','))throw fail();
  return value as Record<string,unknown>;
}
function memory(value:unknown):ObsidianImportMemory{
  const data=record(value,['sessionId','role','enc','metadata']);
  if(!syncIdValid(data.sessionId)||!['hub','note'].includes(String(data.role)))throw fail();
  if(!data.metadata||typeof data.metadata!=='object'||Array.isArray(data.metadata))throw fail();
  const metadata=data.metadata as Record<string,unknown>;
  const rest=Object.fromEntries(Object.entries(metadata).filter(([key])=>!['parentId','taxonomyLane','projectStatus'].includes(key)));
  const normalized=parseSyncMetadata(rest);
  if('connections' in normalized&&(!Array.isArray(normalized.connections)||normalized.connections.length))throw fail();
  if(metadata.parentId!=null&&!syncIdValid(metadata.parentId))throw fail();
  if(metadata.taxonomyLane!=null&&!['A','B','C','D','E'].includes(String(metadata.taxonomyLane)))throw fail();
  if(metadata.projectStatus!=null&&!['planned','active','done'].includes(String(metadata.projectStatus)))throw fail();
  return{sessionId:data.sessionId,role:data.role as ObsidianImportMemory['role'],enc:parseSyncCipher(data.enc),
    metadata:{...normalized,connections:[],parentId:metadata.parentId??null,taxonomyLane:metadata.taxonomyLane??null,projectStatus:metadata.projectStatus??null}};
}
function edge(value:unknown):ObsidianImportEdge{
  const data=record(value,['sourceId','targetId','kind']);
  if(!syncIdValid(data.sourceId)||!syncIdValid(data.targetId)||data.sourceId>=data.targetId||!['parent','wikilink'].includes(String(data.kind)))throw fail();
  return{sourceId:data.sourceId,targetId:data.targetId,kind:data.kind as ObsidianImportEdge['kind']};
}
export function parseObsidianImportIdentity(value:unknown):ObsidianImportIdentity{
  const data=record(value,['importId','planDigest']);if(!syncIdValid(data.importId)||!syncHashValid(data.planDigest))throw fail();
  return{importId:data.importId,planDigest:data.planDigest};
}
export function parseObsidianImportPlan(value:unknown):ObsidianImportPlan{
  const capsuleSource=Boolean(value&&typeof value==='object'&&(value as Record<string,unknown>).source==='capsule-import');
  const data=record(value,['importId','source','memories','edges',...(capsuleSource?['capsule']:[])]);
  let capsule:ObsidianImportPlan['capsule'];
  if(capsuleSource){const context=record(data.capsule,['shareId']);if(context.shareId!==null&&!attachmentActorIdValid(context.shareId))throw fail();capsule={shareId:context.shareId as string|null};}
  if(!syncIdValid(data.importId)||!['obsidian-vault','starter-universe','capsule-import'].includes(String(data.source))||!Array.isArray(data.memories)||!data.memories.length||data.memories.length>OBSIDIAN_IMPORT_MAX_MEMORIES||!Array.isArray(data.edges)||data.edges.length>11_325)throw fail();
  const memories=data.memories.map(memory);const edges=data.edges.map(edge);const ids=new Map(memories.map(item=>[item.sessionId,item]));
  const notes=memories.filter(item=>item.role==='note').length;
  if(capsuleSource&&(notes!==memories.length||edges.length||memories.some(item=>item.metadata.parentId!==null)))throw fail();
  if(ids.size!==memories.length||notes<1||notes>150||memories.length-notes>150||memories.some(item=>item.role==='hub'&&(item.metadata.parentId!==null||!memories.some(child=>child.role==='note'&&child.metadata.parentId===item.sessionId))))throw fail();
  const pairs=new Set<string>();
  for(const item of edges){
    const source=ids.get(item.sourceId);const target=ids.get(item.targetId);const key=JSON.stringify([item.sourceId,item.targetId]);
    if(!source||!target||pairs.has(key))throw fail();pairs.add(key);
    if(item.kind==='wikilink'&&(source.role!=='note'||target.role!=='note'))throw fail();
    if(item.kind==='parent'&&!((source.metadata.parentId===target.sessionId&&target.role==='hub')||(target.metadata.parentId===source.sessionId&&source.role==='hub')))throw fail();
  }
  for(const item of memories){
    const parent=item.metadata.parentId;if(parent===null)continue;
    if(typeof parent!=='string'||ids.get(parent)?.role!=='hub'||!pairs.has(JSON.stringify([item.sessionId,parent].sort())))throw fail();
  }
  const result={importId:data.importId,source:data.source as ObsidianImportPlan['source'],memories,edges,...(capsule?{capsule}:{})};
  if(new TextEncoder().encode(JSON.stringify(result)).byteLength>OBSIDIAN_PLAN_MAX_BYTES)throw fail();return result;
}
export function obsidianPlanBatches(plan:ObsidianImportPlan):Array<Omit<ObsidianImportBatch,'importId'|'planDigest'>>{
  const batches:Array<Omit<ObsidianImportBatch,'importId'|'planDigest'>>=[];
  for(let index=0;index<plan.memories.length;index+=OBSIDIAN_CREATE_BATCH_SIZE)batches.push({batchIndex:batches.length,phase:'create',memories:plan.memories.slice(index,index+OBSIDIAN_CREATE_BATCH_SIZE),edges:[]});
  for(let index=0;index<plan.edges.length;index+=OBSIDIAN_LINK_BATCH_SIZE)batches.push({batchIndex:batches.length,phase:'link',memories:[],edges:plan.edges.slice(index,index+OBSIDIAN_LINK_BATCH_SIZE)});
  return batches;
}
export function parseObsidianImportBatch(value:unknown):ObsidianImportBatch{
  const data=record(value,['importId','planDigest','batchIndex','phase','memories','edges']);const identity=parseObsidianImportIdentity({importId:data.importId,planDigest:data.planDigest});
  if(!syncInteger(data.batchIndex)||data.batchIndex>256||!['create','link'].includes(String(data.phase))||!Array.isArray(data.memories)||!Array.isArray(data.edges))throw fail();
  if(data.phase==='create'?(data.memories.length<1||data.memories.length>OBSIDIAN_CREATE_BATCH_SIZE||data.edges.length!==0):(data.edges.length<1||data.edges.length>OBSIDIAN_LINK_BATCH_SIZE||data.memories.length!==0))throw fail();
  const result={...identity,batchIndex:data.batchIndex,phase:data.phase as ObsidianImportBatch['phase'],memories:data.memories.map(memory),edges:data.edges.map(edge)};
  if(new Set(result.memories.map(item=>item.sessionId)).size!==result.memories.length||new Set(result.edges.map(item=>JSON.stringify([item.sourceId,item.targetId]))).size!==result.edges.length)throw fail();
  if(new TextEncoder().encode(JSON.stringify(result)).byteLength>OBSIDIAN_PLAN_MAX_BYTES)throw fail();return result;
}
export const obsidianPlanBytes=(plan:ObsidianImportPlan)=>canonicalSyncState(parseObsidianImportPlan(plan));
export const obsidianBatchBytes=(batch:Pick<ObsidianImportBatch,'batchIndex'|'phase'|'memories'|'edges'>)=>canonicalSyncState({batchIndex:batch.batchIndex,phase:batch.phase,memories:batch.memories,edges:batch.edges});
