import {onAuthStateChanged} from 'firebase/auth';
import {getFunctions,httpsCallable} from 'firebase/functions';
import app,{auth} from '../firebase';
import {captureCapsuleOwnerQuery,captureOwnedCapsule,type OwnedCapsule,type CapsuleOwnerQuery} from '../../../functions/src/capsuleOwnerContract';
import {publicCapsuleRecord,publicCapsuleIdValid} from '../../../functions/src/publicCapsuleContract';
export type {OwnedCapsule} from '../../../functions/src/capsuleOwnerContract';
export class CapsuleOwnerError extends Error{constructor(){super('Não foi possível consultar as cápsulas. Tenta novamente.');}}
export interface CapsuleOwnerClientDeps{uid:()=>string|null;observe:(changed:()=>void)=>()=>void;call:(input:CapsuleOwnerQuery)=>Promise<unknown>}
const defaults=():CapsuleOwnerClientDeps=>({uid:()=>auth.currentUser?.uid??null,observe:changed=>{const uid=auth.currentUser?.uid;return onAuthStateChanged(auth,user=>{if(user?.uid!==uid)changed();});},
  call:async input=>(await httpsCallable(getFunctions(app,'europe-west1'),'getOwnedCapsules')(input)).data});
export function createCapsuleOwnerService(deps=defaults()){
  return{async read(options:{shareId?:string;after?:string}={},current:()=>boolean=()=>true):Promise<{rows:readonly OwnedCapsule[];nextAfter:string|null}>{
    const uid=deps.uid();let retired=false;const stop=deps.observe(()=>{retired=true;});const guard=()=>{if(retired||!uid||deps.uid()!==uid||!current())throw new CapsuleOwnerError();};
    try{guard();const input=captureCapsuleOwnerQuery({v:1,actorUid:uid,shareId:options.shareId??null,after:options.after??null});
      const result=await deps.call(input);guard();const row=publicCapsuleRecord(result,['v','actorUid','rows','nextAfter']);
      if(row.v!==1||row.actorUid!==uid||!Array.isArray(row.rows)||row.rows.length>40||row.nextAfter!==null&&!publicCapsuleIdValid(row.nextAfter))throw new CapsuleOwnerError();
      const rows=row.rows.map(captureOwnedCapsule);
      if(new Set(rows.map(row=>row.shareId)).size!==rows.length||input.shareId&&(rows.length>1||rows.some(row=>row.shareId!==input.shareId))||
        input.shareId&&row.nextAfter!==null||row.nextAfter!==null&&(rows.length!==40||rows[rows.length-1].shareId!==row.nextAfter)||input.after&&rows.some(row=>row.shareId===input.after))throw new CapsuleOwnerError();
      return Object.freeze({rows:Object.freeze(rows),nextAfter:row.nextAfter as string|null});
    }catch{throw new CapsuleOwnerError();}finally{stop();}
  }};
}
export const capsuleOwnerService=createCapsuleOwnerService();
