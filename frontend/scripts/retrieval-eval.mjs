/** Evaluation only: rankings are supplied by the real product adapters. */
export function validateDataset(dataset) {
  if(dataset?.synthetic!==true||!Array.isArray(dataset.corpus)||!Array.isArray(dataset.questions))throw Error('synthetic_dataset_required');
  const ids=new Set(dataset.corpus.map(row=>row.id));
  if(ids.size!==dataset.corpus.length||new Set(dataset.questions.map(row=>row.id)).size!==dataset.questions.length)throw Error('duplicate_id');
  for(const row of dataset.corpus)if(!dataset.languages.includes(row.language)||typeof row.text!=='string'||!row.text.trim())throw Error('invalid_document');
  for(const row of dataset.questions)if(!dataset.languages.includes(row.language)||typeof row.text!=='string'||!Number.isInteger(row.k)||row.k<1||row.k>100||!Array.isArray(row.relevantIds)||new Set(row.relevantIds).size!==row.relevantIds.length||row.relevantIds.some(id=>!ids.has(id)))throw Error('invalid_question');
  return true;
}
export function scoreRanking(relevantIds, rankedIds, k) {
  if(!Number.isInteger(k)||k<1||!Array.isArray(rankedIds)||new Set(rankedIds).size!==rankedIds.length)throw Error('invalid_ranking');
  const relevant=new Set(relevantIds), top=rankedIds.slice(0,k), correct=top.filter(id=>relevant.has(id)).length;
  const first=rankedIds.findIndex(id=>relevant.has(id));
  return {precisionAtK:relevant.size?correct/k:null,recallAtK:relevant.size?correct/relevant.size:null,reciprocalRank:relevant.size?(first<0?0:1/(first+1)):null,
    evidenceComplete:relevant.size?correct===relevant.size:null,expectedAbstention:relevant.size===0,abstained:top.length===0,returned:top.length};
}
export function summarize(rows) {
  const positive=rows.filter(row=>!row.expectedAbstention),negative=rows.filter(row=>row.expectedAbstention);
  const mean=key=>positive.length?positive.reduce((sum,row)=>sum+Number(row[key]),0)/positive.length:null;
  return {questions:rows.length,positiveQuestions:positive.length,abstentionQuestions:negative.length,precisionAtK:mean('precisionAtK'),recallAtK:mean('recallAtK'),meanReciprocalRank:mean('reciprocalRank'),evidenceCompleteRate:mean('evidenceComplete'),correctAbstentionRate:negative.length?negative.filter(row=>row.abstained).length/negative.length:null};
}
export function evaluateDataset(dataset, retrieve) {
  validateDataset(dataset);
  const rows=dataset.questions.map(question=>{const result=retrieve(question);if(!Array.isArray(result.ids)||result.ids.some(id=>!dataset.corpus.some(row=>row.id===id)))throw Error('unknown_result');return {id:question.id,language:question.language,scenario:question.scenario,split:question.split,k:question.k,...scoreRanking(question.relevantIds,result.ids,question.k),ids:result.ids,diagnostics:result.diagnostics};});
  const group=key=>Object.fromEntries([...new Set(rows.map(row=>row[key]))].map(value=>[value,summarize(rows.filter(row=>row[key]===value))]));
  return {overall:summarize(rows),byLanguage:group('language'),byScenario:group('scenario'),cases:rows};
}

/** Select from calibration cases only. A failed constraint never produces a usable threshold. */
export function calibrateRetrievalFloor(thresholds, evaluateCalibration, constraints={minPositiveHitRate:.9,maxNegativeFalsePositiveRate:.05}) {
  if(!Array.isArray(thresholds)||!thresholds.length||new Set(thresholds).size!==thresholds.length||thresholds.some(value=>!Number.isFinite(value)||value<0||value>1)||!Number.isFinite(constraints.minPositiveHitRate)||!Number.isFinite(constraints.maxNegativeFalsePositiveRate)||constraints.minPositiveHitRate<0||constraints.minPositiveHitRate>1||constraints.maxNegativeFalsePositiveRate<0||constraints.maxNegativeFalsePositiveRate>1)throw Error('invalid_calibration_configuration');
  const curve=[...thresholds].sort((a,b)=>a-b).map(floor=>{
    const cases=evaluateCalibration(floor);if(!Array.isArray(cases)||cases.some(row=>row.split!=='calibration'))throw Error('calibration_split_required');
    const positive=cases.filter(row=>!row.expectedAbstention),negative=cases.filter(row=>row.expectedAbstention);if(!positive.length||!negative.length)throw Error('both_label_classes_required');
    const positiveHitRate=positive.filter(row=>row.recallAtK>0).length/positive.length,negativeFalsePositiveRate=negative.filter(row=>row.returned>0).length/negative.length;
    return{floor,positiveQuestions:positive.length,negativeQuestions:negative.length,positiveHitRate,negativeFalsePositiveRate,admissible:positiveHitRate>=constraints.minPositiveHitRate&&negativeFalsePositiveRate<=constraints.maxNegativeFalsePositiveRate};
  });
  const selected=curve.find(row=>row.admissible);
  return{decision:selected?'candidate':'rejected',selectedFloor:selected?.floor??null,constraints,curve,validationUsedForSelection:false};
}
