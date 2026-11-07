import {attachmentActorIdValid} from './attachmentEnvelope';
import {commsTransmissionBytes} from './commsDeliveryContract';
import {parseCommsP2PBinding,COMMS_P2P_SESSION_MS} from './commsP2PContract';
import {parseCommsRecipient,parseCommsRecipientLookup} from './commsContactContract';
export const COMMS_LIST_PAGE_SIZE=25,COMMS_LIST_MAX_RESPONSE_BYTES=2*1024*1024;
export type CommsListKind='relay-in'|'relay-out'|'contact-in'|'contact-out'|'contact-directory'|'contact-search'|'room-in';
export interface CommsListCursor {uid:string;kind:CommsListKind;id:string;lookup?:string;targetUid?:string}
export interface CommsListRequest {uid:string;kind:CommsListKind;after:CommsListCursor|null;lookup?:string}
export interface CommsListRow {id:string;data:Record<string,unknown>}
export interface CommsListPage {uid:string;kind:CommsListKind;rows:CommsListRow[];next:CommsListCursor|null;unavailable:number;scanned:number}
const kinds=['relay-in','relay-out','contact-in','contact-out','contact-directory','contact-search','room-in'],invalid=()=>new Error('Invalid Comms page');
const cursorId=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value!=='.'&&value!=='..'&&!value.includes('/')&&new TextEncoder().encode(value).length<=1500;
export function compareCommsDocumentIds(a:string,b:string){const first=new TextEncoder().encode(a),second=new TextEncoder().encode(b);for(let i=0;i<Math.min(first.length,second.length);i++)if(first[i]!==second[i])return first[i]-second[i];return first.length-second.length;}
function object(value:unknown,keys?:string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||keys&&Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw invalid();return value as Record<string,unknown>;}
export function parseCommsListRequest(value:unknown):CommsListRequest {
  const raw=object(value),search=raw.kind==='contact-search',row=object(value,search?['uid','kind','after','lookup']:['uid','kind','after']);if(!attachmentActorIdValid(row.uid)||!kinds.includes(String(row.kind)))throw invalid();let after:CommsListCursor|null=null;
  const lookup=search?parseCommsRecipientLookup({lookup:row.lookup}).lookup:undefined;
  if(row.after!==null){const cursor=object(row.after,search?['uid','kind','id','lookup','targetUid']:['uid','kind','id']);if(cursor.uid!==row.uid||cursor.kind!==row.kind||!cursorId(cursor.id)||search&&(cursor.lookup!==lookup||!attachmentActorIdValid(cursor.targetUid)||cursor.targetUid===row.uid))throw invalid();after={uid:cursor.uid as string,kind:cursor.kind as CommsListKind,id:cursor.id,...(search?{lookup,targetUid:cursor.targetUid as string}:{})};}
  return{uid:row.uid,kind:row.kind as CommsListKind,after,...(search?{lookup}:{})};
}
export const commsListBinding=(kind:CommsListKind)=>kind.startsWith('relay-')?{collection:'transmissions',owner:kind==='relay-in'?'recipientId':'senderId',other:kind==='relay-in'?'senderId':'recipientId'}:kind.startsWith('contact-')?{collection:'friendRequests',owner:kind==='contact-in'?'toUid':'fromUid',other:kind==='contact-in'?'fromUid':'toUid'}:{collection:'p2pRooms',owner:'calleeId',other:'callerId'};
/** Explicit projection: stored extra fields never become a callable response. */
export function projectCommsListRow(input:CommsListRequest,id:string,value:unknown):CommsListRow {
  const data=object(value);
  if(input.kind==='contact-directory'||input.kind==='contact-search'){
    if(!attachmentActorIdValid(id)||!attachmentActorIdValid(data.fromUid)||!attachmentActorIdValid(data.toUid)||
      data.fromUid===data.toUid||![data.fromUid,data.toUid].includes(input.uid)||data.status!=='accepted'||
      !Number.isSafeInteger(data.createdAt)||Number(data.createdAt)<1||!Number.isSafeInteger(data.updatedAt)||Number(data.updatedAt)<Number(data.createdAt))throw invalid();
    const peer=data.fromUid===input.uid?data.toUid:data.fromUid,profile=parseCommsRecipient({uid:data.uid,displayName:data.displayName,publicKeyPem:data.publicKeyPem,fingerprint:data.fingerprint});
    if(profile.uid!==peer||input.after?.targetUid!==undefined&&profile.uid!==input.after.targetUid||input.kind==='contact-search'&&!input.lookup?.includes('@')&&profile.uid!==input.lookup)throw invalid();
    return{id,data:{fromUid:data.fromUid,toUid:data.toUid,status:'accepted',createdAt:data.createdAt,updatedAt:data.updatedAt,...profile}};
  }
  const binding=commsListBinding(input.kind),other=data[binding.other];if(!attachmentActorIdValid(id)||data[binding.owner]!==input.uid||!attachmentActorIdValid(other)||other===input.uid)throw invalid();
  let result:Record<string,unknown>;
  if(input.kind.startsWith('relay-')){
    commsTransmissionBytes(id,data);if(!(data.v===2?['sent','received']:['sent','received','failed']).includes(String(data.status))||!Number.isSafeInteger(data.timestamp)||Number(data.timestamp)<1)throw invalid();result={senderId:data.senderId,recipientId:data.recipientId,timestamp:data.timestamp,status:data.status};
    const names=data.v===2?['v','senderFingerprint','recipientFingerprint','deliveryDigest','encryptedKey','encryptedPayload','payloadIv','hasAttachment','attachmentName']:data.encryptedData!==undefined?['encryptedData']:['encryptedKey','encryptedPayload','payloadIv','hasAttachment','attachmentName'];
    for(const name of names)result[name]=data[name];if(data.v===2&&(typeof data.deliveryDigest!=='string'||!/^[a-f0-9]{64}$/.test(data.deliveryDigest)))throw invalid();
    if(data.status==='received'){if(!Number.isSafeInteger(data.receivedAt)||Number(data.receivedAt)<Number(data.timestamp))throw invalid();result.receivedAt=data.receivedAt;}
  }else if(input.kind.startsWith('contact-')){
    if(!['pending','accepted','rejected','cancelled'].includes(String(data.status))||!Number.isSafeInteger(data.createdAt)||Number(data.createdAt)<1||!Number.isSafeInteger(data.updatedAt)||Number(data.updatedAt)<Number(data.createdAt))throw invalid();
    const label=(value:unknown,uid:unknown)=>typeof value==='string'&&value.trim()?value.trim().slice(0,120):String(uid).slice(0,120);
    result={fromUid:data.fromUid,toUid:data.toUid,fromLabel:label(data.fromLabel,data.fromUid),toLabel:label(data.toLabel,data.toUid),status:data.status,createdAt:data.createdAt,updatedAt:data.updatedAt};
  }else{
    if(!['offer','active','closed'].includes(String(data.status)))throw invalid();result={callerId:data.callerId,calleeId:data.calleeId,callerLabel:typeof data.callerLabel==='string'?data.callerLabel.slice(0,120):String(data.callerId),status:data.status};
    if(data.offer!==undefined){const offer=object(data.offer,['type','sdp']);if(offer.type!=='offer'||typeof offer.sdp!=='string'||offer.sdp.length<1||new TextEncoder().encode(offer.sdp).length>32768)throw invalid();result.offer={type:'offer',sdp:offer.sdp};}else if(data.status==='offer')throw invalid();
    if(data.v===2){parseCommsP2PBinding({roomId:id,actorUid:input.uid,callerUid:data.callerId,calleeUid:data.calleeId,callerFingerprint:data.callerFingerprint,calleeFingerprint:data.calleeFingerprint,offerDigest:data.offerDigest});if(!Number.isSafeInteger(data.createdAt)||Number(data.createdAt)<1||data.expiresAt!==Number(data.createdAt)+COMMS_P2P_SESSION_MS)throw invalid();Object.assign(result,{v:2,callerFingerprint:data.callerFingerprint,calleeFingerprint:data.calleeFingerprint,offerDigest:data.offerDigest,createdAt:data.createdAt,expiresAt:data.expiresAt});}
  }
  return{id,data:result};
}
export function parseCommsListPage(value:unknown,input:CommsListRequest):CommsListPage {
  const row=object(value,['uid','kind','rows','next','unavailable','scanned']);if(row.uid!==input.uid||row.kind!==input.kind||!Array.isArray(row.rows)||row.rows.length>COMMS_LIST_PAGE_SIZE||!Number.isSafeInteger(row.unavailable)||Number(row.unavailable)<0||!Number.isSafeInteger(row.scanned)||Number(row.scanned)<row.rows.length+Number(row.unavailable)||Number(row.scanned)>COMMS_LIST_PAGE_SIZE)throw invalid();
  const rows=row.rows.map(value=>{const row=object(value,['id','data']),projected=projectCommsListRow(input,String(row.id),row.data);if(JSON.stringify(projected.data)!==JSON.stringify(row.data))throw invalid();return projected;});
  const next=parseCommsListRequest({...input,after:row.next}).after;
  if(input.kind==='contact-search'&&(new Set(rows.map(row=>row.data.uid)).size>1||next&&rows.some(row=>row.data.uid!==next.targetUid)))throw invalid();
  const ids=rows.map(row=>row.id);if(new Set(ids).size!==ids.length||ids.some((id,index)=>input.after!==null&&compareCommsDocumentIds(id,input.after.id)<=0||index>0&&compareCommsDocumentIds(id,ids[index-1])<=0)||next&&(input.after!==null&&compareCommsDocumentIds(next.id,input.after.id)<=0||ids.some(id=>compareCommsDocumentIds(id,next.id)>0)))throw invalid();
  const result={uid:input.uid,kind:input.kind,rows,next,unavailable:Number(row.unavailable),scanned:Number(row.scanned)};if(new TextEncoder().encode(JSON.stringify(result)).length>COMMS_LIST_MAX_RESPONSE_BYTES)throw invalid();return result;
}
