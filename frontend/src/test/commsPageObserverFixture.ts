import {onSnapshot} from 'firebase/firestore';
import type {CommsListKind,CommsPageSnapshot,CommsPageProgress} from '../services/commsLists';
/** Adapter for earlier panel fixtures. Actual pagination is exercised by controller, emulator and browser tests. */
export function observeCommsPage(uid:string,kind:CommsListKind,guard:()=>void,onData:(value:CommsPageSnapshot)=>void,onProgress:(value:CommsPageProgress)=>void){
  const relay=kind.startsWith('relay-'),contact=kind.startsWith('contact-'),field=relay?(kind==='relay-in'?'recipientId':'senderId'):contact?(kind==='contact-in'?'toUid':'fromUid'):'calleeId';
  const subscribe=onSnapshot as unknown as(q:unknown,callback:(snapshot:CommsPageSnapshot)=>void)=>()=>void;
  const stop=subscribe({ref:{path:kind==='contact-directory'?'acceptedContacts':relay?'transmissions':contact?'friendRequests':'p2pRooms'},filters:[{field,value:uid}]},value=>{try{guard();}catch{return;}onData(value);onProgress({busy:false,previous:false,next:false,unavailable:0,error:false,page:1});});
  return{stop,refresh:()=>{},next:()=>{},previous:()=>{}};
}
