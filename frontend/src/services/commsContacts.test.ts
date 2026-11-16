import {beforeAll,beforeEach,expect,it,vi} from 'vitest';
vi.mock('../firebase',()=>({default:{},db:{},auth:{currentUser:null}}));
import {lookupCommsRecipient,requestCommsContact,recoverCommsContact,cancelCommsContact,respondCommsContact,commsContactPendingKey,type CommsContactClientDeps} from './commsContacts';
import {setMemoryCryptoMnemonic,encryptMemoryFields,decryptMemoryEnvelope} from './memoryCrypto';
import {generateRSAKeyPair,exportPublicKey} from '../utils/crypto';
import {commsContactRequestBytes,parseCommsContactCommand,type CommsContactCall,type CommsRecipient,type CommsContactRequest,type CommsContactOutcome} from '../../../functions/src/commsContactContract';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
const id='11111111-1111-4111-8111-111111111111',key=commsContactPendingKey('alice');let recipient:CommsRecipient;
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
beforeAll(async()=>{const pem=await exportPublicKey((await generateRSAKeyPair()).publicKey);recipient={uid:'bob',displayName:'Synthetic Bob',publicKeyPem:pem,fingerprint:await hash(pem)};});
beforeEach(()=>setMemoryCryptoMnemonic(words));
function fixture(){
  const records=new Map<string,string>(),listeners=new Set<()=>void>();const state={uid:'alice',ready:true,enabled:true,receipt:null as CommsContactOutcome|null,loseAck:false,failCreate:false,failStage:false,creates:0,storageChanged:()=>{},duringStatus:undefined as undefined|(()=>void)};
  const storage:Storage={get length(){return records.size;},key:index=>[...records.keys()][index]??null,getItem:k=>records.get(k)??null,setItem:(k,value)=>{if(state.failStage)throw Error();records.set(k,value);},removeItem:k=>{records.delete(k);},clear:()=>records.clear()};
  const call=vi.fn(async(mode:string,value:unknown)=>{
    const command=parseCommsContactCommand(value,mode as CommsContactCall);expect(command.actorUid).toBe('alice');
    if(mode==='lookup')return{...recipient};if(mode==='respond')return{...command.request,updatedAt:1000};
    const input=command.request as CommsContactRequest,base:CommsContactOutcome={requestId:input.requestId,digest:await hash(commsContactRequestBytes(input)),status:'unknown',createdAt:null,updatedAt:null};
    if(mode==='status'){state.duringStatus?.();return state.receipt??base;}
    if(mode==='cancel'){if(state.receipt?.status==='accepted')return state.receipt;state.receipt={...base,status:'cancelled',createdAt:1000,updatedAt:1000};return state.receipt;}
    expect(records.get(key)).toBeTruthy();state.creates++;if(state.failCreate)throw Error('Synthetic unavailable');state.receipt={...base,status:'pending',createdAt:1000,updatedAt:1000};if(state.loseAck)throw Error('Synthetic ACK lost');return state.receipt;
  });
  const deps:CommsContactClientDeps={enabled:()=>state.enabled,storage,id:vi.fn(()=>id),exclusive:async(_key,work)=>work(),encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,call,
    mutation:{uid:()=>state.uid,ready:()=>state.ready,subscribe:changed=>{listeners.add(changed);return()=>{listeners.delete(changed);};}},observeStorage:(_uid,changed)=>{state.storageChanged=changed;return()=>{state.storageChanged=()=>{};};}};
  return{records,state,listeners,deps,call};
}
it('lookup sends the exact normalized address and verifies a public-only key response',async()=>{
  const f=fixture();expect(await lookupCommsRecipient('alice',' BOB@example.invalid ',()=>{},f.deps)).toEqual(recipient);expect(f.call).toHaveBeenCalledWith('lookup',{actorUid:'alice',request:{lookup:'bob@example.invalid'}});expect(f.records.size).toBe(0);
  f.call.mockResolvedValueOnce({...recipient,fingerprint:'f'.repeat(64)});await expect(lookupCommsRecipient('alice','bob',()=>{},f.deps)).rejects.toThrow();
});
it('closed admission performs no journal, request or UUID generation',async()=>{
  const f=fixture();f.state.enabled=false;await expect(requestCommsContact('alice',recipient,()=>{},f.deps)).rejects.toThrow();expect(f.call).not.toHaveBeenCalled();expect(f.records.size).toBe(0);
});
it('stages a UID-bound encrypted request before creation and removes it only after confirmation',async()=>{
  const f=fixture(),put=vi.spyOn(f.deps.storage,'setItem');expect((await requestCommsContact('alice',recipient,()=>{},f.deps)).status).toBe('pending');expect(f.state.creates).toBe(1);expect(f.records.has(key)).toBe(false);
  const raw=put.mock.calls[0][1];expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['ct','iv','v']);expect(raw).not.toContain('recipientUid');expect(raw).not.toContain(recipient.fingerprint);
});
it('lost ACK recovery reuses the ID/request/cipher and needs no create with admission closed',async()=>{
  const f=fixture();f.state.loseAck=true;await expect(requestCommsContact('alice',recipient,()=>{},f.deps)).rejects.toThrow();const raw=f.records.get(key)!;
  const journal=JSON.parse((await decryptMemoryEnvelope(JSON.parse(raw))).text);expect(journal).toEqual({v:1,uid:'alice',request:{requestId:id,recipientUid:'bob',recipientFingerprint:recipient.fingerprint}});
  f.state.enabled=false;expect((await recoverCommsContact('alice',()=>{},f.deps)).status).toBe('pending');expect(f.state.creates).toBe(1);expect(f.records.has(key)).toBe(false);
});
it('a pending local operation refuses another ID and an unknown server operation is retained when admission closes',async()=>{
  const f=fixture();f.state.failCreate=true;await expect(requestCommsContact('alice',recipient,()=>{},f.deps)).rejects.toThrow();const raw=f.records.get(key);await expect(requestCommsContact('alice',recipient,()=>{},f.deps)).rejects.toThrow();expect(f.state.creates).toBe(1);f.state.enabled=false;
  await expect(recoverCommsContact('alice',()=>{},f.deps)).rejects.toThrow();expect(f.records.get(key)).toBe(raw);expect(f.state.creates).toBe(1);
});
it('cancel is available with admission closed; an accepted contact is confirmed without withdrawal',async()=>{
  const f=fixture();f.state.failCreate=true;await expect(requestCommsContact('alice',recipient,()=>{},f.deps)).rejects.toThrow();f.state.enabled=false;expect((await cancelCommsContact('alice',()=>{},f.deps)).status).toBe('cancelled');expect(f.records.has(key)).toBe(false);
  const g=fixture();g.state.loseAck=true;await expect(requestCommsContact('alice',recipient,()=>{},g.deps)).rejects.toThrow();g.state.receipt!.status='accepted';expect((await cancelCommsContact('alice',()=>{},g.deps)).status).toBe('accepted');
});
it.each(['account','coffer','caller','storage'] as const)('context %s ABA rejects a late status and conserves ciphertext',async mode=>{
  const f=fixture();f.state.loseAck=true;await expect(requestCommsContact('alice',recipient,()=>{},f.deps)).rejects.toThrow();let live=true;f.state.duringStatus=()=>{
    if(mode==='account'){f.state.uid='bob';for(const changed of f.listeners)changed();f.state.uid='alice';}if(mode==='coffer'){f.state.ready=false;for(const changed of f.listeners)changed();f.state.ready=true;}if(mode==='caller')live=false;if(mode==='storage')f.state.storageChanged();
  };await expect(recoverCommsContact('alice',()=>{if(!live)throw Error();},f.deps)).rejects.toThrow();expect(f.records.has(key)).toBe(true);expect(f.listeners.size).toBe(0);
});
it('a failed durable stage sends no status/create and a transplanted/wrong-vault journal is never adopted',async()=>{
  const f=fixture();f.state.failStage=true;await expect(requestCommsContact('alice',recipient,()=>{},f.deps)).rejects.toThrow();expect(f.call).not.toHaveBeenCalled();f.state.failStage=false;f.state.loseAck=true;await expect(requestCommsContact('alice',recipient,()=>{},f.deps)).rejects.toThrow();const raw=f.records.get(key)!;
  f.records.set(commsContactPendingKey('bob'),raw);f.state.uid='bob';await expect(recoverCommsContact('bob',()=>{},f.deps)).rejects.toThrow();expect(f.records.get(commsContactPendingKey('bob'))).toBe(raw);
  f.state.uid='alice';setMemoryCryptoMnemonic([...words].reverse());await expect(recoverCommsContact('alice',()=>{},f.deps)).rejects.toThrow();expect(f.records.get(key)).toBe(raw);
});
it('response captures its request/decision and suppresses late acknowledgement after a caller transition',async()=>{
  const f=fixture();let live=true;f.call.mockImplementation(async(mode,value)=>{expect(mode).toBe('respond');live=false;return{...parseCommsContactCommand(value,'respond').request,updatedAt:1000};});
  await expect(respondCommsContact('alice',id,'accepted',()=>{if(!live)throw Error();},f.deps)).rejects.toThrow();expect(f.call).toHaveBeenCalledWith('respond',{actorUid:'alice',request:{requestId:id,status:'accepted'}});expect(f.records.size).toBe(0);
});
it('an initial storage read failure retires account and storage observers without any request',async()=>{
  const f=fixture(),stop=vi.fn();f.deps.observeStorage=()=>stop;f.deps.storage.getItem=()=>{throw Error('Synthetic storage read failure');};
  await expect(requestCommsContact('alice',recipient,()=>{},f.deps)).rejects.toThrow();expect(f.listeners.size).toBe(0);expect(stop).toHaveBeenCalledOnce();expect(f.call).not.toHaveBeenCalled();
});
it('recovers an existing v1 journal and old digest with a bound status command while admission is closed',async()=>{
  const f=fixture(),request={requestId:id,recipientUid:'bob',recipientFingerprint:recipient.fingerprint};
  const raw=JSON.stringify(await encryptMemoryFields({text:JSON.stringify({v:1,uid:'alice',request})}));f.records.set(key,raw);f.state.enabled=false;
  f.state.receipt={requestId:id,digest:await hash(JSON.stringify(request)),status:'pending',createdAt:1000,updatedAt:1000};
  expect((await recoverCommsContact('alice',()=>{},f.deps)).status).toBe('pending');expect(f.call).toHaveBeenCalledWith('status',{actorUid:'alice',request});expect(f.state.creates).toBe(0);expect(f.deps.id).not.toHaveBeenCalled();expect(f.records.has(key)).toBe(false);
});
it('a transport token mismatch preserves the original journal without changing its captured actor',async()=>{
  const f=fixture();f.call.mockImplementation(async(mode,value)=>{const command=parseCommsContactCommand(value,mode as CommsContactCall);expect(command.actorUid).toBe('alice');throw Error('Synthetic token was issued for another account');});
  await expect(requestCommsContact('alice',recipient,()=>{},f.deps)).rejects.toThrow();const journal=JSON.parse((await decryptMemoryEnvelope(JSON.parse(f.records.get(key)!))).text);expect(journal.uid).toBe('alice');expect(journal.request.requestId).toBe(id);expect(Object.keys(journal.request).sort()).toEqual(['recipientFingerprint','recipientUid','requestId']);
  expect(f.call).toHaveBeenCalledOnce();expect(f.call.mock.calls[0][0]).toBe('status');expect(f.listeners.size).toBe(0);
});
it.each([false,true])('revoked recovery with preserved dates=%s clears only the verified own journal and performs no mutation',async dates=>{
  const f=fixture();f.state.loseAck=true;await expect(requestCommsContact('alice',recipient,()=>{},f.deps)).rejects.toThrow();f.state.receipt={...f.state.receipt!,status:'revoked',createdAt:dates?1000:null,updatedAt:dates?1000:null};f.state.enabled=false;
  f.records.set(commsContactPendingKey('bob'),'other-uid-cipher');const creates=f.state.creates;f.call.mockClear();expect((await recoverCommsContact('alice',()=>{},f.deps)).status).toBe('revoked');expect(f.call).toHaveBeenCalledOnce();expect(f.call.mock.calls[0][0]).toBe('status');expect(f.state.creates).toBe(creates);expect(f.records.has(key)).toBe(false);expect(f.records.get(commsContactPendingKey('bob'))).toBe('other-uid-cipher');
});
it('malformed revoked dates/authority and transient errors preserve the encrypted intent',async()=>{
  const f=fixture();f.state.loseAck=true;await expect(requestCommsContact('alice',recipient,()=>{},f.deps)).rejects.toThrow();const raw=f.records.get(key);
  for(const patch of[{createdAt:null,updatedAt:1000},{createdAt:1000,updatedAt:null},{digest:'f'.repeat(64)},{requestId:'22222222-2222-4222-8222-222222222222'}]){f.call.mockResolvedValueOnce({...f.state.receipt,status:'revoked',...patch});await expect(recoverCommsContact('alice',()=>{},f.deps)).rejects.toThrow();expect(f.records.get(key)).toBe(raw);}
  f.call.mockRejectedValueOnce(Error('Synthetic outage'));await expect(recoverCommsContact('alice',()=>{},f.deps)).rejects.toThrow();expect(f.records.get(key)).toBe(raw);
});
it('a revoked response after account ABA cannot clear the original-account cipher',async()=>{
  const f=fixture();f.state.loseAck=true;await expect(requestCommsContact('alice',recipient,()=>{},f.deps)).rejects.toThrow();const raw=f.records.get(key);f.state.receipt={...f.state.receipt!,status:'revoked'};
  f.state.duringStatus=()=>{f.state.uid='carol';for(const changed of f.listeners)changed();f.state.uid='alice';};await expect(cancelCommsContact('alice',()=>{},f.deps)).rejects.toThrow();expect(f.records.get(key)).toBe(raw);
});
