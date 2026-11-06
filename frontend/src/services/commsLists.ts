import {getFunctions,httpsCallable} from 'firebase/functions';
import app from '../firebase';
import {withPersonalMemoryMutation,type PersonalMemoryMutationDeps} from './personalMemoryMutation';
import {parseCommsListRequest,parseCommsListPage,type CommsListKind,type CommsListCursor,type CommsListPage} from '../../../functions/src/commsListContract';
export type {CommsListKind,CommsListCursor};
export interface CommsPageProgress {busy:boolean;previous:boolean;next:boolean;unavailable:number;error:boolean;page:number}
export interface CommsPageSnapshot {docs:{id:string;data:()=>Record<string,unknown>}[]}
export interface CommsPageController {stop:()=>void;next:()=>void;previous:()=>void;refresh:()=>void}
export interface CommsPageDeps {call:(value:unknown)=>Promise<unknown>;mutation?:PersonalMemoryMutationDeps;setInterval:typeof window.setInterval;clearInterval:typeof window.clearInterval;visible:()=>boolean}
const defaults=():CommsPageDeps=>({call:async value=>(await httpsCallable(getFunctions(app,'europe-west1'),'listCommsPage')(value)).data,setInterval:window.setInterval.bind(window),clearInterval:window.clearInterval.bind(window),visible:()=>!document.hidden});
export async function readCommsPage(uid:string,kind:CommsListKind,after:CommsListCursor|null,outer:()=>void,deps=defaults()):Promise<CommsListPage>{
  const input=parseCommsListRequest({uid,kind,after});return withPersonalMemoryMutation(uid,async context=>{const guard=()=>{outer();context.assertCurrent();};guard();const value=await deps.call(input);guard();return parseCommsListPage(value,input);},deps.mutation);
}
export async function searchAcceptedCommsContact(uid:string,lookup:string,after:CommsListCursor|null,outer:()=>void,deps=defaults()):Promise<CommsListPage>{
  const input=parseCommsListRequest({uid,kind:'contact-search',after,lookup});
  return withPersonalMemoryMutation(uid,async context=>{const guard=()=>{outer();context.assertCurrent();};guard();const value=await deps.call(input);guard();return parseCommsListPage(value,input);},deps.mutation);
}
/** Keep one ciphertext page, serialize refreshes and retire both data and progress callbacks together. */
export function observeCommsPage(uid:string,kind:CommsListKind,guard:()=>void,onData:(value:CommsPageSnapshot)=>void,onProgress:(value:CommsPageProgress)=>void,isVisible=()=>true,deps=defaults()):CommsPageController {
  let active=true,busy=false,generation=0,after:CommsListCursor|null=null,next:CommsListCursor|null=null,history:(CommsListCursor|null)[]=[],last:string|null=null,unavailable=0,error=false;
  const live=()=>{if(!active)return false;try{guard();return true;}catch{return false;}};
  const progress=()=>{if(live())onProgress({busy,previous:history.length>0,next:next!==null,unavailable,error,page:history.length+1});};
  const load=async(clear=false)=>{
    if(!live()||busy)return;const observed=++generation;busy=true;error=false;progress();if(clear){last=null;onData({docs:[]});}
    try{const page=await readCommsPage(uid,kind,after,()=>{if(!live()||generation!==observed)throw Error('Comms page retired');},deps);if(!live()||generation!==observed)return;
      next=page.next;unavailable=page.unavailable;const serialized=JSON.stringify(page.rows);if(serialized!==last){last=serialized;onData({docs:page.rows.map(row=>({id:row.id,data:()=>structuredClone(row.data)}))});}
    }catch{if(live()&&generation===observed){error=true;next=null;last=null;onData({docs:[]});}}
    finally{if(generation===observed){busy=false;progress();}}
  };
  const timer=deps.setInterval(()=>{if(deps.visible()&&isVisible())void load();},30000);void load();
  return{stop:()=>{active=false;generation++;deps.clearInterval(timer);history=[];last=null;next=null;after=null;},refresh:()=>void load(),next:()=>{if(!live()||busy||!next)return;history.push(after);after=next;next=null;void load(true);},previous:()=>{if(!live()||busy||!history.length)return;after=history.pop()??null;next=null;void load(true);}};
}
