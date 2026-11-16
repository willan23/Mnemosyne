import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('../firebase',()=>({auth:{},db:{},default:{}}));
import {loadCognitiveDraft,saveCognitiveDraft,discardCognitiveDraft,parseCognitiveDraft,CognitiveDraftError,type CognitiveDraft,type CognitiveDraftDeps} from './cognitiveDraft';
import {encryptMemoryFields,decryptMemoryEnvelope,setMemoryCryptoMnemonic,isMemoryCryptoReady} from './memoryCrypto';
import type {StoredCognitiveDraft} from './cognitiveDraftStore';
import type {TeamRecord} from './teamsService';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
const id='11111111-1111-4111-8111-111111111111',keyId='22222222-2222-4222-8222-222222222222';
const input=():CognitiveDraft=>({v:1,uid:'alice',scope:{kind:'personal'},text:'SYNTHETIC_PRIVATE_DRAFT_791 á漢🙂',imagePrompt:'',image:null,
  generation:{id,uid:'alice',personalRevisionBaseline:{sessionId:id,stateHash:'a'.repeat(64),stateDigest:'b'.repeat(64),revision:10}}});
let deps:CognitiveDraftDeps,records:Map<string,StoredCognitiveDraft>,uid:string,generation:number,listeners:Set<()=>void>,team:TeamRecord;
beforeEach(()=>{setMemoryCryptoMnemonic(words);uid='alice';generation=0;listeners=new Set();records=new Map();
  team={id:'crew',ownerUid:'alice',memberUids:['alice','bob'],wrappedKeys:{alice:{v:1}},activeKeyEpoch:1,activeKeyId:keyId,keyRotationStatus:'active'} as unknown as TeamRecord;
  deps={uid:()=>uid,ready:isMemoryCryptoReady,generation:()=>generation,subscribe:change=>{listeners.add(change);return()=>{listeners.delete(change);};},team:async()=>structuredClone(team),
    encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,id:()=>crypto.randomUUID(),exclusive:async(_key,work)=>work(),
    store:{get:async key=>structuredClone(records.get(key)),compareExchange:async(key,expected,next,guard)=>{guard();const current=records.get(key);if((current?JSON.stringify(current):null)!==expected)throw Error('Synthetic conflict');if(next)records.set(key,structuredClone(next));else records.delete(key);}}};
});
afterEach(()=>setMemoryCryptoMnemonic(null));
it('persists only ciphertext and restores text, image and the exact displayed baseline',async()=>{
  const draft=input();draft.image={mediaType:'image/png',provider:'synthetic-local',dataUrl:'data:image/png;base64,c3ludGhldGlj'};draft.imagePrompt='PRIVATE_IMAGE_PROMPT_791';
  const raw=await saveCognitiveDraft('alice',draft,null,()=>{},deps);expect(raw).toBeTruthy();expect(raw).not.toContain('PRIVATE');expect(raw).not.toContain(id);expect(raw).not.toContain('data:image');
  const recovered=await loadCognitiveDraft('alice',()=>{},deps);expect(recovered.raw).toBe(raw);expect(recovered.draft).toEqual(draft);expect(records.size).toBe(1);
});
it('a caller mutation during encryption does not change the captured draft or baseline',async()=>{
  const draft=input();deps.encrypt=async value=>{draft.text='Changed';draft.generation!.personalRevisionBaseline!.revision=99;return encryptMemoryFields(value);};
  await saveCognitiveDraft('alice',draft,null,()=>{},deps);expect((await loadCognitiveDraft('alice',()=>{},deps)).draft).toEqual(input());
});
it('two copies cannot replace each other after one has advanced; an exact empty save only deletes its own revision',async()=>{
  const raw=await saveCognitiveDraft('alice',input(),null,()=>{},deps);const first=await loadCognitiveDraft('alice',()=>{},deps),second=await loadCognitiveDraft('alice',()=>{},deps);
  const newer={...input(),text:'Newer edit'};await saveCognitiveDraft('alice',newer,first.raw,()=>{},deps);
  await expect(saveCognitiveDraft('alice',input(),second.raw,()=>{},deps)).rejects.toThrow();expect((await loadCognitiveDraft('alice',()=>{},deps)).draft!.text).toBe('Newer edit');
  const current=await loadCognitiveDraft('alice',()=>{},deps);await expect(saveCognitiveDraft('alice',{...input(),text:'',generation:null},raw,()=>{},deps)).rejects.toThrow();
  expect(await saveCognitiveDraft('alice',{...input(),text:'',generation:null},current.raw,()=>{},deps)).toBeNull();expect(records.size).toBe(0);
});
it.each(['uid','vault','team-generation','outer'] as const)('a context loss during encryption prevents storage, even after returning: %s',async mode=>{
  let active=true;deps.encrypt=async value=>{if(mode==='uid'){uid='bob';for(const change of listeners)change();uid='alice';}if(mode==='vault'){setMemoryCryptoMnemonic(null);for(const change of listeners)change();setMemoryCryptoMnemonic(words);}
    if(mode==='team-generation'){generation++;for(const change of listeners)change();generation=0;}if(mode==='outer')active=false;return encryptMemoryFields(value);};
  await expect(saveCognitiveDraft('alice',input(),null,()=>{if(!active)throw Error();},deps)).rejects.toThrow();expect(records.size).toBe(0);expect(listeners.size).toBe(0);
});
it('refuses transplanted owners, a wrong vault and an altered ciphertext without removing stored copies',async()=>{
  await saveCognitiveDraft('alice',input(),null,()=>{},deps);const original=structuredClone(records.get('alice')!);records.set('bob',{...original,uid:'bob'});uid='bob';
  await expect(loadCognitiveDraft('bob',()=>{},deps)).rejects.toThrow();uid='alice';setMemoryCryptoMnemonic([...words].reverse());await expect(loadCognitiveDraft('alice',()=>{},deps)).rejects.toThrow();setMemoryCryptoMnemonic(words);
  const damaged=structuredClone(original);damaged.enc.ct=(damaged.enc.ct[0]==='A'?'B':'A')+damaged.enc.ct.slice(1);records.set('alice',damaged);await expect(loadCognitiveDraft('alice',()=>{},deps)).rejects.toThrow();expect(records.get('alice')).toEqual(damaged);
});
it.each(['removed','epoch','rotation'] as const)('team recovery requires current membership and the captured epoch: %s',async mode=>{
  const draft={...input(),scope:{kind:'team' as const,teamId:'crew',keyEpoch:1,keyId},generation:{id,uid:'alice',teamId:'crew'}};
  await saveCognitiveDraft('alice',draft,null,()=>{},deps);if(mode==='removed')team.memberUids=['bob'];if(mode==='epoch')team.activeKeyEpoch=2;if(mode==='rotation')team.keyRotationStatus='rotation_pending';
  await expect(loadCognitiveDraft('alice',()=>{},deps)).rejects.toThrow();expect(records.size).toBe(1);
});
it('team access is rechecked after encryption before an atomic write',async()=>{
  const draft={...input(),scope:{kind:'team' as const,teamId:'crew',keyEpoch:1,keyId},generation:{id,uid:'alice',teamId:'crew'}};
  deps.encrypt=async value=>{team.memberUids=['bob'];return encryptMemoryFields(value);};await expect(saveCognitiveDraft('alice',draft,null,()=>{},deps)).rejects.toThrow();expect(records.size).toBe(0);
});
it('a replaced record during decryption cannot be published',async()=>{
  await saveCognitiveDraft('alice',input(),null,()=>{},deps);deps.decrypt=async enc=>{const result=await decryptMemoryEnvelope(enc);records.set('alice',{...records.get('alice')!,revision:crypto.randomUUID()});return result;};
  await expect(loadCognitiveDraft('alice',()=>{},deps)).rejects.toThrow();expect(records.size).toBe(1);
});
it('a failed readback retains the confirmed encrypted revision so a retry can compare against it',async()=>{
  deps.store.get=async()=>{throw Error('Synthetic unavailable readback');};let failure:unknown;
  try{await saveCognitiveDraft('alice',input(),null,()=>{},deps);}catch(error){failure=error;}
  expect(failure).toBeInstanceOf(CognitiveDraftError);expect((failure as CognitiveDraftError).committedRaw).toBe(JSON.stringify(records.get('alice')));expect(records.size).toBe(1);
});
it('an explicit own discard removes an unreadable copy but retains every other UID',async()=>{
  await saveCognitiveDraft('alice',input(),null,()=>{},deps);records.set('bob',structuredClone(records.get('alice')!));records.get('alice')!.enc.ct='damaged';
  await discardCognitiveDraft('alice',()=>{},deps);expect(records.has('alice')).toBe(false);expect(records.has('bob')).toBe(true);
});
it.each(['authority','size','scope','baseline','url','padding'] as const)('strict parsing refuses incompatible private draft inputs: %s',mode=>{
  const value=input() as CognitiveDraft&Record<string,unknown>;if(mode==='authority')value.otherUid='bob';if(mode==='size')value.text='🙂'.repeat(125001);if(mode==='scope')value.scope=undefined as never;
  if(mode==='baseline')value.generation!.personalRevisionBaseline!.sessionId='other';if(mode==='url')value.image={mediaType:'image/png',provider:'synthetic',imageUrl:'https://example.invalid/file'};
  if(mode==='padding')value.image={mediaType:'image/png',provider:'synthetic',dataUrl:'data:image/png;base64,dGVzdB=='};expect(()=>parseCognitiveDraft(value,'alice')).toThrow();
});
it('a team draft durably preserves its captured document, team and epoch versions',async()=>{
  const draft=input();draft.scope={kind:'team',teamId:'crew',keyEpoch:1,keyId};draft.generation={id,uid:'alice',teamId:'crew',teamRevisionBaseline:{sessionId:id,teamId:'crew',authorUid:'bob',ownerUid:'alice',stateHash:'a'.repeat(64),stateDigest:'b'.repeat(64),revision:10,teamStateHash:'c'.repeat(64),epochStateHash:'d'.repeat(64),keyEpoch:1,keyId,priorKeyEpoch:1,priorKeyId:keyId}};
  await saveCognitiveDraft('alice',draft,null,()=>{},deps);expect((await loadCognitiveDraft('alice',()=>{},deps)).draft).toEqual(draft);expect(JSON.stringify([...records])).not.toContain(id);
  for(const change of [{sessionId:'other'},{teamId:'other'},{keyEpoch:2},{keyId:'33333333-3333-4333-8333-333333333333'}])expect(()=>parseCognitiveDraft({...draft,generation:{...draft.generation,teamRevisionBaseline:{...draft.generation!.teamRevisionBaseline,...change}}},'alice')).toThrow();
});
it('a legacy team result retains text but requires reopening before revision',()=>{
  const draft=input();draft.scope={kind:'team',teamId:'crew',keyEpoch:1,keyId};draft.generation={id,uid:'alice',teamId:'crew'};expect(parseCognitiveDraft(draft,'alice')).toMatchObject({text:draft.text,generation:{teamRevisionUnavailable:true}});
  expect(()=>parseCognitiveDraft({...draft,generation:{...draft.generation,personalRevisionUnavailable:true}},'alice')).toThrow();
});
