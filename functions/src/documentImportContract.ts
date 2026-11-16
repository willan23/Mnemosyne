import {attachmentIdValid} from './attachmentEnvelope';
import {parseMemoryCreationMetadata} from './attachedMemoryContract';
import {canonicalSyncState,parseSyncCipher,syncHashValid,syncInteger,type SyncCipher} from './mobileSyncImportContract';
export const DOCUMENT_CREATE_BATCH_SIZE=10;
export const DOCUMENT_LINK_BATCH_SIZE=50;
export const DOCUMENT_PLAN_MAX_BYTES=4_000_000;
export interface DocumentImportAttachment{id:string;headerDigest:string}
export interface DocumentImportMemory{sessionId:string;role:'hub'|'document';enc:SyncCipher;attachmentIds:string[];metadata:Record<string,unknown>}
export interface DocumentImportEdge{sourceId:string;targetId:string}
export interface DocumentImportPlan{importId:string;memories:DocumentImportMemory[];attachments:DocumentImportAttachment[];edges:DocumentImportEdge[]}
export interface DocumentImportIdentity{importId:string;planDigest:string}
export interface DocumentImportBatch extends DocumentImportIdentity{batchIndex:number;phase:'create'|'link';memories:DocumentImportMemory[];edges:DocumentImportEdge[]}
export interface DocumentImportStatus extends DocumentImportIdentity{status:'unknown'|'pending'|'complete'|'cancelled';nextBatch:number;createdCount:number;linkedCount:number;memoryCount:number;edgeCount:number}
const fail=()=>new Error('Invalid encrypted document import');
const record=(value:unknown,fields:string[])=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...fields].sort().join(','))throw fail();return value as Record<string,unknown>;};
function memory(value:unknown):DocumentImportMemory{
  const data=record(value,['sessionId','role','enc','attachmentIds','metadata']);
  if(!attachmentIdValid(data.sessionId)||!['hub','document'].includes(String(data.role))||!Array.isArray(data.attachmentIds)||data.attachmentIds.length>(data.role==='document'?1:20)||data.attachmentIds.some(id=>!attachmentIdValid(id))||new Set(data.attachmentIds).size!==data.attachmentIds.length)throw fail();
  const metadata=parseMemoryCreationMetadata(data.metadata,data.sessionId,null,data.attachmentIds.length);
  if(metadata.connections!=null&&(!Array.isArray(metadata.connections)||metadata.connections.length))throw fail();
  const learning=metadata.learning as Record<string,unknown>|undefined;
  if(!learning||learning.source!==(data.role==='hub'?'document-batch':'document-upload')||typeof learning.batchId!=='string')throw fail();
  const result={sessionId:data.sessionId,role:data.role as DocumentImportMemory['role'],enc:parseSyncCipher(data.enc),attachmentIds:[...data.attachmentIds as string[]].sort(),metadata:{...metadata,connections:[],parentId:metadata.parentId??null}};
  // Leave room for server descriptors/timestamps within the Firestore document limit.
  if(new TextEncoder().encode(JSON.stringify(result)).byteLength>900_000)throw fail();return result;
}
function edge(value:unknown):DocumentImportEdge{
  const data=record(value,['sourceId','targetId']);if(!attachmentIdValid(data.sourceId)||!attachmentIdValid(data.targetId)||data.sourceId>=data.targetId)throw fail();return{sourceId:data.sourceId,targetId:data.targetId};
}
export function parseDocumentImportIdentity(value:unknown):DocumentImportIdentity{
  const data=record(value,['importId','planDigest']);if(!attachmentIdValid(data.importId)||!syncHashValid(data.planDigest))throw fail();return{importId:data.importId,planDigest:data.planDigest};
}
export function parseDocumentImportPlan(value:unknown):DocumentImportPlan{
  const data=record(value,['importId','memories','attachments','edges']);
  if(!attachmentIdValid(data.importId)||!Array.isArray(data.memories)||data.memories.length<2||data.memories.length>340||!Array.isArray(data.attachments)||data.attachments.length>20||!Array.isArray(data.edges)||data.edges.length>339)throw fail();
  const memories=data.memories.map(memory);const edges=data.edges.map(edge);const attachments=data.attachments.map(item=>{const ref=record(item,['id','headerDigest']);if(!attachmentIdValid(ref.id)||!syncHashValid(ref.headerDigest))throw fail();return{id:ref.id,headerDigest:ref.headerDigest};}).sort((a,b)=>a.id.localeCompare(b.id));
  const ids=new Map(memories.map(item=>[item.sessionId,item]));const documents=memories.filter(item=>item.role==='document');const hubs=memories.filter(item=>item.role==='hub');
  if(ids.size!==memories.length||documents.length<1||documents.length>20||hubs.length<1||hubs.length>320||new Set(attachments.map(item=>item.id)).size!==attachments.length||memories.some(item=>(item.metadata.learning as Record<string,unknown>).batchId!==data.importId))throw fail();
  const manifest=new Set(attachments.map(item=>item.id));const documentFiles=documents.flatMap(item=>item.attachmentIds);
  if(new Set(documentFiles).size!==documentFiles.length||documentFiles.length!==attachments.length||documentFiles.some(id=>!manifest.has(id)))throw fail();
  const ancestors=new Set<string>();const expected=new Set<string>();
  for(const item of memories){
    const parent=item.metadata.parentId;if(item.role==='document'&&parent===null)throw fail();if(parent!==null){if(typeof parent!=='string'||parent===item.sessionId||ids.get(parent)?.role!=='hub')throw fail();expected.add(JSON.stringify([item.sessionId,parent].sort()));}
    if(item.role==='hub'&&item.attachmentIds.some(id=>!documents.some(child=>child.metadata.parentId===item.sessionId&&child.attachmentIds.includes(id))))throw fail();
  }
  for(const item of documents){let parent=item.metadata.parentId;const seen=new Set<string>();while(parent!==null){if(typeof parent!=='string'||seen.has(parent)||seen.size>=16)throw fail();seen.add(parent);ancestors.add(parent);parent=ids.get(parent)!.metadata.parentId;}}
  if(hubs.some(item=>!ancestors.has(item.sessionId)))throw fail();
  const pairs=new Set(edges.map(item=>JSON.stringify([item.sourceId,item.targetId])));if(pairs.size!==edges.length||pairs.size!==expected.size||[...pairs].some(pair=>!expected.has(pair)))throw fail();
  const result={importId:data.importId,memories,attachments,edges};if(new TextEncoder().encode(JSON.stringify(result)).byteLength>DOCUMENT_PLAN_MAX_BYTES)throw fail();return result;
}
export function documentPlanBatches(plan:DocumentImportPlan):Array<Omit<DocumentImportBatch,'importId'|'planDigest'>>{
  const batches:Array<Omit<DocumentImportBatch,'importId'|'planDigest'>>=[];
  for(let i=0;i<plan.memories.length;i+=DOCUMENT_CREATE_BATCH_SIZE)batches.push({batchIndex:batches.length,phase:'create',memories:plan.memories.slice(i,i+DOCUMENT_CREATE_BATCH_SIZE),edges:[]});
  for(let i=0;i<plan.edges.length;i+=DOCUMENT_LINK_BATCH_SIZE)batches.push({batchIndex:batches.length,phase:'link',memories:[],edges:plan.edges.slice(i,i+DOCUMENT_LINK_BATCH_SIZE)});return batches;
}
export function parseDocumentImportBatch(value:unknown):DocumentImportBatch{
  const data=record(value,['importId','planDigest','batchIndex','phase','memories','edges']);const identity=parseDocumentImportIdentity({importId:data.importId,planDigest:data.planDigest});
  if(!syncInteger(data.batchIndex)||data.batchIndex>40||!['create','link'].includes(String(data.phase))||!Array.isArray(data.memories)||!Array.isArray(data.edges)||
    (data.phase==='create'?(data.memories.length<1||data.memories.length>DOCUMENT_CREATE_BATCH_SIZE||data.edges.length!==0):(data.memories.length!==0||data.edges.length<1||data.edges.length>DOCUMENT_LINK_BATCH_SIZE)))throw fail();
  const memories=data.memories.map(memory);const edges=data.edges.map(edge);if(new Set(memories.map(item=>item.sessionId)).size!==memories.length||new Set(edges.map(item=>JSON.stringify([item.sourceId,item.targetId]))).size!==edges.length||memories.some(item=>(item.metadata.learning as Record<string,unknown>).batchId!==identity.importId))throw fail();
  const result={...identity,batchIndex:data.batchIndex,phase:data.phase as DocumentImportBatch['phase'],memories,edges};if(new TextEncoder().encode(JSON.stringify(result)).byteLength>DOCUMENT_PLAN_MAX_BYTES)throw fail();return result;
}
export const documentPlanBytes=(plan:DocumentImportPlan)=>canonicalSyncState(parseDocumentImportPlan(plan));
export const documentBatchBytes=(batch:Pick<DocumentImportBatch,'batchIndex'|'phase'|'memories'|'edges'>)=>canonicalSyncState({batchIndex:batch.batchIndex,phase:batch.phase,memories:batch.memories,edges:batch.edges});
