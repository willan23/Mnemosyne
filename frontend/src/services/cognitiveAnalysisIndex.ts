import { generateCognitiveInsights, InsightSignalCache } from './insightEngine';
import { buildCognitivePulse } from './cognitivePulse';
import { MemoryViewOrder } from './memoryViewOrder';
import { memoryViewId, type MemoryViewPatchCounts } from './memoryViewProtocol';
import { COGNITIVE_LIMITS as limits, cognitiveWeight, validateCognitiveWireRecord, type CognitiveMessage, type CognitiveWireRecord, type CognitiveWeight, type CognitiveAnalysis } from './cognitiveAnalysisProtocol';
const fail=()=>new Error('cognitive_analysis_unavailable');
const weightKeys=['units','vectors','connections','tags'] as const;
const emptyWeight=():CognitiveWeight=>({units:0,vectors:0,connections:0,tags:0});
function validate(row:CognitiveWireRecord):void {
  validateCognitiveWireRecord(row);
  // Coordinates have private transferred buffers and a readonly heuristic interface.
  Object.freeze(row.tags);Object.freeze(row.connections);Object.freeze(row);
}
/** The Worker owns plaintext/vectors only for the active authorized projection. No network or persistence. */
export class CognitiveAnalysisIndex {
  private records=new Map<string,CognitiveWireRecord>();private order=new MemoryViewOrder();private cache=new InsightSignalCache();
  private total=emptyWeight();private initialized=false;private seq=0;
  private patch:{reset:boolean;expected:MemoryViewPatchCounts;seen:Omit<MemoryViewPatchCounts,'size'>;touched:Set<string>;changed:Set<string>;removed:Set<string>;pruned:boolean}|null=null;
  clear():void{this.records.clear();this.order.clear();this.cache=new InsightSignalCache();this.total=emptyWeight();this.initialized=false;this.seq=0;this.patch=null;}
  private remove(id:string):void{const row=this.records.get(id);if(row){const weight=cognitiveWeight(row);for(const key of weightKeys)this.total[key]-=weight[key];this.records.delete(id);}}
  private prune():void{if(!this.patch!.pruned){for(const id of this.records.keys())if(!this.order.has(id))this.remove(id);this.patch!.pruned=true;}}
  handle(message:CognitiveMessage):{ack:true}|CognitiveAnalysis {
    try{
      if(!message||message.v!==1||!Number.isSafeInteger(message.seq)||message.seq<=this.seq)throw fail();this.seq=message.seq;
      if(message.type==='patch-start'&&!this.patch){
        const {reset,preserve,counts}=message;
        if(typeof reset!=='boolean'||typeof preserve!=='boolean'||!counts||!['size','changed','removed','moves','order'].every(key=>{const value=counts[key as keyof MemoryViewPatchCounts];return Number.isSafeInteger(value)&&value>=0&&value<=(key==='moves'?limits.changes:limits.documents);})||
          !reset&&(!preserve||!this.initialized)||!preserve&&!reset||reset&&(counts.order!==counts.size||counts.moves!==0||counts.removed!==0)||!reset&&counts.order!==0)throw fail();
        if(!preserve){this.records.clear();this.cache=new InsightSignalCache();this.total=emptyWeight();}if(reset)this.order.clear();
        this.patch={reset,expected:counts,seen:{changed:0,removed:0,moves:0,order:0},touched:new Set(),changed:new Set(),removed:new Set(),pruned:!reset};
      }else if(message.type==='patch-chunk'&&this.patch){
        const frame=message.frame,keys=Object.keys(frame??{});if(keys.length!==1||!['order','moves','removed','changed'].includes(keys[0]))throw fail();
        const key=keys[0] as keyof typeof frame,rows=frame[key],patch=this.patch;
        if(!Array.isArray(rows)||rows.length<1||rows.length>limits.batch||patch.seen[key]+rows.length>patch.expected[key]||
          key!=='order'&&patch.seen.order!==patch.expected.order||(key==='removed'||key==='changed')&&patch.seen.moves!==patch.expected.moves||key==='changed'&&patch.seen.removed!==patch.expected.removed)throw fail();
        if(key==='order'){if(!patch.reset||patch.seen.moves||patch.seen.removed||patch.seen.changed)throw fail();for(const id of frame.order!){this.order.append(id);patch.touched.add(id);}}
        else if(key==='moves'){if(patch.seen.removed||patch.seen.changed)throw fail();for(const move of frame.moves!){this.order.move(move);patch.touched.add(move.id);}}
        else if(key==='removed'){if(patch.seen.changed)throw fail();this.prune();for(const id of frame.removed!){if(!memoryViewId(id)||patch.removed.has(id)||!this.records.has(id))throw fail();patch.removed.add(id);patch.touched.add(id);this.remove(id);}}
        else{this.prune();for(const row of frame.changed!){validate(row);if(patch.changed.has(row.id)||patch.removed.has(row.id))throw fail();this.remove(row.id);const weight=cognitiveWeight(row);for(const at of weightKeys){this.total[at]+=weight[at];if(this.total[at]>limits[at])throw fail();}this.records.set(row.id,row);patch.changed.add(row.id);patch.touched.add(row.id);}}
        patch.seen[key]+=rows.length;if(this.records.size>limits.documents)throw fail();
      }else if(message.type==='patch-end'&&this.patch){
        const patch=this.patch;if(!Object.keys(patch.seen).every(key=>patch.seen[key as keyof typeof patch.seen]===patch.expected[key as keyof typeof patch.seen]))throw fail();this.prune();
        if(this.records.size!==patch.expected.size||this.order.size!==patch.expected.size)throw fail();for(const id of patch.touched)if(this.order.has(id)!==this.records.has(id))throw fail();this.patch=null;this.initialized=true;
      }else if(message.type==='query'&&!this.patch&&this.initialized){
        if(!Number.isFinite(message.now)||!['insights','pulse'].includes(message.mode))throw fail();const rows=Array.from(this.order.values(),id=>this.records.get(id)!);
        if(message.mode==='pulse')return{mode:'pulse',pulse:buildCognitivePulse(rows,message.now,this.cache)};
        const insights=generateCognitiveInsights(rows,message.now,this.cache);return{mode:'insights',insights,counts:{total:rows.length,linked:rows.filter(row=>row.connections.length>0).length,contradictions:insights.filter(row=>row.kind==='contradiction').length,orphans:insights.filter(row=>row.kind==='orphan').length}};
      }else throw fail();return{ack:true};
    }catch{this.clear();throw fail();}
  }
}
