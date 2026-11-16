/** Experimental evaluation policy; never imported by the application. No labels or query intent rules. */
export const COEVIDENCE_POLICY=Object.freeze({v:1,candidateLimit:16,denseFloor:.82,maxNeighbors:4,aggregate:'max-single-or-pair',tieBreak:'single-then-original-order'});
/** Proposed evaluation-only extensions; callers must opt in explicitly. This is not an application default. */
export const COEVIDENCE_EVALUATION_POLICY_V2=Object.freeze({...COEVIDENCE_POLICY,v:2,minPairLogitGain:1,propagateDenseFloor:.95});
const fail=()=>{throw Error('invalid_coevidence_input');};
function candidatesById(candidates){
 if(!Array.isArray(candidates)||candidates.length>COEVIDENCE_POLICY.candidateLimit)fail();const ids=new Map();
 candidates.forEach((row,index)=>{if(!row||typeof row.id!=='string'||!row.id||row.id.length>256||ids.has(row.id)||typeof row.text!=='string'||row.encLocked||row.deletedAt!=null||row.teamScopeAmbiguous)fail();ids.set(row.id,index);});return ids;
}
const normalize=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function surfaceAnchors(text,scoringTerms){
 const terms=new Set(scoringTerms(text));return new Set([...text.matchAll(/(?:^|[^\p{L}\p{N}])([\p{Lu}][\p{L}\p{N}_-]{2,})/gu)]
  .flatMap(match=>normalize(match[1]).split(/[_-]/)).filter(term=>terms.has(term)));
}
function denseSimilarity(left,right){
 if(typeof left.embeddingModel!=='string'||!left.embeddingModel||left.embeddingModel!==right.embeddingModel||!Array.isArray(left.embedding)||!Array.isArray(right.embedding)||!left.embedding.length||left.embedding.length>4096||left.embedding.length!==right.embedding.length)return null;
 let dot=0,a=0,b=0;for(let index=0;index<left.embedding.length;index++){const x=left.embedding[index],y=right.embedding[index];if(typeof x!=='number'||typeof y!=='number'||!Number.isFinite(x)||!Number.isFinite(y))return null;dot+=x*y;a+=x*x;b+=y*y;}
 const score=dot/(Math.sqrt(a)*Math.sqrt(b));return Number.isFinite(score)?Math.max(-1,Math.min(1,score)):null;
}
/** Input must already pass the real ACL and query filters. The guard flags also fail closed here. */
export function buildCoEvidencePairs(candidates,{scoringTerms,denseFloor=COEVIDENCE_POLICY.denseFloor,maxNeighbors=COEVIDENCE_POLICY.maxNeighbors}={}){
 candidatesById(candidates);if(typeof scoringTerms!=='function'||!Number.isFinite(denseFloor)||denseFloor<0||denseFloor>1||!Number.isInteger(maxNeighbors)||maxNeighbors<1||maxNeighbors>15)fail();
 const anchors=candidates.map(row=>surfaceAnchors(row.text,scoringTerms)),edges=[];
 for(let a=0;a<candidates.length;a++)for(let b=a+1;b<candidates.length;b++){
  const dense=denseSimilarity(candidates[a],candidates[b]),shared=[...anchors[a]].filter(term=>anchors[b].has(term)).length,denseEligible=dense!==null&&dense>=denseFloor;
  if(denseEligible||shared)edges.push({a,b,denseSimilarity:dense,denseEligible,sharedAnchorCount:shared});
 }
 const selected=new Map();for(let index=0;index<candidates.length;index++){
  const nearby=edges.filter(edge=>edge.a===index||edge.b===index).sort((left,right)=>Number(right.denseEligible)-Number(left.denseEligible)||(right.denseSimilarity??-1)-(left.denseSimilarity??-1)||right.sharedAnchorCount-left.sharedAnchorCount||left.a-right.a||left.b-right.b).slice(0,maxNeighbors);
  for(const edge of nearby)selected.set(edge.a+':'+edge.b,edge);
 }
 return [...selected.values()].sort((left,right)=>left.a-right.a||left.b-right.b).map(edge=>({leftId:candidates[edge.a].id,rightId:candidates[edge.b].id,denseSimilarity:edge.denseSimilarity,sharedAnchorCount:edge.sharedAnchorCount}));
}
const validScore=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1;
const logit=value=>{const clipped=Math.max(1e-6,Math.min(1-1e-6,value));return Math.log(clipped/(1-clipped));};
/** A relevance score is not a probability of truth or proof that either passage answers the question. */
export function rankCoEvidence(candidates,singleScores,pairScores,{floor,limit,minPairLogitGain,propagateDenseFloor}={}){
 const ids=candidatesById(candidates);if(!(singleScores instanceof Map)||singleScores.size!==ids.size||!Array.isArray(pairScores)||pairScores.length>candidates.length*15||!validScore(floor)||!Number.isInteger(limit)||limit<1||limit>100)fail();
 if(minPairLogitGain!==undefined&&(!Number.isFinite(minPairLogitGain)||minPairLogitGain<0)||propagateDenseFloor!==undefined&&!validScore(propagateDenseFloor))fail();
 const rows=new Map(candidates.map((row,index)=>{const score=singleScores.get(row.id);if(!validScore(score))fail();return[row.id,{id:row.id,relevance:score,singleRelevance:score,index}];}));
 for(const id of singleScores.keys())if(!ids.has(id))fail();const seen=new Set();
 for(const pair of pairScores){if(!pair||!ids.has(pair.leftId)||!ids.has(pair.rightId)||pair.leftId===pair.rightId||!validScore(pair.score))fail();const key=[ids.get(pair.leftId),ids.get(pair.rightId)].sort((a,b)=>a-b).join(':');if(seen.has(key))fail();seen.add(key);
  if(propagateDenseFloor!==undefined&&pair.denseSimilarity!=null&&(typeof pair.denseSimilarity!=='number'||!Number.isFinite(pair.denseSimilarity)||pair.denseSimilarity< -1||pair.denseSimilarity>1))fail();
  for(const id of [pair.leftId,pair.rightId]){const row=rows.get(id),partnerId=id===pair.leftId?pair.rightId:pair.leftId;
   // This margin measures the member's contribution to relevance, never the truth of its text.
   if(pair.score>row.relevance&&(minPairLogitGain===undefined||logit(pair.score)-logit(rows.get(partnerId).singleRelevance)>=minPairLogitGain)){row.relevance=pair.score;row.contextPartnerId=partnerId;}
  }
 }
 if(propagateDenseFloor!==undefined){
  const snapshot=new Map([...rows].map(([id,row])=>[id,row.relevance]));
  // The builder supplies same-space similarities; absent/null similarities cannot propagate.
  for(const pair of pairScores)if(typeof pair.denseSimilarity==='number'&&pair.denseSimilarity>=propagateDenseFloor){
   for(const id of [pair.leftId,pair.rightId]){const row=rows.get(id),partnerId=id===pair.leftId?pair.rightId:pair.leftId,score=snapshot.get(partnerId);if(score>row.relevance){row.relevance=score;row.contextPartnerId=partnerId;}}
  }
 }
 return [...rows.values()].filter(row=>row.relevance>=floor).sort((a,b)=>b.relevance-a.relevance||b.singleRelevance-a.singleRelevance||a.index-b.index).slice(0,limit).map(({index,...row})=>row);
}
