import {attachmentIdValid} from '../../../functions/src/attachmentEnvelope';
import {commsBase64Size,commsDeliveryRequestBytes,parseCommsDeliveryRequest,COMMS_DELIVERY_MAX_WIRE_BYTES,type CommsDeliveryRequest} from '../../../functions/src/commsDeliveryContract';
import {parseCommsP2PContentDescriptor,assertCommsP2PPacketSession,type CommsP2PContentDescriptor} from '../../../functions/src/commsP2PContentContract';
import {parseCommsP2PBinding,type CommsP2PBinding} from '../../../functions/src/commsP2PContract';
export const COMMS_P2P_FRAME_BYTES=16*1024,COMMS_P2P_CHUNK_BYTES=8*1024,COMMS_P2P_MAX_CHUNKS=2048,COMMS_P2P_ASSEMBLY_MS=60000;
export class CommsP2PWireError extends Error {constructor(){super('Não foi possível validar os fragmentos P2P.');}}
interface Header {v:1;roomId:string;transferId:string;requestId:string}
export type CommsP2PFrame=(Header&{type:'manifest';packet:CommsP2PContentDescriptor;chunkBytes:number;chunks:number})|(Header&{type:'chunk';index:number;data:string})|(Header&{type:'commit'})|(Header&{type:'ack';digest:string});
function bad():never{throw new CommsP2PWireError();}
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:bad();
const sameKeys=(value:Record<string,unknown>,keys:string[])=>{if(Object.keys(value).sort().join(',')!==[...keys].sort().join(','))bad();};
export function parseCommsP2PFrame(value:unknown,session:CommsP2PBinding):CommsP2PFrame {
  if(typeof value!=='string'||value.length>COMMS_P2P_FRAME_BYTES||new TextEncoder().encode(value).length>COMMS_P2P_FRAME_BYTES)bad();let row:Record<string,unknown>;try{row=object(JSON.parse(value));}catch{return bad();}
  const keys=['v','type','roomId','transferId','requestId'];if(row.v!==1||row.roomId!==session.roomId||!attachmentIdValid(row.transferId)||!attachmentIdValid(row.requestId))bad();
  if(row.type==='manifest'){
    sameKeys(row,[...keys,'packet','chunkBytes','chunks']);const packet=parseCommsP2PContentDescriptor(row.packet);assertCommsP2PPacketSession(packet,session,false);if(row.requestId!==packet.requestId||!Number.isInteger(row.chunkBytes)||Number(row.chunkBytes)<128||Number(row.chunkBytes)>COMMS_P2P_CHUNK_BYTES||!Number.isInteger(row.chunks)||Number(row.chunks)<1||Number(row.chunks)>COMMS_P2P_MAX_CHUNKS||Number(row.chunks)!==Math.ceil(packet.bytes/Number(row.chunkBytes)))bad();return{v:1,type:'manifest',roomId:session.roomId,transferId:row.transferId,requestId:row.requestId,packet,chunkBytes:Number(row.chunkBytes),chunks:Number(row.chunks)};
  }
  if(row.type==='chunk'){sameKeys(row,[...keys,'index','data']);if(!Number.isInteger(row.index)||Number(row.index)<0||Number(row.index)>=COMMS_P2P_MAX_CHUNKS)bad();commsBase64Size(row.data,1,COMMS_P2P_CHUNK_BYTES);return{v:1,type:'chunk',roomId:session.roomId,transferId:row.transferId,requestId:row.requestId,index:Number(row.index),data:row.data as string};}
  if(row.type==='commit'){sameKeys(row,keys);return{v:1,type:'commit',roomId:session.roomId,transferId:row.transferId,requestId:row.requestId};}
  if(row.type==='ack'){sameKeys(row,[...keys,'digest']);if(typeof row.digest!=='string'||!/^[a-f0-9]{64}$/.test(row.digest))bad();return{v:1,type:'ack',roomId:session.roomId,transferId:row.transferId,requestId:row.requestId,digest:row.digest};}return bad();
}
const encode=(value:Uint8Array)=>{let result='';for(let i=0;i<value.length;i+=4096)result+=String.fromCharCode(...value.subarray(i,i+4096));return btoa(result);};
const decode=(value:string)=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
export function planCommsP2PTransfer(request:CommsDeliveryRequest,packet:CommsP2PContentDescriptor,sessionValue:CommsP2PBinding,transferId:string,maximum:number):string[] {
  const session=parseCommsP2PBinding(sessionValue);assertCommsP2PPacketSession(packet,session,true);const input=parseCommsDeliveryRequest(request),bytes=new TextEncoder().encode(commsDeliveryRequestBytes(input));if(!attachmentIdValid(transferId)||input.requestId!==packet.requestId||bytes.length!==packet.bytes||!Number.isFinite(maximum)||maximum<=0)bad();
  const cap=Math.min(Math.floor(maximum),COMMS_P2P_FRAME_BYTES),base={v:1 as const,roomId:session.roomId,transferId,requestId:packet.requestId};const overhead=new TextEncoder().encode(JSON.stringify({...base,type:'chunk',index:COMMS_P2P_MAX_CHUNKS-1,data:''})).length,chunkBytes=Math.min(COMMS_P2P_CHUNK_BYTES,Math.floor((cap-overhead)/4)*3);if(chunkBytes<128)bad();const chunks=Math.ceil(bytes.length/chunkBytes);if(chunks>COMMS_P2P_MAX_CHUNKS)bad();
  const frames=[JSON.stringify({...base,type:'manifest',packet,chunkBytes,chunks})];for(let index=0;index<chunks;index++)frames.push(JSON.stringify({...base,type:'chunk',index,data:encode(bytes.subarray(index*chunkBytes,Math.min(bytes.length,(index+1)*chunkBytes)))}));frames.push(JSON.stringify({...base,type:'commit'}));if(frames.some(value=>new TextEncoder().encode(value).length>cap))bad();return frames;
}
interface Assembly {manifest:Extract<CommsP2PFrame,{type:'manifest'}>;createdAt:number;parts:(Uint8Array|undefined)[];received:number;bytes:number}
export interface CommsP2PComplete {transferId:string;packet:CommsDeliveryRequest;descriptor:CommsP2PContentDescriptor}
/** Bounded storage for a single authenticated peer. No decryption or durable receipt is implied by reassembly. */
export class CommsP2PAssembler {
  private readonly session:CommsP2PBinding;private readonly slots=new Map<string,Assembly>();private reserved=0;private readonly now:()=>number;
  constructor(session:CommsP2PBinding,now:()=>number=Date.now){this.session=parseCommsP2PBinding(session);this.now=now;}
  clear(){this.slots.clear();this.reserved=0;}
  expire(){const now=this.now();for(const[id,slot]of this.slots)if(now-slot.createdAt>=COMMS_P2P_ASSEMBLY_MS){this.slots.delete(id);this.reserved-=slot.manifest.packet.bytes;}}
  accept(frame:CommsP2PFrame):CommsP2PComplete|null {
    this.expire();if(frame.roomId!==this.session.roomId||frame.type==='ack')return bad();
    if(frame.type==='manifest'){
      assertCommsP2PPacketSession(frame.packet,this.session,false);const old=this.slots.get(frame.transferId);if(old){if(JSON.stringify(old.manifest)!==JSON.stringify(frame))bad();return null;}
      if(this.slots.size>=2||this.reserved+frame.packet.bytes>2*COMMS_DELIVERY_MAX_WIRE_BYTES)bad();this.reserved+=frame.packet.bytes;this.slots.set(frame.transferId,{manifest:frame,createdAt:this.now(),parts:Array(frame.chunks),received:0,bytes:0});return null;
    }
    const slot=this.slots.get(frame.transferId);if(!slot||frame.requestId!==slot.manifest.requestId)bad();
    if(frame.type==='chunk'){
      if(frame.index>=slot.parts.length)bad();const value=decode(frame.data),expected=Math.min(slot.manifest.chunkBytes,slot.manifest.packet.bytes-frame.index*slot.manifest.chunkBytes);if(value.length!==expected)bad();const old=slot.parts[frame.index];if(old){if(old.length!==value.length||old.some((byte,index)=>byte!==value[index]))bad();return null;}slot.parts[frame.index]=value;slot.received++;slot.bytes+=value.length;return null;
    }
    if(slot.received!==slot.parts.length||slot.bytes!==slot.manifest.packet.bytes)bad();const bytes=new Uint8Array(slot.bytes);let offset=0;for(const part of slot.parts){if(!part)bad();bytes.set(part,offset);offset+=part.length;}
    let packet:CommsDeliveryRequest;try{const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);packet=parseCommsDeliveryRequest(JSON.parse(text));if(commsDeliveryRequestBytes(packet)!==text)bad();assertCommsP2PPacketSession(packet,this.session,false);}catch{return bad();}if(packet.requestId!==frame.requestId)bad();this.slots.delete(frame.transferId);this.reserved-=slot.manifest.packet.bytes;return{transferId:frame.transferId,packet,descriptor:slot.manifest.packet};
  }
}
