import {onAuthStateChanged} from 'firebase/auth';
import {doc,getDocFromServer} from 'firebase/firestore';
import {auth,db} from '../firebase';
import {encryptMemoryFields,decryptMemoryEnvelope,isEncryptedMemoryEnvelope,isMemoryCryptoReady,onMemoryCryptoChanged} from './memoryCrypto';
import {getTeamKeyCacheGeneration} from './teamVault';
import {parseTeam,type TeamRecord} from './teamsService';
import {withClipCaptureLock} from './clipCaptureService';
import {cognitiveDraftStore,type CognitiveDraftStore,type StoredCognitiveDraft} from './cognitiveDraftStore';
import {attachmentActorIdValid,attachmentIdValid} from '../../../functions/src/attachmentEnvelope';
import {parseAiGenerationScope,type AiGenerationScope} from '../../../functions/src/aiCostPolicy';
import {parsePersonalRevisionBaseline,type PersonalRevisionBaseline} from '../../../functions/src/personalRevisionContract';
import {parseTeamRevisionBaseline,type TeamRevisionBaseline} from '../../../functions/src/teamRevisionContract';
import type {GeneratedImageResult} from './aiGenerationService';

export interface DraftGeneration{id:string;uid:string;teamId?:string;personalRevisionBaseline?:PersonalRevisionBaseline;personalRevisionUnavailable?:true;teamRevisionBaseline?:TeamRevisionBaseline;teamRevisionUnavailable?:true}
export interface CognitiveDraft{v:1;uid:string;scope:AiGenerationScope;text:string;generation:DraftGeneration|null;image:GeneratedImageResult|null;imagePrompt:string}
export interface CognitiveDraftSnapshot{draft:CognitiveDraft|null;raw:string|null}
export interface CognitiveDraftDeps{
  store:CognitiveDraftStore;uid:()=>string|null;ready:()=>boolean;generation:()=>number;subscribe:(changed:()=>void)=>()=>void;
  team:(id:string)=>Promise<TeamRecord|null>;encrypt:typeof encryptMemoryFields;decrypt:typeof decryptMemoryEnvelope;
  id:()=>string;exclusive:<T>(key:string,work:()=>Promise<T>)=>Promise<T>;
}
export class CognitiveDraftError extends Error{
  readonly committedRaw?:string|null;
  constructor(committedRaw?:string|null){super('Não foi possível confirmar o rascunho cifrado. O registo local foi conservado.');this.committedRaw=committedRaw;}
}
const fail=()=>new CognitiveDraftError(),size=(text:string)=>new TextEncoder().encode(text).byteLength;
const defaults=():CognitiveDraftDeps=>({store:cognitiveDraftStore,uid:()=>auth.currentUser?.uid??null,ready:isMemoryCryptoReady,generation:getTeamKeyCacheGeneration,
  subscribe:changed=>{const uid=auth.currentUser?.uid;const a=onAuthStateChanged(auth,user=>{if(user?.uid!==uid)changed();}),v=onMemoryCryptoChanged(changed);return()=>{a();v();};},
  team:async id=>parseTeam(id,(await getDocFromServer(doc(db,'teams',id))).data()??{}),encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,id:()=>crypto.randomUUID(),exclusive:withClipCaptureLock});
function object(value:unknown,required:string[],optional:string[]=[]):asserts value is Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||required.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>![...required,...optional].includes(key)))throw fail();
}
export function parseCognitiveDraft(value:unknown,uid:string):CognitiveDraft{
  object(value,['v','uid','scope','text','generation','image','imagePrompt']);const scope=parseAiGenerationScope(value.scope);
  if(value.v!==1||value.uid!==uid||!attachmentActorIdValid(uid)||value.scope===undefined||!scope||typeof value.text!=='string'||size(value.text)>500_000||typeof value.imagePrompt!=='string'||size(value.imagePrompt)>100_000)throw fail();
  let generation:DraftGeneration|null=null;
  if(value.generation!==null){const item=value.generation;object(item,['id','uid'],['teamId','personalRevisionBaseline','personalRevisionUnavailable','teamRevisionBaseline','teamRevisionUnavailable']);
    if(typeof item.id!=='string'||!item.id||item.id.length>160||item.id.includes('/')||item.uid!==uid||
      (scope.kind==='team'?item.teamId!==scope.teamId:item.teamId!==undefined)||item.personalRevisionUnavailable!==undefined&&item.personalRevisionUnavailable!==true||item.teamRevisionUnavailable!==undefined&&item.teamRevisionUnavailable!==true)throw fail();
    generation={id:item.id,uid,...(scope.kind==='team'?{teamId:scope.teamId}:{})};
    if(item.personalRevisionBaseline!==undefined){if(scope.kind!=='personal'||item.personalRevisionUnavailable)throw fail();const baseline=parsePersonalRevisionBaseline(item.personalRevisionBaseline);if(baseline.sessionId!==item.id)throw fail();generation.personalRevisionBaseline=baseline;}
    if(item.personalRevisionUnavailable){if(scope.kind!=='personal')throw fail();generation.personalRevisionUnavailable=true;}
    if(item.teamRevisionBaseline!==undefined){if(scope.kind!=='team'||item.teamRevisionUnavailable)throw fail();const baseline=parseTeamRevisionBaseline(item.teamRevisionBaseline);if(baseline.sessionId!==item.id||baseline.teamId!==scope.teamId||baseline.keyEpoch!==scope.keyEpoch||baseline.keyId!==scope.keyId)throw fail();generation.teamRevisionBaseline=baseline;}
    if(item.teamRevisionUnavailable){if(scope.kind!=='team')throw fail();generation.teamRevisionUnavailable=true;}
    if(scope.kind==='team'&&!generation.teamRevisionBaseline)generation.teamRevisionUnavailable=true;
    if(scope.kind==='personal'&&!generation.personalRevisionBaseline&&!generation.personalRevisionUnavailable)throw fail();
  }
  let image:GeneratedImageResult|null=null;
  if(value.image!==null){const item=value.image;object(item,['mediaType','provider'],['dataUrl','imageBase64','model','revisedPrompt','warning']);
    if(!['image/png','image/jpeg','image/webp'].includes(item.mediaType as string)||typeof item.provider!=='string'||!item.provider||item.provider.length>100)throw fail();
    for(const name of ['model','revisedPrompt','warning'])if(item[name]!==undefined&&(typeof item[name]!=='string'||size(item[name] as string)>100_000))throw fail();
    const prefix=`data:${item.mediaType};base64,`,base64=typeof item.dataUrl==='string'&&item.dataUrl.startsWith(prefix)?item.dataUrl.slice(prefix.length):item.imageBase64;
    if(typeof base64!=='string'||!base64||base64.length>32_000_000||base64.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)||
      item.dataUrl!==undefined&&item.dataUrl!==prefix+base64||item.imageBase64!==undefined&&item.imageBase64!==base64)throw fail();
    const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    if(base64.endsWith('==')&&alphabet.indexOf(base64.at(-3)!)%16!==0||!base64.endsWith('==')&&base64.endsWith('=')&&alphabet.indexOf(base64.at(-2)!)%4!==0)throw fail();
    image={mediaType:item.mediaType as string,provider:item.provider,dataUrl:prefix+base64,
      ...(item.model!==undefined?{model:item.model as string}:{}),...(item.revisedPrompt!==undefined?{revisedPrompt:item.revisedPrompt as string}:{}),...(item.warning!==undefined?{warning:item.warning as string}:{})};
  }
  return{v:1,uid,scope:{...scope},text:value.text,generation,image,imagePrompt:value.imagePrompt};
}
function stored(value:unknown,uid:string):StoredCognitiveDraft{
  object(value,['v','uid','revision','enc']);if(value.v!==1||value.uid!==uid||!attachmentIdValid(value.revision)||!isEncryptedMemoryEnvelope(value.enc))throw fail();
  object(value.enc,['v','iv','ct']);if(value.enc.ct.length>46_000_000)throw fail();return value as unknown as StoredCognitiveDraft;
}
async function access(uid:string,scope:AiGenerationScope,deps:CognitiveDraftDeps,guard:()=>void){
  guard();if(scope.kind==='personal')return;
  const team=await deps.team(scope.teamId);guard();
  if(!team||!team.memberUids.includes(uid)||!team.memberUids.includes(team.ownerUid)||!team.wrappedKeys[uid]||team.keyRotationStatus!=='active'||team.pendingRotationId||team.activeKeyEpoch!==scope.keyEpoch||team.activeKeyId!==scope.keyId)throw fail();
}
async function context<T>(uid:string,deps:CognitiveDraftDeps,outer:()=>void,work:(guard:()=>void)=>Promise<T>){
  if(!attachmentActorIdValid(uid))throw fail();const generation=deps.generation();let changed=false;const stop=deps.subscribe(()=>{changed=true;});
  // Cache eviction changes the generation. Making a key available does not change draft access.
  const guard=()=>{outer();if(changed||deps.uid()!==uid||!deps.ready()||deps.generation()!==generation)throw fail();};
  try{guard();return await deps.exclusive(`mnemosyne:cognitive-draft:v1:${encodeURIComponent(uid)}`,()=>work(guard));}finally{stop();}
}
/** The legacy global plaintext key is never imported or assigned to the current user. */
export async function loadCognitiveDraft(uid:string,outer:()=>void=()=>{},deps=defaults()):Promise<CognitiveDraftSnapshot>{
  return context(uid,deps,outer,async guard=>{
    const record=await deps.store.get(uid);guard();if(record===undefined)return{draft:null,raw:null};const parsed=stored(record,uid),raw=JSON.stringify(parsed);
    const text=(await deps.decrypt(parsed.enc)).text;guard();if(size(text)>34_000_000)throw fail();const draft=parseCognitiveDraft(JSON.parse(text),uid);
    await access(uid,draft.scope,deps,guard);guard();if(JSON.stringify(await deps.store.get(uid))!==raw)throw fail();guard();return{draft,raw};
  });
}
/** Encrypt before atomic compare/exchange; a different tab or failed read never permits blind replacement. */
export async function saveCognitiveDraft(uid:string,input:CognitiveDraft,expected:string|null,outer:()=>void=()=>{},deps=defaults()):Promise<string|null>{
  const draft=parseCognitiveDraft(input,uid);let committed=false;
  return context(uid,deps,()=>{if(!committed)outer();},async guard=>{
    guard();const empty=!draft.text.trim()&&!draft.generation&&!draft.image&&!draft.imagePrompt;
    if(empty){await deps.store.compareExchange(uid,expected,null,guard);committed=true;guard();return null;}
    await access(uid,draft.scope,deps,guard);guard();const enc=await deps.encrypt({text:JSON.stringify(draft)});guard();
    const record=stored({v:1,uid,revision:deps.id(),enc},uid),raw=JSON.stringify(record);await access(uid,draft.scope,deps,guard);guard();
    await deps.store.compareExchange(uid,expected,record,guard);committed=true;guard();
    let saved:StoredCognitiveDraft|undefined;try{saved=await deps.store.get(uid);}catch{guard();throw new CognitiveDraftError(raw);}
    guard();if(JSON.stringify(saved)!==raw)throw fail();return raw;
  });
}
/** Explicit discard may remove an unreadable own record; exact CAS still protects a concurrent replacement. */
export async function discardCognitiveDraft(uid:string,outer:()=>void=()=>{},deps=defaults()){
  return context(uid,deps,outer,async guard=>{const old=await deps.store.get(uid);guard();await deps.store.compareExchange(uid,old===undefined?null:JSON.stringify(old),null,guard);guard();});
}
