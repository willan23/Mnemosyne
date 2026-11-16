import {pairingPublicKey} from '../../../functions/src/mobilePairingContract';

const bytes=(text:string)=>{const raw=atob(text.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(text.length/4)*4,'='));return Uint8Array.from(raw,char=>char.charCodeAt(0)).buffer;};
export const pairingBase64=(data:Uint8Array)=>{let result='';for(let offset=0;offset<data.length;offset+=8192)result+=String.fromCharCode(...data.subarray(offset,offset+8192));return btoa(result).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');};
export const pairingDecode=(text:string)=>new TextDecoder('utf-8',{fatal:true}).decode(bytes(text));
export async function pairingPrivateKey(privateJwk:JsonWebKey,publicJwk:JsonWebKey,guard:()=>void){
  const publicKey=pairingPublicKey(publicJwk),own=pairingPublicKey({kty:privateJwk.kty,crv:privateJwk.crv,x:privateJwk.x,y:privateJwk.y});
  if(Object.keys(privateJwk).some(key=>!['kty','crv','x','y','d','ext','key_ops'].includes(key))||JSON.stringify(own)!==JSON.stringify(publicKey)||typeof privateJwk.d!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(privateJwk.d))throw Error('Invalid pairing key');
  const captured={...own,d:privateJwk.d,ext:false};
  const privateKey=await crypto.subtle.importKey('jwk',{...captured,key_ops:['deriveBits']},{name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);guard();
  const peer=await crypto.subtle.importKey('jwk',publicKey,{name:'ECDH',namedCurve:'P-256'},false,[]);guard();
  const probe=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);guard();
  const a=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:probe.publicKey},privateKey,256));guard();
  const b=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:peer},probe.privateKey,256));guard();
  if(a.length!==b.length||a.some((value,index)=>value!==b[index]))throw Error('Inconsistent pairing key');
  const handle=await crypto.subtle.importKey('jwk',{...captured,key_ops:['deriveKey']},{name:'ECDH',namedCurve:'P-256'},false,['deriveKey']);guard();return handle;
}
export async function generatePairingKey(guard:()=>void){
  const keys=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveKey']);guard();
  const publicKeyJwk=pairingPublicKey(await crypto.subtle.exportKey('jwk',keys.publicKey));guard();const privateKeyJwk=await crypto.subtle.exportKey('jwk',keys.privateKey);guard();
  return{publicKeyJwk,privateKeyJwk,privateKey:await pairingPrivateKey(privateKeyJwk,publicKeyJwk,guard)};
}
async function shared(privateKey:CryptoKey,publicJwk:JsonWebKey,guard:()=>void){
  const publicKey=await crypto.subtle.importKey('jwk',pairingPublicKey(publicJwk),{name:'ECDH',namedCurve:'P-256'},false,[]);guard();
  const key=await crypto.subtle.deriveKey({name:'ECDH',public:publicKey},privateKey,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);guard();return key;
}
export async function encryptPairingHandshake(value:unknown,privateKey:CryptoKey,peer:JsonWebKey,guard:()=>void){
  const key=await shared(privateKey,peer,guard),iv=crypto.getRandomValues(new Uint8Array(12));
  const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(value)));guard();return{iv:pairingBase64(iv),data:pairingBase64(new Uint8Array(data))};
}
export async function decryptPairingHandshake(cipher:{iv:string;data:string},privateKey:CryptoKey,peer:JsonWebKey,guard:()=>void):Promise<unknown>{
  const key=await shared(privateKey,peer,guard),plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(cipher.iv)},key,bytes(cipher.data));guard();return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));
}
