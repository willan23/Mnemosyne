import type {User} from 'firebase/auth';
import {getFunctions,httpsCallable} from 'firebase/functions';
import app from '../firebase';
import {COMMS_IDENTITY_PUBLICATION_ENABLED} from '../config/releaseGates';
import {parseCommsIdentityPublicationOutcome} from '../../../functions/src/commsIdentityPublicationContract';
import {clearIdentityVault,clearVolatileIdentities,getOrCreateIdentity,sha256ExactHex} from '../utils/crypto';
import {onMemoryCryptoChanged} from './memoryCrypto';
import {withPersonalMemoryMutation,type PersonalMemoryMutationDeps} from './personalMemoryMutation';
import {withClipCaptureLock} from './clipCaptureService';
import {hasPendingCommsIdentityRecovery,regenerateCommsIdentity} from './commsIdentityRollover';

export type CommsIdentity=Awaited<ReturnType<typeof getOrCreateIdentity>>;
export class CommsIdentityPublicationConflictError extends Error{
  constructor(){super('A chave publicada difere da identidade deste dispositivo. Recupera a identidade ou resolve a troca pendente antes de publicar.');}
}
export interface CommsIdentityDeps{
  context?:PersonalMemoryMutationDeps;
  identity:typeof getOrCreateIdentity;clear:typeof clearIdentityVault;hash:typeof sha256ExactHex;
  commit:(uid:string,identity:CommsIdentity,fingerprint:string,guard:()=>void)=>Promise<void>;
  exclusive:<T>(name:string,work:()=>Promise<T>)=>Promise<T>;
  hasPending?:(uid:string)=>boolean;
}
// Locking/switching the vault retires all cached private identity handles.
onMemoryCryptoChanged(clearVolatileIdentities);
const defaults=():CommsIdentityDeps=>({identity:getOrCreateIdentity,clear:clearIdentityVault,hash:sha256ExactHex,exclusive:withClipCaptureLock,hasPending:hasPendingCommsIdentityRecovery,
  commit:async(uid,identity,fingerprint,guard)=>{
    guard();let response:unknown;const mode=COMMS_IDENTITY_PUBLICATION_ENABLED?'publish':'check';
    try {response=(await httpsCallable(getFunctions(app,'europe-west1'),'publishCommsIdentityKey')({v:1,actorUid:uid,publicKeyPem:identity.pemPublic,mode})).data;}
    catch(error){guard();if(error&&typeof error==='object'&&'code'in error&&error.code==='functions/already-exists')throw new CommsIdentityPublicationConflictError();throw new Error('Não foi possível confirmar a publicação da identidade de Comms.');}
    guard();const result=parseCommsIdentityPublicationOutcome(response,uid,fingerprint);if(mode==='check'&&result.changed)throw new Error('Não foi possível confirmar a identidade sem alteração.');if(result.status!=='current')throw new Error('A publicação da identidade aguarda a ativação validada do servidor.');
  },
});
async function publish(user:User,mnemonic:string[]|null,outer:()=>void,deps:CommsIdentityDeps):Promise<CommsIdentity>{
  const uid=user.uid,words=mnemonic?[...mnemonic]:null;
  if(!words||words.length!==12)throw new Error('Desbloqueia primeiro a mnemónica para publicar a identidade de Comms.');
  return withPersonalMemoryMutation(uid,async context=>{
    const guard=()=>{outer();context.assertCurrent();if(deps.hasPending?.(uid))throw new Error('Recupera ou cancela a operação de identidade pendente.');};guard();
    return deps.exclusive(`mnemosyne:comms-identity:v1:${encodeURIComponent(uid)}`,async()=>{
      guard();
      const prepared=await deps.identity(uid,words,guard);guard();const identity=Object.freeze({publicKey:prepared.publicKey,privateKey:prepared.privateKey,pemPublic:prepared.pemPublic});
      const fingerprint=await deps.hash(identity.pemPublic);guard();
      await deps.commit(uid,identity,fingerprint,guard);guard();return identity;
    });
  },deps.context);
}
/** Account/vault and caller context stay captured through local key preparation and the atomic two-profile publication. */
export async function publishCommsIdentity(user:User,mnemonic:string[]|null,guard:()=>void=()=>{},deps=defaults()):Promise<CommsIdentity>{
  return publish(user,mnemonic,guard,deps);
}
/** Caller confirmation is required; regenerate retains both ciphertext identities before remote submission. */
export async function resetAndPublishCommsIdentity(user:User,mnemonic:string[]|null,guard:()=>void=()=>{}):Promise<CommsIdentity>{
  if(!mnemonic||mnemonic.length!==12)throw new Error('Desbloqueia primeiro a mnemónica.');return regenerateCommsIdentity(user.uid,[...mnemonic],guard);
}
