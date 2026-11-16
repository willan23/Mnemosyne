import {decryptTextAesGcm,deriveAesKeyFromMnemonic,encryptTextAesGcm} from '../utils/crypto';
import {withPersonalMemoryMutation} from './personalMemoryMutation';
import {withClipCaptureLock} from './clipCaptureService';
import {generatePairingKey,pairingPrivateKey} from './mobilePairingCrypto';
import {pairingPublicKey,pairingRecord} from '../../../functions/src/mobilePairingContract';

export interface DesktopSyncIdentity{publicKey:CryptoKey;privateKey:CryptoKey;publicKeyJwk:JsonWebKey;privateKeyJwk:JsonWebKey}
/** No mnemonic/private-handle cache; every open is scoped to this captured account/vault. */
export async function getOrCreateDesktopSyncIdentity(uid:string,mnemonic:string[]|null,outer:()=>void=()=>{}):Promise<DesktopSyncIdentity>{
  const words=mnemonic?[...mnemonic]:null;if(!words||words.length!==12)throw Error('Desbloqueia primeiro o cofre.');
  return withPersonalMemoryMutation(uid,scope=>withClipCaptureLock(`mnemosyne:desktop-sync:v2:${encodeURIComponent(uid)}`,async()=>{
    const keyName=`mnemosyne_desktop_sync_identity_${uid}`,raw=localStorage.getItem(keyName);let expected=raw,retired=false;
    const changed=(event:StorageEvent)=>{if(event.key===null||event.key===keyName)retired=true;};window.addEventListener('storage',changed);
    const guard=()=>{outer();scope.assertCurrent();if(retired||localStorage.getItem(keyName)!==expected)throw Error('Identidade alterada.');};
    try{guard();const vault=await deriveAesKeyFromMnemonic(words,`mnemosyne:desktop-sync:${uid}`);guard();
    let publicKeyJwk:JsonWebKey,privateKeyJwk:JsonWebKey;
    if(raw!==null){const body=pairingRecord(JSON.parse(await decryptTextAesGcm(JSON.parse(raw),vault)));guard();if(body.v!==undefined&&(body.v!==2||body.uid!==uid))throw Error('Identidade indisponível.');publicKeyJwk=pairingPublicKey(body.publicKeyJwk);privateKeyJwk=JSON.parse(JSON.stringify(pairingRecord(body.privateKeyJwk)));}
    else{const generated=await generatePairingKey(guard);guard();publicKeyJwk=generated.publicKeyJwk;privateKeyJwk=generated.privateKeyJwk;
      const sealed=JSON.stringify(await encryptTextAesGcm(JSON.stringify({v:2,uid,publicKeyJwk,privateKeyJwk}),vault));guard();if(localStorage.getItem(keyName)!==raw)throw Error('Identidade alterada.');localStorage.setItem(keyName,sealed);expected=sealed;guard();}
    const privateKey=await pairingPrivateKey(privateKeyJwk,publicKeyJwk,guard);guard();const publicKey=await crypto.subtle.importKey('jwk',publicKeyJwk,{name:'ECDH',namedCurve:'P-256'},false,[]);guard();return Object.freeze({publicKey,privateKey,publicKeyJwk,privateKeyJwk});
    }finally{retired=true;window.removeEventListener('storage',changed);}
  }));
}
