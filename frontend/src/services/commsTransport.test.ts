import {beforeAll,expect,it,vi} from 'vitest';
import {generateRSAKeyPair,exportPublicKey,rsaEncrypt,encryptBytesAesGcm} from '../utils/crypto';
import {encryptCommsEnvelope,decryptCommsEnvelope,validateCommsEnvelope,validateCommsComposition,parseCommsP2PMessage,validateCommsIce,validateCommsSdp,COMMS_MAX_MESSAGE_BYTES,COMMS_MAX_ATTACHMENT_BYTES,COMMS_MAX_ENVELOPE_BYTES,type CommsComposition} from './commsTransport';
let keys:CryptoKeyPair,input:CommsComposition;
const b64=(bytes:Uint8Array)=>{let binary='';for(const value of bytes)binary+=String.fromCharCode(value);return btoa(binary);};
beforeAll(async()=>{keys=await generateRSAKeyPair();const pem=await exportPublicKey(keys.publicKey),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pem));input={message:'Synthetic cápsula de teste',attachment:null,publicKeyPem:pem,fingerprint:Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('')};});
function file(size:number,name='synthetic.txt',type='text/plain'){const bytes=new Uint8Array(size).fill(65),value=new File([bytes],name,{type});Object.defineProperty(value,'arrayBuffer',{value:async()=>bytes.slice().buffer});return value;}
it('round trips real RSA/AES at the attachment boundary with Unicode text and bounded wire bytes',async()=>{
  const captured={...input,attachment:file(COMMS_MAX_ATTACHMENT_BYTES)},sealed=await encryptCommsEnvelope(captured,()=>{}),opened=await decryptCommsEnvelope(sealed,keys.privateKey,()=>{});
  expect(opened.message).toBe(captured.message);expect(opened.attachment?.size).toBe(COMMS_MAX_ATTACHMENT_BYTES);expect(JSON.stringify(sealed).length).toBeLessThan(COMMS_MAX_ENVELOPE_BYTES);expect(opened.attachment?.dataUrl.startsWith('data:text/plain;base64,')).toBe(true);
});
it('does not accept a public key substituted after recipient fingerprint resolution',async()=>{
  const other=await generateRSAKeyPair(),pem=await exportPublicKey(other.publicKey);await expect(encryptCommsEnvelope({...input,publicKeyPem:pem},()=>{})).rejects.toThrow();
});
it('copies the composition before the first await and never adopts later caller edits',async()=>{
  const value={...input},promise=encryptCommsEnvelope(value,()=>{});value.message='Later caller text';const opened=await decryptCommsEnvelope(await promise,keys.privateKey,()=>{});expect(opened.message).toBe(input.message);
});
it('checks the context immediately after suspended public key hashing and does not continue encryption',async()=>{
  const digest=crypto.subtle.digest.bind(crypto.subtle);let finish!:()=>void;const pause=new Promise<void>(resolve=>finish=resolve);const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(...args)=>{const result=await digest(...args);await pause;return result;});let current=true;
  try{const pending=encryptCommsEnvelope(input,()=>{if(!current)throw Error('Synthetic retired context');});current=false;finish();await expect(pending).rejects.toThrow('Synthetic retired context');}finally{spy.mockRestore();}
});
it('enforces byte limits before file reads or encryption and rejects attachment names containing paths/control characters',async()=>{
  expect(()=>validateCommsComposition({...input,message:'é'.repeat(COMMS_MAX_MESSAGE_BYTES/2+1)})).toThrow();expect(()=>validateCommsComposition({...input,attachment:file(COMMS_MAX_ATTACHMENT_BYTES+1)})).toThrow();
  for(const filename of['../synthetic','a\\b','a\0b'])expect(()=>validateCommsComposition({...input,attachment:file(1,filename)})).toThrow();
});
it('rejects noncanonical base64, wrong IV sizes, mixed legacy/current envelopes and oversized ciphertext before private crypto',async()=>{
  const envelope=await encryptCommsEnvelope(input,()=>{});
  for(const mutation of[{payloadIv:btoa('short')},{encryptedKey:'!!!!'},{encryptedData:envelope.encryptedKey},{encryptedPayload:'A'.repeat(COMMS_MAX_ENVELOPE_BYTES+4)},{encryptedKey:envelope.encryptedKey.slice(0,-4)+'AB=='}])expect(()=>validateCommsEnvelope({...envelope,...mutation})).toThrow();
});
it('binds a P2P message to both the authenticated room peer and its recipient before decryption',async()=>{
  const envelope=await encryptCommsEnvelope(input,()=>{}),wire={type:'mnemosyne-transmission',senderId:'bob',recipientId:'alice',...envelope,timestamp:1,status:'p2p'};
  expect(parseCommsP2PMessage(JSON.stringify(wire),'bob','alice').senderId).toBe('bob');
  for(const changed of[{senderId:'carol'},{recipientId:'carol'},{extraAuthority:true},{timestamp:Infinity},{status:'received'}])expect(()=>parseCommsP2PMessage(JSON.stringify({...wire,...changed}),'bob','alice')).toThrow();
  expect(()=>parseCommsP2PMessage(new Blob(['synthetic']),'bob','alice')).toThrow();
});
async function attackerPayload(attachment:Record<string,unknown>|null,message:unknown=input.message){
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']),raw=await crypto.subtle.exportKey('raw',key);let content=attachment;
  if(content){const encrypted=await encryptBytesAesGcm(new Uint8Array([65,66]).buffer,key);content={...content,iv:encrypted.iv,data:b64(new Uint8Array(encrypted.cipherBytes))};}
  const sealed=await encryptBytesAesGcm(new TextEncoder().encode(JSON.stringify({message,attachment:content})).buffer as ArrayBuffer,key);
  return{encryptedKey:await rsaEncrypt(b64(new Uint8Array(raw)),keys.publicKey),encryptedPayload:b64(new Uint8Array(sealed.cipherBytes)),payloadIv:sealed.iv,hasAttachment:content!==null,attachmentName:content?.name as string??null};
}
it('checks decrypted attachment size against actual bytes and rejects non-string message bodies',async()=>{
  await expect(decryptCommsEnvelope(await attackerPayload({name:'synthetic.txt',type:'text/plain',size:3}),keys.privateKey,()=>{})).rejects.toThrow();
  await expect(decryptCommsEnvelope(await attackerPayload(null,{html:'Synthetic attacker body'}),keys.privateKey,()=>{})).rejects.toThrow();
});
it('does not turn authenticated but attacker controlled MIME into a navigable HTML or SVG data URL',async()=>{
  for(const type of['text/html','image/svg+xml','application/javascript']){const result=await decryptCommsEnvelope(await attackerPayload({name:'synthetic.bin',type,size:2}),keys.privateKey,()=>{});expect(result.attachment?.type).toBe('application/octet-stream');expect(result.attachment?.dataUrl.startsWith('data:application/octet-stream;base64,')).toBe(true);}
});
it('checks context after private decrypt so late plaintext cannot be returned',async()=>{
  const sealed=await encryptCommsEnvelope(input,()=>{});let checks=0;await expect(decryptCommsEnvelope(sealed,keys.privateKey,()=>{if(++checks===2)throw Error('Synthetic retired');})).rejects.toThrow('Synthetic retired');
});
it('only accepts bounded, role-specific SDP and candidate fields',()=>{
  expect(validateCommsSdp({type:'offer',sdp:'v=0'},'offer')).toEqual({type:'offer',sdp:'v=0'});expect(()=>validateCommsSdp({type:'answer',sdp:'v=0'},'offer')).toThrow();expect(()=>validateCommsSdp({type:'offer',sdp:'a'.repeat(32769)},'offer')).toThrow();
  expect(validateCommsIce({candidate:'candidate:synthetic',sdpMid:'0',sdpMLineIndex:0,usernameFragment:null}).candidate).toBe('candidate:synthetic');for(const value of[{candidate:'a'.repeat(4097)},{candidate:'x',sdpMLineIndex:-1},{candidate:'x',uid:'forged'}])expect(()=>validateCommsIce(value)).toThrow();
});
