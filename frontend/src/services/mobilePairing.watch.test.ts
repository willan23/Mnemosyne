import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({uid:'alice',authListeners:new Set<(user:{uid:string})=>void>(),subscriptions:[] as Array<{options:unknown;next:(value:unknown)=>void;failed:()=>void;stop:ReturnType<typeof vi.fn>}>}));
vi.mock('../firebase',()=>({auth:{get currentUser(){return{uid:state.uid};}},db:{},default:{}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:(user:{uid:string})=>void)=>{state.authListeners.add(callback);return()=>state.authListeners.delete(callback);}}));
vi.mock('./clipCaptureService',()=>({withClipCaptureLock:async(_key:string,work:()=>Promise<unknown>)=>work()}));
vi.mock('firebase/firestore',()=>({doc:(_db:unknown,...parts:string[])=>parts.join('/'),collection:(_db:unknown,...parts:string[])=>parts.join('/'),where:()=>({}),query:()=>({}),documentId:vi.fn(),getDocs:vi.fn(),getDocFromServer:vi.fn(),limit:vi.fn(),orderBy:vi.fn(),startAfter:vi.fn(),Timestamp:class{},onSnapshot:(_target:unknown,options:unknown,next:(value:unknown)=>void,failed:()=>void)=>{const stop=vi.fn();state.subscriptions.push({options,next,failed,stop});return stop;}}));
import {watchTrustedDevices,watchMobilePairingInvite} from './mobilePairing';
beforeEach(()=>{state.uid='alice';state.authListeners.clear();state.subscriptions=[];});
it('waits for server-confirmed metadata, exposes read failure separately and never fabricates an empty list',()=>{
  const changed=vi.fn(),failed=vi.fn(),stop=watchTrustedDevices('alice',changed,failed),subscription=state.subscriptions[0],row={deviceId:'phone',ownerUid:'alice',status:'active',pairedAt:1};expect(subscription.options).toEqual({includeMetadataChanges:true});
  subscription.next({metadata:{fromCache:true},docs:[{data:()=>row}]});expect(changed).not.toHaveBeenCalled();subscription.next({metadata:{fromCache:false},docs:[{data:()=>row}]});expect(changed).toHaveBeenLastCalledWith([row]);subscription.failed();expect(failed).toHaveBeenCalledOnce();expect(changed).toHaveBeenCalledTimes(1);stop();expect(subscription.stop).toHaveBeenCalledOnce();
});
it('pairing reads ignore cache, reject a foreign row and permanently retire late callbacks after account ABA',()=>{
  const changed=vi.fn(),failed=vi.fn(),id='P'.repeat(24),stop=watchMobilePairingInvite(id,changed,failed),subscription=state.subscriptions[0],row={version:2,ownerUid:'alice',pairingId:id,status:'accepted'};expect(subscription.options).toEqual({includeMetadataChanges:true});
  subscription.next({metadata:{fromCache:true},exists:()=>true,data:()=>row});expect(changed).not.toHaveBeenCalled();subscription.next({metadata:{fromCache:false},exists:()=>true,data:()=>row});expect(changed).toHaveBeenLastCalledWith(row);subscription.next({metadata:{fromCache:false},exists:()=>true,data:()=>({...row,ownerUid:'bob'})});expect(changed).toHaveBeenLastCalledWith(null);
  state.uid='bob';state.authListeners.forEach(callback=>callback({uid:'bob'}));state.uid='alice';state.authListeners.forEach(callback=>callback({uid:'alice'}));const calls=changed.mock.calls.length;subscription.next({metadata:{fromCache:false},exists:()=>true,data:()=>row});subscription.failed();expect(changed).toHaveBeenCalledTimes(calls);expect(failed).not.toHaveBeenCalled();stop();expect(subscription.stop).toHaveBeenCalledOnce();
});
