import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('../firebase',()=>({default:{},db:{},auth:{}}));
import {encryptMemoryFields,decryptMemoryEnvelope,setMemoryCryptoMnemonic,isMemoryCryptoReady} from './memoryCrypto';
import {encryptTeamMemoryFields,decryptTeamMemoryEnvelope,encryptLegacyTeamMemoryFields} from './teamVault';
import {captureTeamRevisionBaseline,reviseTeamLearnedMemory,compactTeamStoredEmbedding,rollbackTeamStoredEmbedding,recoverPendingTeamRevision,cancelPendingTeamRevision,teamRevisionCheckpointKey,type TeamRevisionDeps,type TeamRevisionBaseline} from './teamRevisionRecovery';
import {canonicalSyncState} from '../../../functions/src/mobileSyncImportContract';
import {teamRevisionRequestBytes,type TeamRevisionRequest} from '../../../functions/src/teamRevisionContract';
import {serializeStoredEmbedding} from '../../../functions/src/embeddingStorage';
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
    const revision=Math.max(1000,request.baseline.revision+1);
    if('change' in request){
      const previous=structuredClone(current);if(request.change.kind==='compact')current={...current,embedding:serializeStoredEmbedding(current!.embedding as number[]),updatedAt:revision};
      else current={...current,embedding:archive!.embedding,updatedAt:revision};archive=previous;
    }else{archive={text:'',title:null,enc:structuredClone(request.priorEnc)};current={...current,text:'',title:null,enc:structuredClone(request.enc),...request.metadata,keyEpoch:2,keyId,updatedAt:revision};}stamp++;
    receipt={...unknown,status:'committed',revision,createdAt:1000};if(loseApply)throw Error('Synthetic lost acknowledgement');return receipt;
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

it('team compaction seals only a storage command and leaves historic ciphertext, model and key epoch unchanged',async()=>{
  current!.embedding=[-0,Number.MIN_VALUE,1/3];current!.embeddingModel='historic@1';baseline=await fresh();const before=structuredClone(current),key=vi.fn(deps.key),encrypt=vi.fn(deps.encryptContent);deps.key=key;deps.encryptContent=encrypt;
  await compactTeamStoredEmbedding({uid:'alice',id:'note',teamId:'crew',baseline},deps);
  expect(JSON.parse(current!.embedding as string).every((n:number,i:number)=>Object.is(n,(before!.embedding as number[])[i]))).toBe(true);for(const field of ['enc','embeddingModel','keyEpoch','keyId','learning','connections'])expect(current![field]).toEqual(before![field]);
  expect(key).not.toHaveBeenCalled();expect(encrypt).not.toHaveBeenCalled();expect(prepare).not.toHaveBeenCalled();const request=call.mock.calls.find(row=>row[0]==='apply')![1].request;expect(Object.keys(request).sort()).toEqual(['baseline','change','operationId']);expect(request.change).toEqual({kind:'compact'});expect(storage.size).toBe(0);
});
it('team storage lost acknowledgement recovers the original encrypted request with admission closed and no second apply',async()=>{
  current!.embedding=[.1,.2];baseline=await fresh();loseApply=true;await expect(compactTeamStoredEmbedding({uid:'alice',id:'note',teamId:'crew',baseline},deps)).rejects.toThrow('lost acknowledgement');
  const raw=storage.get(checkpoint)!,request=JSON.parse((await decryptMemoryEnvelope(JSON.parse(raw))).text).request;expect(request.change).toEqual({kind:'compact'});expect(request.enc).toBeUndefined();expect(request.metadata).toBeUndefined();
  enabled=false;current=undefined;call.mockClear();const key=vi.fn(deps.key);deps.key=key;expect((await recoverPendingTeamRevision('alice',()=>{},deps)).status).toBe('committed');expect(call.mock.calls.map(row=>row[0])).toEqual(['status','status']);expect(id).toHaveBeenCalledOnce();expect(key).not.toHaveBeenCalled();expect(prepare).not.toHaveBeenCalled();expect(storage.size).toBe(0);
});
it('team storage rollback sends the validated history reference without preparing or encrypting content',async()=>{
  current!.embedding=[.1,.2];baseline=await fresh();await compactTeamStoredEmbedding({uid:'alice',id:'note',teamId:'crew',baseline},deps);baseline=await fresh();receipt=undefined;call.mockClear();id.mockReturnValue('44444444-4444-4444-8444-444444444444');
  await rollbackTeamStoredEmbedding({uid:'alice',id:'note',teamId:'crew',baseline,versionId:'team-revision-33333333-3333-4333-8333-333333333333'},deps);expect(current!.embedding).toEqual([.1,.2]);expect(prepare).not.toHaveBeenCalled();expect(call.mock.calls.find(row=>row[0]==='apply')![1].request.change).toEqual({kind:'rollback',versionId:'team-revision-33333333-3333-4333-8333-333333333333'});
});
it.each(['already-compact','malformed','shared','ambiguous'] as const)('team storage refuses unsuitable source before a journal or apply: %s',async mode=>{
  current!.embedding=mode==='already-compact'?'[1,0]':mode==='malformed'?[1,null]:[1,0];if(mode==='shared')current!.sharedWithIds=['someone'];if(mode==='ambiguous')current!.teamScopeAmbiguous=true;baseline=await fresh();
  await expect(compactTeamStoredEmbedding({uid:'alice',id:'note',teamId:'crew',baseline},deps)).rejects.toThrow();expect(storage.size).toBe(0);expect(call.mock.calls.some(row=>row[0]==='apply')).toBe(false);expect(id).not.toHaveBeenCalled();expect(prepare).not.toHaveBeenCalled();
});
it('team storage refuses a changed/restored team scope before sealing or using another nonce',async()=>{
  current!.embedding=[1,0];baseline=await fresh();modeChanged=mode=>{if(mode==='prepare'){generation++;for(const change of teamListeners)change();generation--;}};
  await expect(compactTeamStoredEmbedding({uid:'alice',id:'note',teamId:'crew',baseline},deps)).rejects.toThrow();expect(storage.size).toBe(0);expect(id).not.toHaveBeenCalled();expect(call.mock.calls.some(row=>row[0]==='apply')).toBe(false);
});
it('journal read-back must match the exact intended team request before persistence or admission',async()=>{
  current!.embedding=[1,0];baseline=await fresh();deps.encryptJournal=async fields=>{const row=JSON.parse(fields.text);row.request.operationId='44444444-4444-4444-8444-444444444444';return encryptMemoryFields({text:JSON.stringify(row)});};
  await expect(compactTeamStoredEmbedding({uid:'alice',id:'note',teamId:'crew',baseline},deps)).rejects.toThrow();expect(storage.size).toBe(0);expect(call.mock.calls.some(row=>row[0]==='apply'||row[0]==='status')).toBe(false);
});
