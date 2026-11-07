import {createHash} from 'node:crypto';
import {expect,it,vi} from 'vitest';
vi.mock('../firebase',()=>({default:{},auth:{currentUser:{uid:'alice'}}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:()=>()=>{}}));
vi.mock('firebase/functions',()=>({getFunctions:()=>({}),httpsCallable:()=>vi.fn()}));
vi.mock('./memoryCrypto',()=>({isMemoryCryptoReady:()=>true,onMemoryCryptoChanged:()=>()=>{}}));
vi.mock('./teamVault',()=>({getTeamKeyCacheGeneration:()=>0,onTeamKeyChanged:()=>()=>{}}));
import {createCapsulePublicationService,type CapsulePublicationClientDeps} from './capsulePublicationService';
import {capsulePublicationBytes,CAPSULE_PLAIN_MAX_BYTES,type CapsulePublicationRequest} from '../../../functions/src/capsulePublicationContract';
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const source=()=>({id:'a',uid:'alice',updatedAt:100,text:'SYNTHETIC_PRIVATE_TEXT',title:'SYNTHETIC_PRIVATE_TITLE',tags:['Synthetic']});
const cipher=()=>({v:1 as const,alg:'AES-GCM-PBKDF2' as const,salt:'A'.repeat(22)+'==',iv:'A'.repeat(16),data:'A'.repeat(43)+'='});
const reply=(request:CapsulePublicationRequest,status='committed')=>({v:1,actorUid:request.actorUid,publicationId:request.publicationId,digest:digest(capsulePublicationBytes(request)),status,createdAt:status==='unknown'?null:1000,expiresAt:request.expiresAt});
function fixture(){const state={uid:'alice',ready:true,generation:0,enabled:true},listeners=new Set<()=>void>();const deps:CapsulePublicationClientDeps={
  uid:()=>state.uid,ready:()=>state.ready,generation:()=>state.generation,enabled:()=>state.enabled,subscribe:changed=>{listeners.add(changed);return()=>listeners.delete(changed);},
  id:()=> '00000000-0000-4000-8000-000000000001',now:()=>1000,encrypt:vi.fn(async()=>cipher()),hash:vi.fn(async text=>digest(text)),
  call:vi.fn(async(mode,request)=>reply(request,mode==='cancel'?'cancelled':'committed'))};
  return{state,deps,listeners,change:()=>listeners.forEach(listener=>listener()),service:createCapsulePublicationService(deps)};}
it('prepares a cipher-only immutable command and verifies its bound response',async()=>{
  const f=fixture(),input=source(),prepared=await f.service.prepare([input],'SYNTHETIC_PASSPHRASE',7);input.text='CHANGED';input.updatedAt=999;
  expect(prepared.request.sources).toEqual([{sessionId:'a',teamId:null,revision:100}]);expect(Object.isFrozen(prepared.request.sources)).toBe(true);
  const payload=JSON.stringify(prepared.request);for(const value of['SYNTHETIC_PRIVATE_TEXT','SYNTHETIC_PRIVATE_TITLE','SYNTHETIC_PASSPHRASE'])expect(payload.includes(value)).toBe(false);
  expect((await prepared.send('publish')).status).toBe('committed');prepared.dispose();expect(f.listeners.size).toBe(0);
});
it('refuses closed gate, locked source, foreign personal source, duplicate/mixed scopes and oversized input before encryption',async()=>{
  for(const reason of['gate','vault','locked','foreign','duplicate','mixed','oversized','passphrase']){const f=fixture(),input=source();let sources=[input];
    if(reason==='gate')f.state.enabled=false;if(reason==='vault')f.state.ready=false;if(reason==='locked')Object.assign(input,{encLocked:true});if(reason==='foreign')input.uid='bob';
    if(reason==='duplicate')sources=[input,input];if(reason==='mixed')sources=[input,{...input,id:'b',teamId:'crew'} as typeof input];if(reason==='oversized')input.text='x'.repeat(CAPSULE_PLAIN_MAX_BYTES+1);
    await expect(f.service.prepare(sources,reason==='passphrase'?'short':'SYNTHETIC_PASSPHRASE',7)).rejects.toThrow();expect(f.deps.encrypt).not.toHaveBeenCalled();expect(f.deps.call).not.toHaveBeenCalled();expect(f.listeners.size).toBe(0);
  }
});
it('retains the exact nonce, expiry and cipher for retry after a lost acknowledgement',async()=>{
  const f=fixture(),prepared=await f.service.prepare([source()],'SYNTHETIC_PASSPHRASE',7);vi.mocked(f.deps.call).mockRejectedValueOnce(Error('PRIVATE_DIAGNOSTIC'));
  await expect(prepared.send('publish')).rejects.toThrow('Não foi possível confirmar');expect((await prepared.send('publish')).status).toBe('committed');
  expect(vi.mocked(f.deps.call).mock.calls[0][1]).toBe(vi.mocked(f.deps.call).mock.calls[1][1]);expect(f.deps.encrypt).toHaveBeenCalledTimes(1);prepared.dispose();
});
it('actor ABA or vault/key changes during encryption and digest prevent any RPC',async()=>{
  for(const phase of['encrypt','hash']){const f=fixture();const change=()=>{f.state.uid='bob';f.change();f.state.uid='alice';};
    if(phase==='encrypt')f.deps.encrypt=vi.fn(async()=>{change();return cipher();});else f.deps.hash=vi.fn(async text=>{f.state.generation++;f.change();return digest(text);});
    await expect(f.service.prepare([source()],'SYNTHETIC_PASSPHRASE',7)).rejects.toThrow();expect(f.deps.call).not.toHaveBeenCalled();expect(f.listeners.size).toBe(0);
  }
});
it('late confirmation cannot cross account or retired caller context',async()=>{
  const f=fixture();let current=true;const prepared=await f.service.prepare([source()],'SYNTHETIC_PASSPHRASE',7,()=>current);
  f.deps.call=vi.fn(async(_mode,request)=>{current=false;return reply(request);});await expect(prepared.send('publish')).rejects.toThrow();prepared.dispose();
});
it('rejects response drift or extra fields without accepting a foreign receipt',async()=>{
  for(const patch of[{actorUid:'bob'},{publicationId:'other'},{digest:'0'.repeat(64)},{expiresAt:1},{createdAt:null},{v:2},{extra:true},{status:'unknown',createdAt:1000}]){
    const f=fixture(),prepared=await f.service.prepare([source()],'SYNTHETIC_PASSPHRASE',7);f.deps.call=vi.fn(async(_mode,request)=>({...reply(request),...patch}));await expect(prepared.send('publish')).rejects.toThrow();prepared.dispose();
  }
});
it('status and cancellation remain usable after the publication gate closes',async()=>{
  const f=fixture(),prepared=await f.service.prepare([source()],'SYNTHETIC_PASSPHRASE',7);f.state.enabled=false;
  await expect(prepared.send('publish')).rejects.toThrow();expect(f.deps.call).not.toHaveBeenCalled();expect((await prepared.send('status')).status).toBe('committed');expect((await prepared.send('cancel')).status).toBe('cancelled');prepared.dispose();
});
it('captures pack text and source revisions before asynchronous encryption',async()=>{
  const f=fixture(),first=source(),second={...source(),id:'b'};f.deps.encrypt=vi.fn(async plain=>{first.text='CHANGED';second.updatedAt=999;expect(plain.startsWith('[[MNEMOSYNE_CAPSULE_PACK_V1]]')).toBe(true);return cipher();});
  const prepared=await f.service.prepare([first,second],'SYNTHETIC_PASSPHRASE',1);expect(prepared.request.sources.map(row=>row.revision)).toEqual([100,100]);expect(prepared.request.sources).toHaveLength(2);prepared.dispose();
});
