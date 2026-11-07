import {STARTER_FOUNDER_ID} from '../data/starterFounder';
export const starterAssimilationKey=(uid:string,starterId=STARTER_FOUNDER_ID)=>`mnemosyne.starter.assimilated.${starterId}.${uid}`;
export function hasAssimilatedStarter(uid:string,starterId=STARTER_FOUNDER_ID){try{return localStorage.getItem(starterAssimilationKey(uid,starterId))==='1';}catch{return false;}}
export function confirmStarterAssimilated(uid:string,guard:()=>void,starterId=STARTER_FOUNDER_ID){
  guard();const key=starterAssimilationKey(uid,starterId);
  try{if(localStorage.getItem(key)!=='1'){guard();localStorage.setItem(key,'1');}guard();if(localStorage.getItem(key)!=='1')throw new Error();}
  catch{guard();throw new Error('Não foi possível confirmar o estado do Universo inicial neste dispositivo.');}guard();
}
export function markStarterAssimilated(uid:string,starterId=STARTER_FOUNDER_ID){try{localStorage.setItem(starterAssimilationKey(uid,starterId),'1');}catch{/* Legacy preference setter; the import protocol uses verified confirmation. */}}
