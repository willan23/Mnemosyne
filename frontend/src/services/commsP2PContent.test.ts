import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {setMemoryCryptoMnemonic,encryptMemoryFields,decryptMemoryEnvelope} from './memoryCrypto';
import {createCommsP2PContentLink,sendCommsP2PContent,confirmCommsP2PContent,resumeCommsP2PContent,cancelCommsP2PContent,readCommsP2PInbox,describeCommsP2PPacket,commsP2PContentPendingKey,type CommsP2PContentDeps,type CommsP2PContentLink} from './commsP2PContent';
import type {StoredCommsP2PPacket,CommsP2PInboxStore} from './commsP2PInboxStore';
import type {CommsP2PContentOutcome,CommsP2PContentDescriptor} from '../../../functions/src/commsP2PContentContract';
import type {CommsP2PBinding} from '../../../functions/src/commsP2PContract';
vi.mock('../firebase',()=>({default:{}}));vi.mock('firebase/functions',()=>({getFunctions:vi.fn(),httpsCallable:vi.fn()}));
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'],packetId='44444444-4444-4444-8444-444444444444',roomId='22222222-2222-4222-8222-222222222222';
const session:CommsP2PBinding={roomId,actorUid:'alice',callerUid:'alice',calleeUid:'bob',callerFingerprint:'a'.repeat(64),calleeFingerprint:'b'.repeat(64),offerDigest:'c'.repeat(64)},envelope={encryptedKey:btoa('\0'.repeat(256)),encryptedPayload:btoa('\0'.repeat(32)),payloadIv:btoa('\0'.repeat(12)),hasAttachment:false,attachmentName:null},input={recipientUid:'bob',senderFingerprint:session.callerFingerprint,recipientFingerprint:session.calleeFingerprint,envelope};
function fixture(){
  const journal=new Map<string,string>(),records=new Map<string,StoredCommsP2PPacket>(),state={enabled:true,uid:'alice',dropData:false,dropAck:false,failReceivedStatus:false,admitted:0,receipt:null as CommsP2PContentOutcome|null,descriptor:null as CommsP2PContentDescriptor|null,opened:false,storeFailure:false},errors:unknown[]=[];let invalidate=()=>{},serial=0;
  const store:CommsP2PInboxStore={get:async(uid,id)=>structuredClone(records.get(uid+'/'+id)),compareExchange:async(uid,id,expected,next,guard)=>{guard();if(state.storeFailure)throw Error('Synthetic disk failure');const current=records.get(uid+'/'+id);if((current?JSON.stringify(current):null)!==expected)throw Error('Synthetic CAS');records.set(uid+'/'+id,structuredClone(next));},page:async uid=>({rows:[...records.values()].filter(row=>row.uid===uid).slice(0,10),next:null,scanned:[...records.values()].filter(row=>row.uid===uid).slice(0,10).length,unavailable:0}),clear:async(uid,guard)=>{guard();for(const[key,row]of records)if(row.uid===uid)records.delete(key);}};
  const call=vi.fn(async(mode:string,value:unknown)=>{const req=value as{actorUid:string;packet:CommsP2PContentDescriptor;session?:CommsP2PBinding};expect((req.packet as unknown as Record<string,unknown>).envelope).toBeUndefined();if(mode==='status'){if(state.failReceivedStatus&&state.receipt?.status==='received')throw Error('Synthetic lost status');return state.receipt??{requestId:req.packet.requestId,digest:req.packet.digest,status:'unknown',createdAt:null,updatedAt:null,roomId:null};}
    if(mode==='admit'){state.admitted++;state.descriptor=req.packet;state.receipt={requestId:req.packet.requestId,digest:req.packet.digest,status:'admitted',createdAt:1000,updatedAt:1000,roomId:req.session!.roomId};return state.receipt;}
    if(mode==='ack'){expect(req.actorUid).toBe('bob');expect(records.has('bob/'+req.packet.requestId)).toBe(true);expect(state.opened).toBe(true);state.receipt={...state.receipt!,status:'received',updatedAt:2000};return state.receipt;}
    state.receipt={requestId:req.packet.requestId,digest:req.packet.digest,status:'cancelled',createdAt:1000,updatedAt:1000,roomId:state.receipt?.roomId??null};return state.receipt;
  });
  const storage={getItem:(key:string)=>journal.get(key)??null,setItem:(key:string,value:string)=>journal.set(key,value),removeItem:(key:string)=>journal.delete(key)} as unknown as Storage;
  const deps:CommsP2PContentDeps={enabled:()=>state.enabled,storage,store,id:()=>serial++===0?packetId:serial===2?'55555555-5555-4555-8555-555555555555':'66666666-6666-4666-8666-666666666666',encrypt:encryptMemoryFields,decrypt:decryptMemoryEnvelope,exclusive:async(_name,work)=>work(),call:call as CommsP2PContentDeps['call'],ackTimeoutMs:1000,observeStorage:()=>()=>{},mutation:{uid:()=>state.uid,ready:()=>true,subscribe:listener=>{invalidate=listener;return()=>{};}}};
  const received=vi.fn(),open=vi.fn(async()=>{state.opened=true;return{message:'Synthetic opened packet',attachment:null};}),receiverDeps={...deps,mutation:{uid:()=> 'bob',ready:()=>true,subscribe:()=>()=>{}}};let sender:CommsP2PContentLink,receiver:CommsP2PContentLink;
  const channelA={readyState:'open',bufferedAmount:0,send:vi.fn((value:string)=>{if(!state.dropData)queueMicrotask(()=>receiver.receive(value).catch(error=>errors.push(error)));})} as unknown as RTCDataChannel,channelB={readyState:'open',bufferedAmount:0,send:vi.fn((value:string)=>{if(!state.dropAck)queueMicrotask(()=>sender.receive(value).catch(error=>errors.push(error)));})} as unknown as RTCDataChannel;
  const create=(binding=session)=>{sender=createCommsP2PContentLink('alice',binding,channelA,()=>4096,()=>{},open,vi.fn(),deps);receiver=createCommsP2PContentLink('bob',{...binding,actorUid:'bob'},channelB,()=>4096,()=>{},open,received,receiverDeps);};create();return{state,journal,records,store,call,deps,open,received,errors,channelA,channelB,get sender(){return sender;},get receiver(){return receiver;},create,stop:()=>{sender.stop();receiver.stop();},invalidate:()=>invalidate()};
}
beforeEach(()=>setMemoryCryptoMnemonic(words));afterEach(()=>{setMemoryCryptoMnemonic(null);vi.clearAllMocks();});
it('persists the encrypted recipient copy and opens it before ACK; sender clears only a received receipt',async()=>{
  const f=fixture();const result=await sendCommsP2PContent('alice',input,f.sender,()=>{},f.deps);expect(result.status).toBe('received');expect(f.received).toHaveBeenCalledOnce();expect(f.errors).toEqual([]);expect(f.journal.has(commsP2PContentPendingKey('alice'))).toBe(false);const stored=f.records.get('bob/'+packetId)!;expect(stored.acknowledgedAt).toBe(2000);expect(JSON.stringify(stored).includes('encryptedPayload')).toBe(false);expect(JSON.stringify(stored).includes('Synthetic opened')).toBe(false);const packet=JSON.parse((await decryptMemoryEnvelope(stored.enc)).text).packet;expect(packet.requestId).toBe(packetId);expect(packet.envelope).toEqual(envelope);f.stop();
});
it('lost wire ACK and status response preserve the journal and closed-gate confirmation does not resend',async()=>{
  const f=fixture();f.state.dropAck=true;f.state.failReceivedStatus=true;await expect(sendCommsP2PContent('alice',input,f.sender,()=>{},f.deps)).rejects.toThrow();const raw=f.journal.get(commsP2PContentPendingKey('alice'));expect(raw).toBeTruthy();f.state.failReceivedStatus=false;f.state.enabled=false;const sent=(f.channelA.send as ReturnType<typeof vi.fn>).mock.calls.length;expect((await confirmCommsP2PContent('alice',()=>{},f.deps)).status).toBe('received');expect((f.channelA.send as ReturnType<typeof vi.fn>).mock.calls.length).toBe(sent);expect(f.state.admitted).toBe(1);f.stop();
});
it('a failed transfer resumes the same UUID and ciphertext through a different room',async()=>{
  const f=fixture();f.state.dropData=true;await expect(sendCommsP2PContent('alice',input,f.sender,()=>{},f.deps)).rejects.toThrow();const raw=f.journal.get(commsP2PContentPendingKey('alice'))!,packet=JSON.parse((await decryptMemoryEnvelope(JSON.parse(raw))).text).packet;f.stop();f.create({...session,roomId:'77777777-7777-4777-8777-777777777777'});f.state.dropData=false;expect((await resumeCommsP2PContent('alice',f.sender,()=>{},f.deps)).status).toBe('received');const stored=f.records.get('bob/'+packetId)!;expect(JSON.parse((await decryptMemoryEnvelope(stored.enc)).text).packet).toEqual(packet);expect(f.received).toHaveBeenCalledOnce();f.stop();
});
it('local storage failure or decrypt failure cannot produce a recipient ACK',async()=>{
  const f=fixture();f.state.storeFailure=true;await expect(sendCommsP2PContent('alice',input,f.sender,()=>{},f.deps)).rejects.toThrow();expect(f.call.mock.calls.some(row=>row[0]==='ack')).toBe(false);expect(f.received).not.toHaveBeenCalled();expect(f.state.receipt?.status).toBe('admitted');expect(f.journal.has(commsP2PContentPendingKey('alice'))).toBe(true);f.stop();
});
it('unknown or admitted confirmation keeps the pending journal until explicit cancellation',async()=>{
  const f=fixture();f.state.dropData=true;await expect(sendCommsP2PContent('alice',input,f.sender,()=>{},f.deps)).rejects.toThrow();f.state.enabled=false;expect((await confirmCommsP2PContent('alice',()=>{},f.deps)).status).toBe('admitted');expect(f.journal.has(commsP2PContentPendingKey('alice'))).toBe(true);expect((await cancelCommsP2PContent('alice',()=>{},f.deps)).status).toBe('cancelled');expect(f.journal.has(commsP2PContentPendingKey('alice'))).toBe(false);f.stop();
});
it('a changed coffer or wrong recipient session cannot reconstruct or recipher a pending packet',async()=>{
  const f=fixture();f.state.dropData=true;await expect(sendCommsP2PContent('alice',input,f.sender,()=>{},f.deps)).rejects.toThrow();const raw=f.journal.get(commsP2PContentPendingKey('alice'));setMemoryCryptoMnemonic([...words].reverse());await expect(confirmCommsP2PContent('alice',()=>{},f.deps)).rejects.toThrow();expect(f.journal.get(commsP2PContentPendingKey('alice'))).toBe(raw);setMemoryCryptoMnemonic(words);const wrong={...f.sender,session:{...session,calleeUid:'carol'}};await expect(resumeCommsP2PContent('alice',wrong,()=>{},f.deps)).rejects.toThrow();expect(f.journal.get(commsP2PContentPendingKey('alice'))).toBe(raw);f.stop();
});
it('a forged wire ACK cannot clear the journal while the authenticated receipt is only admitted',async()=>{
  const f=fixture();f.state.dropData=true;
  (f.channelA.send as ReturnType<typeof vi.fn>).mockImplementation((wire:string)=>{const frame=JSON.parse(wire);if(frame.type==='manifest')queueMicrotask(()=>void f.sender.receive(JSON.stringify({v:1,type:'ack',roomId,transferId:frame.transferId,requestId:frame.requestId,digest:frame.packet.digest})));});
  await expect(sendCommsP2PContent('alice',input,f.sender,()=>{},f.deps)).rejects.toThrow();expect(f.state.receipt?.status).toBe('admitted');expect(f.records.size).toBe(0);expect(f.journal.has(commsP2PContentPendingKey('alice'))).toBe(true);f.stop();
});
it('canonical but altered ciphertext is rejected before recipient storage, opening or ACK',async()=>{
  const f=fixture();
  (f.channelA.send as ReturnType<typeof vi.fn>).mockImplementation((wire:string)=>{const frame=JSON.parse(wire);if(frame.type==='chunk'){const bytes=atob(frame.data),changed=bytes.replace('A'.repeat(43)+'=','B'+'A'.repeat(42)+'=');expect(changed).not.toBe(bytes);frame.data=btoa(changed);}queueMicrotask(()=>void f.receiver.receive(JSON.stringify(frame)).catch(error=>f.errors.push(error)));});
  await expect(sendCommsP2PContent('alice',input,f.sender,()=>{},f.deps)).rejects.toThrow();expect(f.errors.length).toBeGreaterThan(0);expect(f.records.size).toBe(0);expect(f.open).not.toHaveBeenCalled();expect(f.call.mock.calls.some(row=>row[0]==='ack')).toBe(false);expect(f.journal.has(commsP2PContentPendingKey('alice'))).toBe(true);f.stop();
});
it('retiring the recipient context during decryption preserves its encrypted copy without ACK or feedback',async()=>{
  const f=fixture();f.open.mockImplementation(async()=>{f.receiver.stop();return{message:'Synthetic retired packet',attachment:null};});
  await expect(sendCommsP2PContent('alice',input,f.sender,()=>{},f.deps)).rejects.toThrow();expect(f.records.has('bob/'+packetId)).toBe(true);expect(f.call.mock.calls.some(row=>row[0]==='ack')).toBe(false);expect(f.received).not.toHaveBeenCalled();expect(f.journal.has(commsP2PContentPendingKey('alice'))).toBe(true);f.stop();
});
it('a damaged encrypted row does not suppress a healthy copy and local reading never emits an ACK',async()=>{
  const f=fixture();await sendCommsP2PContent('alice',input,f.sender,()=>{},f.deps);f.stop();const original=f.records.get('bob/'+packetId)!;
  const badId='77777777-7777-4777-8777-777777777777',packet=JSON.parse((await decryptMemoryEnvelope(original.enc)).text).packet;packet.requestId=badId;
  const descriptor=await describeCommsP2PPacket(packet,()=>{}),enc=await encryptMemoryFields({text:JSON.stringify({v:1,uid:'bob',packet})});
  const bad={...original,requestId:badId,digest:descriptor.digest,bytes:descriptor.bytes,enc:{...enc,ct:(enc.ct[0]==='A'?'B':'A')+enc.ct.slice(1)}};f.records.set('bob/'+badId,bad);const preserved=JSON.stringify(bad);f.call.mockClear();f.open.mockClear();
  const deps={...f.deps,mutation:{uid:()=> 'bob',ready:()=>true,subscribe:()=>()=>{}}},page=await readCommsP2PInbox('bob',null,f.open,()=>{},deps);
  expect(page.rows.map(row=>row.packet.requestId)).toEqual([packetId]);expect(page.scanned).toBe(2);expect(page.unavailable).toBe(1);expect(page.next).toBeNull();expect(f.open).toHaveBeenCalledOnce();expect(f.call).not.toHaveBeenCalled();expect(JSON.stringify(f.records.get('bob/'+badId))).toBe(preserved);
});
it('local metadata digest and encrypted UID transplants remain unavailable without exposing another packet',async()=>{
  const f=fixture();await sendCommsP2PContent('alice',input,f.sender,()=>{},f.deps);f.stop();const original=f.records.get('bob/'+packetId)!,packet=JSON.parse((await decryptMemoryEnvelope(original.enc)).text).packet;
  const id='77777777-7777-4777-8777-777777777777',copy={...packet,requestId:id},descriptor=await describeCommsP2PPacket(copy,()=>{});
  f.records.set('bob/'+id,{...original,requestId:id,digest:descriptor.digest,bytes:descriptor.bytes,enc:await encryptMemoryFields({text:JSON.stringify({v:1,uid:'carol',packet:copy})})});
  f.records.set('bob/88888888-8888-4888-8888-888888888888',{...original,requestId:'88888888-8888-4888-8888-888888888888',digest:'f'.repeat(64)});
  const deps={...f.deps,mutation:{uid:()=> 'bob',ready:()=>true,subscribe:()=>()=>{}}};f.open.mockClear();f.call.mockClear();const page=await readCommsP2PInbox('bob',null,f.open,()=>{},deps);
  expect(page.rows).toHaveLength(1);expect(page.unavailable).toBe(2);expect(f.open).toHaveBeenCalledOnce();expect(f.call).not.toHaveBeenCalled();expect(f.records.size).toBe(3);
});
it('row decryption failures preserve the native page cursor and merge structural unavailable counts',async()=>{
  const f=fixture();await sendCommsP2PContent('alice',input,f.sender,()=>{},f.deps);f.stop();const original=f.records.get('bob/'+packetId)!,next={uid:'bob',key:['bob',['malformed-index-time'],[]]};
  f.store.page=async()=>({rows:[original],next,scanned:3,unavailable:2});const open=vi.fn(async()=>{throw Error('Synthetic missing historical key');}),deps={...f.deps,mutation:{uid:()=> 'bob',ready:()=>true,subscribe:()=>()=>{}}};f.call.mockClear();
  const page=await readCommsP2PInbox('bob',null,open,()=>{},deps);expect(page.rows).toHaveLength(0);expect(page.unavailable).toBe(3);expect(page.scanned).toBe(3);expect(page.next).toEqual(next);expect(f.records.size).toBe(1);expect(f.call).not.toHaveBeenCalled();
});
it('account context invalidation during opening fails the page instead of returning partial plaintext',async()=>{
  const f=fixture();await sendCommsP2PContent('alice',input,f.sender,()=>{},f.deps);f.stop();let valid=true;const deps={...f.deps,mutation:{uid:()=> 'bob',ready:()=>true,subscribe:()=>()=>{}}},guard=()=>{if(!valid)throw Error('Synthetic retired context');};
  const open=vi.fn(async()=>{valid=false;return{message:'Synthetic retired plaintext',attachment:null};});f.call.mockClear();await expect(readCommsP2PInbox('bob',null,open,guard,deps)).rejects.toThrow();expect(f.records.size).toBe(1);expect(f.call).not.toHaveBeenCalled();
});
it('an IndexedDB page failure remains a service error rather than an unavailable row',async()=>{
  const f=fixture();f.store.page=async()=>{throw Error('Synthetic read failure');};const deps={...f.deps,mutation:{uid:()=> 'bob',ready:()=>true,subscribe:()=>()=>{}}};await expect(readCommsP2PInbox('bob',null,f.open,()=>{},deps)).rejects.toThrow('Synthetic read failure');expect(f.open).not.toHaveBeenCalled();expect(f.call).not.toHaveBeenCalled();f.stop();
});
