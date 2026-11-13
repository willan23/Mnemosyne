/** A task boundary for controlled preparation, without nested-timer clamping in the browser. */
export function createCognitiveAnalysisYield(){
  type Pause={resolve:()=>void;reject:()=>void;timer?:ReturnType<typeof setTimeout>};
  let channel:MessageChannel|null=null;const pauses:Pause[]=[];
  const yieldTask=()=>new Promise<void>((resolve,reject)=>{
    const pause:Pause={resolve,reject:()=>reject(new Error('cognitive_analysis_unavailable'))};pauses.push(pause);
    if(typeof window!=='undefined'&&typeof window.MessageChannel==='function'){
      if(!channel){const owned=new window.MessageChannel();channel=owned;owned.port1.onmessage=()=>{if(channel===owned)pauses.shift()?.resolve();};}
      channel.port2.postMessage(0);
    }else pause.timer=setTimeout(()=>{const at=pauses.indexOf(pause);if(at>=0){pauses.splice(at,1);pause.resolve();}},0);
  });
  const cancel=()=>{channel?.port1.close();channel?.port2.close();channel=null;for(const pause of pauses.splice(0)){if(pause.timer!==undefined)clearTimeout(pause.timer);pause.reject();}};
  return{yieldTask,cancel};
}
