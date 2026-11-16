import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import fixture from '../test/fixtures/cognitive-golden.json';
import {generateCognitiveInsights,InsightSignalCache} from './insightEngine';
import {buildCognitivePulse} from './cognitivePulse';
import {CognitiveAnalysisClient} from './cognitiveAnalysisClient';
import {CognitiveAnalysisWorkerMock} from '../test/cognitiveAnalysisWorkerMock';
beforeAll(()=>vi.stubEnv('TZ','UTC'));
afterAll(()=>vi.unstubAllEnvs());
it.each(fixture.cases)('preserves frozen pre-migration outputs: $name',async item=>{
  expect(fixture.syntheticOnly&&fixture.notInferenceQualityEvaluation).toBe(true);
  const cache=new InsightSignalCache();expect(generateCognitiveInsights(item.rows,fixture.now,cache)).toEqual(item.insights);expect(buildCognitivePulse(item.rows,fixture.now,cache)).toEqual(item.pulse);
  const client=new CognitiveAnalysisClient({uid:'synthetic-actor',teamIds:new Set()},{yieldTask:async()=>{},createWorker:()=>new CognitiveAnalysisWorkerMock() as unknown as Worker});
  try{const insights=await client.select(item.rows,'insights',new AbortController().signal,undefined,fixture.now);expect(insights.analysis).toMatchObject({insights:item.insights});const pulse=await client.select(item.rows,'pulse',new AbortController().signal,undefined,fixture.now);expect(pulse.analysis).toEqual({mode:'pulse',pulse:item.pulse});}finally{client.dispose();}
});
