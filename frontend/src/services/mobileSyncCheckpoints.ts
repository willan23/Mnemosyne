const event='mnemosyne:sync-checkpoints-changed';
export const notifySyncCheckpoints=()=>window.dispatchEvent(new Event(event));
export function observeSyncCheckpoints(callback:()=>void){
  window.addEventListener(event,callback);window.addEventListener('storage',callback);
  return()=>{window.removeEventListener(event,callback);window.removeEventListener('storage',callback);};
}
