import {CognitiveAnalysisIndex} from './cognitiveAnalysisIndex';
import type {CognitiveMessage} from './cognitiveAnalysisProtocol';
const index=new CognitiveAnalysisIndex();
self.addEventListener('message',(event:MessageEvent<CognitiveMessage>)=>{
  const seq=Number.isSafeInteger(event.data?.seq)?event.data.seq:null;
  try{self.postMessage({v:1,seq,ok:true,...index.handle(event.data)});}
  catch{index.clear();self.postMessage({v:1,seq,ok:false});}
});
