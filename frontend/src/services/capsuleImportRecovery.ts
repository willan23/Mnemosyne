import {cognitiveEngine} from '../engines/CognitiveEngine';
import type {SessionData} from '../hooks/useSessions';
import {buildEncryptedMemoryFields} from './memoryCrypto';
import {semanticCandidateEligibility} from './semanticCandidateCapture';
import {withSemanticCandidateOperation} from './semanticCandidateOperations';
import {captureCapsuleItems,decodeCapsulePack,isCapsulePackText,CapsulePayloadError,CAPSULE_PACK_MAX_BYTES} from './capsuleService';
import {startCapturedCapsuleImport,type CapturedObsidianImport,type ObsidianImportRecoveryDeps} from './obsidianImportRecovery';
import {parseObsidianImportPlan,type ObsidianImportMemory} from '../../../functions/src/obsidianImportContract';
import {attachmentActorIdValid} from '../../../functions/src/attachmentEnvelope';

export interface CapsuleImportPayload{text:string;titleHint?:string|null;shareId?:string|null;ownerUid?:string|null}
export interface CapsuleImportBuildDeps{id:()=>string;encrypt:typeof buildEncryptedMemoryFields;process:typeof cognitiveEngine.processMemory}
const defaults:CapsuleImportBuildDeps={id:()=>crypto.randomUUID(),encrypt:buildEncryptedMemoryFields,process:(...args)=>cognitiveEngine.processMemory(...args)};
function capture(payload:CapsuleImportPayload){
  if(!payload||typeof payload.text!=='string'||new TextEncoder().encode(payload.text).byteLength>CAPSULE_PACK_MAX_BYTES||
    (payload.titleHint!=null&&(typeof payload.titleHint!=='string'||new TextEncoder().encode(payload.titleHint).byteLength>1000))||
    (payload.shareId!=null&&!attachmentActorIdValid(payload.shareId)))throw new CapsulePayloadError();
  const body=payload.text.trim();const pack=isCapsulePackText(body)?decodeCapsulePack(body):null;
  if(isCapsulePackText(body)&&!pack)throw new CapsulePayloadError();
  const items=pack?.items??captureCapsuleItems([{text:body}]);
  return{items:items.map(item=>({...item,title:item.title||payload.titleHint?.trim()||undefined,tags:[...(item.tags??[])]})),shareId:payload.shareId??null};
}
export async function buildCapsuleImportPlan(uid:string,payload:CapsuleImportPayload,sessions:readonly SessionData[],guard:()=>void=()=>{},deps:CapsuleImportBuildDeps=defaults):Promise<CapturedObsidianImport>{
  guard();const data=capture(payload);const importId=`capsule-${deps.id()}`;const ids=data.items.map(()=>deps.id());
  return withSemanticCandidateOperation(sessions,{assertCurrent:guard,eligible:semanticCandidateEligibility(uid)},async(working,semanticGuard)=>{const guard=semanticGuard;guard();const memories:ObsidianImportMemory[]=[];
  for(let index=0;index<data.items.length;index++){
    guard();const item=data.items[index];const title=item.title??null;const text=title&&!item.text.startsWith(title)?`${title}\n\n${item.text}`:item.text;
    let semantic:Awaited<ReturnType<typeof cognitiveEngine.processMemory>>|undefined;
    try{semantic=await deps.process(text,working.prefix(),{assertCurrent:semanticGuard});}
    catch{guard();console.warn('Não foi possível enriquecer a cápsula localmente.');}guard();
    const encrypted=await deps.encrypt(text,title);guard();
    memories.push({sessionId:ids[index],role:'note',enc:encrypted.enc,metadata:{
      tags:[...new Set(['auto-learned','capsule-import','text','capsula','importada',...(data.items.length>1?['pack']:[]),...item.tags])],
      category:'Cápsulas',connections:[],parentId:null,importance:semantic?.importance??0.5,celestialType:semantic?.celestialType??'planet',position:semantic?.position??[index*3,0,0],
      ...(semantic?.embedding?.length?{embedding:[...semantic.embedding],embeddingModel:semantic.embeddingModel??null}:{})}});
    await working.append({id:ids[index],uid,embedding:semantic?.embedding?[...semantic.embedding]:undefined,embeddingModel:semantic?.embeddingModel,
      position:semantic?.position?[...semantic.position]:[index*3,0,0],semanticClusterId:semantic?.semanticClusterId,celestialType:semantic?.celestialType??'planet'});
  }
  const plan=parseObsidianImportPlan({importId,source:'capsule-import',capsule:{shareId:data.shareId},memories,edges:[]});
  return{plan,result:{imported:memories.length,linked:0,unresolvedLinks:0,hubIds:[],memoryIds:ids,statsLabel:'Cápsula importada',skipped:0}};
  });
}
export async function importCapsuleRecoverably(uid:string,payload:CapsuleImportPayload,sessions:readonly SessionData[]=[],assertCurrent:()=>void=()=>{},deps?:ObsidianImportRecoveryDeps,buildDeps?:CapsuleImportBuildDeps){
  const captured=structuredClone(payload);capture(captured);assertCurrent();
  const result=await startCapturedCapsuleImport(uid,guard=>buildCapsuleImportPlan(uid,captured,sessions,guard,buildDeps),assertCurrent,deps);assertCurrent();
  return{id:result.memoryIds[0],processingMethod:'learned:capsule-import',importedCount:result.imported,memoryIds:result.memoryIds};
}
