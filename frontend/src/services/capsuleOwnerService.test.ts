import {expect,it,vi} from 'vitest';
vi.mock('../firebase',()=>({default:{},auth:{currentUser:{uid:'alice'}}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:()=>()=>{}}));
vi.mock('firebase/functions',()=>({getFunctions:()=>({}),httpsCallable:()=>vi.fn()}));
import {createCapsuleOwnerService,type CapsuleOwnerClientDeps} from './capsuleOwnerService';
const row=(id='a')=>({shareId:id,sourceToken:'a'.repeat(64),createdAt:1,expiresAt:null,revoked:false,revokedAt:null,views:null,importCount:2,itemCount:1});
function fixture(){const state={uid:'alice'},listeners=new Set<()=>void>(),deps:CapsuleOwnerClientDeps={uid:()=>state.uid,observe:callback=>{listeners.add(callback);return()=>listeners.delete(callback);},call:vi.fn(async()=>({v:1,actorUid:'alice',rows:[row()],nextAfter:null}))};return{state,listeners,deps,service:createCapsuleOwnerService(deps)};}
it('owner metadata is strict, bounded and available without vault material',async()=>{
  const f=fixture(),page=await f.service.read();expect(page.rows[0]).toEqual(row());expect(f.deps.call).toHaveBeenCalledWith({v:1,actorUid:'alice',shareId:null,after:null});expect(f.listeners.size).toBe(0);
});
it('account ABA while metadata is pending rejects the page and unsubscribes',async()=>{
  const f=fixture();f.deps.call=vi.fn(async()=>{f.state.uid='bob';f.listeners.forEach(callback=>callback());f.state.uid='alice';return{v:1,actorUid:'alice',rows:[row()],nextAfter:null};});
  await expect(f.service.read()).rejects.toThrow();expect(f.listeners.size).toBe(0);
});
it('rejects foreign, oversized, duplicate, private-field and mismatched single-item responses',async()=>{
  for(const response of[{v:1,actorUid:'bob',rows:[row()],nextAfter:null},{v:1,actorUid:'alice',rows:[row(),row()],nextAfter:null},
    {v:1,actorUid:'alice',rows:[{...row(),title:'PRIVATE_FIELD'}],nextAfter:null},{v:1,actorUid:'alice',rows:Array.from({length:41},(_,index)=>row('m'+index)),nextAfter:null},
    {v:1,actorUid:'alice',rows:[row('b')],nextAfter:null},{v:1,actorUid:'alice',rows:[row()],nextAfter:'a'}]){
    const f=fixture();f.deps.call=vi.fn(async()=>response);await expect(f.service.read({shareId:'a'})).rejects.toThrow();expect(f.listeners.size).toBe(0);
  }
});
it('requires next cursor to match a full bounded page and rejects a repeated boundary',async()=>{
  const f=fixture(),rows=Array.from({length:40},(_,index)=>row(String(index).padStart(2,'0')));f.deps.call=vi.fn(async()=>({v:1,actorUid:'alice',rows,nextAfter:'39'}));
  expect((await f.service.read()).nextAfter).toBe('39');await expect(f.service.read({after:'39'})).rejects.toThrow();
});
