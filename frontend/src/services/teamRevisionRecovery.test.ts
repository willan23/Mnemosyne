import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('../firebase',()=>({default:{},db:{},auth:{}}));
import {encryptMemoryFields,decryptMemoryEnvelope,setMemoryCryptoMnemonic,isMemoryCryptoReady} from './memoryCrypto';
import {encryptTeamMemoryFields,decryptTeamMemoryEnvelope,encryptLegacyTeamMemoryFields} from './teamVault';
import {captureTeamRevisionBaseline,reviseTeamLearnedMemory,recoverPendingTeamRevision,cancelPendingTeamRevision,teamRevisionCheckpointKey,type TeamRevisionDeps,type TeamRevisionBaseline} from './teamRevisionRecovery';
import {canonicalSyncState} from '../../../functions/src/mobileSyncImportContract';
import {teamRevisionRequestBytes,type TeamRevisionRequest} from '../../../functions/src/teamRevisionContract';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
const keyId='22222222-2222-4222-8222-222222222222',priorId='11111111-1111-4111-8111-111111111111';
const checkpoint=teamRevisionCheckpointKey('alice');
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const content={text:'Synthetic revised team note',title:'Synthetic revised title',embedding:[0.1,0.2],embeddingModel:'synthetic-local',semanticClusterId:null,position:[1,2,3] as [number,number,number],importance:0.6,processingMethod:'learned:revision+local-embedding'};
let uid:string,enabled:boolean,current:Record<string,unknown>|undefined,stamp:number,generation:number,baseline:TeamRevisionBaseline,deps:TeamRevisionDeps;
let teamKey:CryptoKey,oldKey:CryptoKey,receipt:Record<string,unknown>|undefined,archive:Record<string,unknown>|undefined,storage:Map<string,string>,listeners:Set<()=>void>,teamListeners:Set<()=>void>;
let loseApply:boolean,failStatus:boolean,failRemoval:boolean,revoked:boolean,modeChanged:(mode:string)=>void;
const prepare=vi.fn(),call=vi.fn(),id=vi.fn();
const input=()=>({uid:'alice',id:'note',teamId:'crew',baseline,prepare});
async function fresh():Promise<TeamRevisionBaseline>{return{sessionId:'note',teamId:'crew',authorUid:'author',ownerUid:'owner',stateHash:await hash(canonicalSyncState([current,stamp])),stateDigest:await hash(canonicalSyncState(current)),revision:Number(current?.updatedAt??current?.timestamp),teamStateHash:'c'.repeat(64),epochStateHash:'d'.repeat(64),keyEpoch:2,keyId,priorKeyEpoch:Number(current?.keyEpoch??1),priorKeyId:current?.keyId as string??null};}
beforeEach(async()=>{
  setMemoryCryptoMnemonic(words);uid='alice';enabled=true;stamp=1;generation=1;receipt=undefined;archive=undefined;storage=new Map();listeners=new Set();teamListeners=new Set();loseApply=false;failStatus=false;failRemoval=false;revoked=false;modeChanged=()=>{};
  teamKey=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);oldKey=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
  current={uid:'author',teamId:'crew',timestamp:1,updatedAt:10,keyEpoch:1,keyId:priorId,text:'',title:null,enc:await encryptTeamMemoryFields(oldKey,{text:'Synthetic previous team note',title:'Synthetic previous title'},{teamId:'crew',keyEpoch:1,keyId:priorId}),learning:{source:'text-generation'},attachments:[{synthetic:true}],connections:['peer']};
  id.mockReset();id.mockReturnValue('33333333-3333-4333-8333-333333333333');prepare.mockReset();prepare.mockResolvedValue(structuredClone(content));call.mockReset();
  call.mockImplementation(async(mode:string,command:{actorUid:string;request:unknown})=>{
    expect(command.actorUid).toBe('alice');modeChanged(mode);if(mode==='prepare')return fresh();const request=command.request as TeamRevisionRequest,digest=await hash(teamRevisionRequestBytes(request));
    const unknown={operationId:request.operationId,sessionId:'note',teamId:'crew',digest,status:'unknown',revision:null,createdAt:null};
    if(mode==='status'){if(failStatus)throw Error('Synthetic status failure');return receipt??{...unknown,status:revoked?'revoked':'unknown'};}
    if(receipt){if(receipt.digest!==digest)throw Error('Synthetic receipt mismatch');return receipt;}
    if(mode==='cancel'){receipt={...unknown,status:revoked?'revoked':'cancelled',createdAt:revoked?null:1000};return receipt;}
    expect(storage.has(checkpoint)).toBe(true);if(canonicalSyncState(await fresh())!==canonicalSyncState(request.baseline))throw Error('Synthetic conflict');
    archive={text:'',title:null,enc:structuredClone(request.priorEnc)};current={...current,text:'',title:null,enc:structuredClone(request.enc),...request.metadata,keyEpoch:2,keyId,updatedAt:1000};stamp++;
    receipt={...unknown,status:'committed',revision:1000,createdAt:1000};if(loseApply)throw Error('Synthetic lost acknowledgement');return receipt;
  });
  deps={enabled:()=>enabled,storage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>{storage.set(k,v);},removeItem:k=>{if(failRemoval)throw Error('Synthetic removal failure');storage.delete(k);}} as Storage,id,exclusive:async(_name,work)=>work(),read:async()=>structuredClone(current),key:async(_baseline,prior,guard)=>{guard();return prior?oldKey:teamKey;},encryptJournal:encryptMemoryFields,decryptJournal:decryptMemoryEnvelope,encryptContent:encryptTeamMemoryFields,decryptContent:decryptTeamMemoryEnvelope,call,generation:()=>generation,observe:(_uid,changed)=>{teamListeners.add(changed);return()=>{teamListeners.delete(changed);};},mutation:{uid:()=>uid,ready:isMemoryCryptoReady,subscribe:changed=>{listeners.add(changed);return()=>{listeners.delete(changed);};}}};
  baseline=await captureTeamRevisionBaseline({uid:'alice',id:'note',teamId:'crew',keyEpoch:2,keyId,expected:{text:'Synthetic previous team note',title:'Synthetic previous title',authorUid:'author'}},deps);call.mockClear();
});
afterEach(()=>{setMemoryCryptoMnemonic(null);expect(listeners.size).toBe(0);expect(teamListeners.size).toBe(0);});
it('seals before admission, preserves the old epoch and independently decrypts both versions',async()=>{
  const before=structuredClone(current);await reviseTeamLearnedMemory(input(),deps);
  expect(await decryptTeamMemoryEnvelope(teamKey,current!.enc as Parameters<typeof decryptTeamMemoryEnvelope>[1],{teamId:'crew',keyEpoch:2,keyId})).toEqual({text:content.text,title:content.title});
  expect(await decryptTeamMemoryEnvelope(oldKey,archive!.enc as Parameters<typeof decryptTeamMemoryEnvelope>[1],{teamId:'crew',keyEpoch:1,keyId:priorId})).toEqual({text:'Synthetic previous team note',title:'Synthetic previous title'});
  await expect(decryptTeamMemoryEnvelope(teamKey,current!.enc as Parameters<typeof decryptTeamMemoryEnvelope>[1],{teamId:'other',keyEpoch:2,keyId})).rejects.toThrow();
  expect(current!.uid).toBe('author');expect(current!.attachments).toEqual(before!.attachments);expect(storage.size).toBe(0);expect(call.mock.calls.map(c=>c[0])).toEqual(['prepare','status','apply','status']);expect(JSON.stringify(call.mock.calls)).not.toContain('Synthetic');
});
it.each(['metadata','revision','document-version','team-version','epoch-version'] as const)('captured baseline refuses changes before inference: %s',async mode=>{
  if(mode==='metadata')current!.attachments=[];if(mode==='revision')current!.updatedAt=11;if(mode==='document-version')stamp++;
  if(mode==='team-version'||mode==='epoch-version'){const rpc=deps.call;deps.call=async(type,command)=>{const result=await rpc(type,command);return type==='prepare'?{...result as object,[mode==='team-version'?'teamStateHash':'epochStateHash']:'e'.repeat(64)}:result;};}
  await expect(reviseTeamLearnedMemory(input(),deps)).rejects.toThrow('rascunho');expect(prepare).not.toHaveBeenCalled();expect(storage.size).toBe(0);
});
it('captures the baseline by value before waiting and never recaptures a changed displayed result',async()=>{
  const expected=structuredClone(baseline),read=deps.read;deps.read=async target=>{baseline.revision=999;return read(target);};await reviseTeamLearnedMemory(input(),deps);expect((call.mock.calls.find(c=>c[0]==='apply')![1].request as TeamRevisionRequest).baseline).toEqual(expected);
  await expect(captureTeamRevisionBaseline({uid:'alice',id:'note',teamId:'crew',keyEpoch:2,keyId,expected:{text:'Stale display',title:null}},deps)).rejects.toThrow();
});
it('recovers lost acknowledgement with writes closed and no new encryption or nonce',async()=>{
  loseApply=true;await expect(reviseTeamLearnedMemory(input(),deps)).rejects.toThrow('lost acknowledgement');const saved=receipt;enabled=false;current=undefined;prepare.mockClear();call.mockClear();
  expect(await recoverPendingTeamRevision('alice',()=>{},deps)).toEqual(saved);expect(call.mock.calls.map(c=>c[0])).toEqual(['status','status']);expect(prepare).not.toHaveBeenCalled();expect(id).toHaveBeenCalledOnce();expect(storage.size).toBe(0);
});
it('unknown pending requests refuse new inference and can be cancelled with writes closed',async()=>{
  failStatus=true;await expect(reviseTeamLearnedMemory(input(),deps)).rejects.toThrow();const raw=storage.get(checkpoint);prepare.mockClear();await expect(reviseTeamLearnedMemory(input(),deps)).rejects.toThrow();expect(prepare).not.toHaveBeenCalled();enabled=false;failStatus=false;
  await expect(recoverPendingTeamRevision('alice',()=>{},deps)).rejects.toThrow();expect(storage.get(checkpoint)).toBe(raw);expect((await cancelPendingTeamRevision('alice',()=>{},deps)).status).toBe('cancelled');expect(archive).toBeUndefined();expect(storage.size).toBe(0);
});
it('permanent revocation closes the own journal without content or new server references',async()=>{
  failStatus=true;await expect(reviseTeamLearnedMemory(input(),deps)).rejects.toThrow();storage.set(teamRevisionCheckpointKey('bob'),'Bob private checkpoint');failStatus=false;revoked=true;enabled=false;
  expect((await recoverPendingTeamRevision('alice',()=>{},deps)).status).toBe('revoked');expect(storage.has(checkpoint)).toBe(false);expect(storage.get(teamRevisionCheckpointKey('bob'))).toBe('Bob private checkpoint');expect(receipt).toBeUndefined();expect(archive).toBeUndefined();
});
it.each(['account','vault','team','outer','storage'] as const)('observed scope changes during preparation stay latched: %s',async mode=>{
  let active=true;prepare.mockImplementationOnce(async()=>{if(mode==='account'){uid='bob';for(const change of listeners)change();uid='alice';}if(mode==='vault'){setMemoryCryptoMnemonic(null);for(const change of listeners)change();setMemoryCryptoMnemonic(words);}if(mode==='team'){for(const change of teamListeners)change();}if(mode==='outer')active=false;if(mode==='storage')storage.set(checkpoint,'foreign replacement');return content;});
  await expect(reviseTeamLearnedMemory({...input(),assertCurrent:()=>{if(!active)throw Error('Synthetic changed view');}},deps)).rejects.toThrow();expect(receipt).toBeUndefined();expect(archive).toBeUndefined();expect(id).not.toHaveBeenCalled();
});
it('late admission after account change preserves the exact journal and refuses a success claim',async()=>{
  const rpc=deps.call;deps.call=async(mode,command)=>{const result=await rpc(mode,command);if(mode==='apply'){uid='bob';for(const change of listeners)change();}return result;};
  await expect(reviseTeamLearnedMemory(input(),deps)).rejects.toThrow();expect(receipt?.status).toBe('committed');expect(storage.has(checkpoint)).toBe(true);
});
it('terminal confirmation and removal failures retain the original encrypted request for recovery',async()=>{
  modeChanged=mode=>{if(mode==='apply')failStatus=true;};await expect(reviseTeamLearnedMemory(input(),deps)).rejects.toThrow();const raw=storage.get(checkpoint);failStatus=false;modeChanged=()=>{};failRemoval=true;
  await expect(recoverPendingTeamRevision('alice',()=>{},deps)).rejects.toThrow();expect(storage.get(checkpoint)).toBe(raw);failRemoval=false;await recoverPendingTeamRevision('alice',()=>{},deps);expect(storage.size).toBe(0);
});
it('damaged and wrong-owner journals remain encrypted and cannot reach RPC',async()=>{
  failStatus=true;await expect(reviseTeamLearnedMemory(input(),deps)).rejects.toThrow();const raw=storage.get(checkpoint)!;failStatus=false;call.mockClear();storage.set(checkpoint,raw.replace(/"ct":"./,'"ct":"!'));
  await expect(recoverPendingTeamRevision('alice',()=>{},deps)).rejects.toThrow();expect(call).not.toHaveBeenCalled();storage.set(checkpoint,JSON.stringify(await encryptMemoryFields({text:JSON.stringify({v:1,uid:'bob',request:JSON.parse((await decryptMemoryEnvelope(JSON.parse(raw))).text).request})})));
  await expect(recoverPendingTeamRevision('alice',()=>{},deps)).rejects.toThrow();expect(call).not.toHaveBeenCalled();
});
it('invalid receipt authority or a changed checkpoint is conserved without removal',async()=>{
  const rpc=deps.call;deps.call=async(mode,command)=>{const result=await rpc(mode,command);return mode==='status'?{...result as object,plaintext:'Synthetic leak'}:result;};await expect(reviseTeamLearnedMemory(input(),deps)).rejects.toThrow();expect(storage.has(checkpoint)).toBe(true);expect(receipt).toBeUndefined();
  deps.call=rpc;modeChanged=mode=>{if(mode==='status')storage.set(checkpoint,'foreign replacement');};await expect(recoverPendingTeamRevision('alice',()=>{},deps)).rejects.toThrow();expect(storage.get(checkpoint)).toBe('foreign replacement');
});
it('legacy ciphertext is archived unchanged and the revision uses the active epoch AAD',async()=>{
  current!.enc=await encryptLegacyTeamMemoryFields(oldKey,{text:'Synthetic legacy note',title:null});delete current!.keyId;baseline=await captureTeamRevisionBaseline({uid:'alice',id:'note',teamId:'crew',keyEpoch:2,keyId},deps);const before=structuredClone(current!.enc);await reviseTeamLearnedMemory(input(),deps);expect(archive!.enc).toEqual(before);expect(current!.keyEpoch).toBe(2);
});
it('closed writes and unavailable storage release all guards without inference or RPC',async()=>{
  enabled=false;await expect(reviseTeamLearnedMemory(input(),deps)).rejects.toThrow('validação');expect(call).not.toHaveBeenCalled();enabled=true;deps.storage.getItem=()=>{throw Error('Synthetic storage unavailable');};await expect(reviseTeamLearnedMemory(input(),deps)).rejects.toThrow();expect(prepare).not.toHaveBeenCalled();expect(call).not.toHaveBeenCalled();
});
it.each(['nodes','links','generatedPrompt','generatedImagePrompt'])('legacy plaintext side field refuses preparation and preserves the source: %s',async field=>{
  current![field]=field.includes('Prompt')?'Synthetic legacy prompt':[];await expect(reviseTeamLearnedMemory(input(),deps)).rejects.toThrow('rascunho');expect(prepare).not.toHaveBeenCalled();expect(call).not.toHaveBeenCalled();expect(storage.size).toBe(0);expect(current![field]).toBeDefined();
});
