import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {auth} from '../firebase';
import type {SessionData} from './useSessions';
import type {MemoryReadScope} from '../services/memoryReadScope';
import type {CognitiveMode} from '../services/cognitiveAnalysisProtocol';
import {CognitiveAnalysisClient,type CognitiveSelection} from '../services/cognitiveAnalysisClient';
import {isMemoryCryptoReady,onMemoryCryptoChanged} from '../services/memoryCrypto';
import {onTeamKeyChanged} from '../services/teamVault';
import {memorySnapshotDelta,memorySnapshotScopeActive} from '../services/memorySnapshot';
import {canReadCachedMemory} from '../services/memoryReadScope';
export function useCognitiveAnalysis(source:readonly SessionData[],scope:MemoryReadScope,mode:CognitiveMode,enabled=true){
  const activation=useMemo(()=>({scope,enabled,client:new CognitiveAnalysisClient(scope)}),[scope,enabled]);
  const current=useRef({source,scope,mode,enabled});useLayoutEffect(()=>{current.current={source,scope,mode,enabled};},[source,scope,mode,enabled]);
  const [retired,setRetired]=useState<readonly SessionData[]|null>(null),[attempt,setAttempt]=useState(0),retry=useCallback(()=>setAttempt(value=>value+1),[]);
  const [result,setResult]=useState<{client:CognitiveAnalysisClient;source:readonly SessionData[];mode:CognitiveMode;attempt:number;value:CognitiveSelection|null;error:boolean}|null>(null);
  const scheduler=useRef<(()=>void)|null>(null);
  useEffect(()=>()=>activation.client.dispose(),[activation]);
  useEffect(()=>{
    const retire=()=>{activation.client.dispose();setRetired(current.current.source);setResult(null);};
    const personal=onMemoryCryptoChanged(retire),team=onTeamKeyChanged(retire),account=onAuthStateChanged(auth,user=>{if(user?.uid!==activation.scope.uid)retire();});
    return()=>{personal();team();account();};
  },[activation]);
  useEffect(()=>{
    if(!activation.enabled||!activation.scope.uid){activation.client.dispose();return;}
    const controller=new AbortController();let active=true,running=false,requested=false,runningSource:readonly SessionData[]|null=null;
    const guard=()=>{const value=current.current;if(!active||!value.enabled||value.scope!==activation.scope||value.mode!==mode||auth.currentUser?.uid!==activation.scope.uid||!isMemoryCryptoReady())throw new Error('cognitive_analysis_unavailable');};
    const drain=()=>{requested=true;if(running){if(runningSource&&runningSource!==current.current.source){
        const delta=memorySnapshotScopeActive(runningSource)&&memorySnapshotScopeActive(current.current.source)?memorySnapshotDelta(runningSource,current.current.source):undefined;
        if(!delta||delta.removed.length||delta.changed.some(row=>row.encLocked||row.deletedAt||!canReadCachedMemory(row,activation.scope)))activation.client.dispose();
      }return;}running=true;
      void(async()=>{while(active&&requested){requested=false;const captured=current.current.source;if(retired===captured||!memorySnapshotScopeActive(captured))break;runningSource=captured;
        try{const value=await activation.client.select(captured,mode,controller.signal,guard);if(!active)break;if(current.current.source!==captured){requested=true;continue;}requested=false;setResult({client:activation.client,source:captured,mode,attempt,value,error:false});}
        catch{if(!active)break;if(current.current.source!==captured){requested=true;continue;}requested=false;setResult({client:activation.client,source:captured,mode,attempt,value:null,error:true});}
      }})().finally(()=>{running=false;runningSource=null;if(active&&requested)drain();});
    };
    scheduler.current=drain;return()=>{active=false;requested=false;if(scheduler.current===drain)scheduler.current=null;controller.abort();};
  },[activation,mode,retired,attempt]);
  useEffect(()=>{scheduler.current?.();},[source,activation,mode,retired,attempt]);
  const live=enabled&&Boolean(scope.uid)&&retired!==source&&memorySnapshotScopeActive(source),visible=live&&result?.client===activation.client&&result.source===source&&result.mode===mode&&result.attempt===attempt;
  return{analysis:visible?result.value?.analysis??null:null,ready:Boolean(visible&&!result.error),loading:live&&!visible,error:Boolean(visible&&result.error),retry,
    getMemory:(id:string)=>visible&&current.current.source===result.source&&current.current.scope===scope&&current.current.enabled&&current.current.mode===mode?result.value?.getMemory(id):undefined};
}
