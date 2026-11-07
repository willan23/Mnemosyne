import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {withAiGenerationContext,type AiGenerationContextDeps} from './aiGenerationContext';
import type {WebResearchRequest,WebResearchResult} from './webResearchService';
const state=vi.hoisted(()=>({headers:vi.fn(),policy:'allow-cloud'}));
vi.mock('./authHttp',()=>({AuthHttpError:class extends Error{},getAuthJsonHeaders:(...args:unknown[])=>state.headers(...args)}));
vi.mock('./localAiConfig',()=>({getLocalAiConfig:()=>({memoryPermission:state.policy})}));
const result=(request:WebResearchRequest):WebResearchResult=>({query:request.query,mode:request.mode,summary:'Synthetic public summary',key_concepts:['synthetic'],main_ideas:['Synthetic idea'],suggested_memories:[],
  sources:[{title:'Synthetic source',url:'https://example.org/research',snippet:'Synthetic snippet',summary:'Synthetic summary',status:'read'}],local_comparisons:[]});
function fixture(){
  const current={uid:'alice',ready:true};let changed=()=>{};
  const deps:AiGenerationContextDeps={uid:()=>current.uid,ready:()=>current.ready,policy:()=>state.policy,generation:()=>0,team:async()=>null,subscribe:callback=>{changed=callback;return()=>{};}};
  const run=async(request:WebResearchRequest)=>{const api=await import('./webResearchService');return withAiGenerationContext({uid:'alice'},context=>api.runWebResearch(request,{context}),deps);};
  return{current,deps,changed:()=>changed(),run};
}
beforeEach(()=>{vi.resetModules();vi.stubEnv('VITE_ENABLE_WEB_RESEARCH_BACKEND','true');state.policy='allow-cloud';state.headers.mockReset().mockResolvedValue({'Content-Type':'application/json',Authorization:'Bearer synthetic.jwt'});
  vi.stubGlobal('fetch',vi.fn());localStorage.clear();});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();});
it('public and private-local requests discard supplied memory context before consent and transport',async()=>{
  for(const mode of ['public','private-local'] as const){const f=fixture();const request={query:'Synthetic query',mode,context:['SYNTHETIC_PRIVATE_CONTEXT']};
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(result(request)),{status:200}));
    expect((await f.run(request)).mode).toBe(mode);const options=vi.mocked(fetch).mock.calls.at(-1)![1]!;expect(JSON.parse(options.body as string).context).toEqual([]);
    expect(state.headers).toHaveBeenLastCalledWith('alice');expect(options.signal).toBeInstanceOf(AbortSignal);
  }
});
it('contextual consent uses a captured copy of the request even if the caller mutates it during token acquisition',async()=>{
  const f=fixture();const request:WebResearchRequest={query:'Synthetic query',mode:'contextual',context:['Synthetic original memory']};state.policy='confirm-cloud';vi.spyOn(window,'confirm').mockReturnValue(true);
  state.headers.mockImplementationOnce(async()=>{request.query='Replacement query';request.context!.push('SYNTHETIC_REPLACEMENT');return{Authorization:'Bearer synthetic.jwt'};});
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(result({...request,query:'Synthetic query'})),{status:200}));
  await f.run(request);expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toMatchObject({query:'Synthetic query',context:['Synthetic original memory']});
  expect(window.confirm).toHaveBeenCalledOnce();
});
it('never-cloud and declined consent refuse all headers and requests, including fallback output',async()=>{
  for(const policy of ['never-cloud','confirm-cloud']){const f=fixture();state.policy=policy;vi.spyOn(window,'confirm').mockReturnValue(false);
    await expect(f.run({query:'Synthetic query',mode:'public'})).rejects.toThrow(/privacidade|cancelada/);expect(fetch).not.toHaveBeenCalled();expect(state.headers).not.toHaveBeenCalled();
  }
});
it('latches account changes away and back during token acquisition before any outbound call',async()=>{
  const f=fixture();state.headers.mockImplementationOnce(async()=>{f.current.uid='bob';f.changed();f.current.uid='alice';return{Authorization:'Bearer synthetic.jwt'};});
  await expect(f.run({query:'Synthetic query',mode:'contextual',context:['Synthetic memory']})).rejects.toThrow(/mudou/);expect(fetch).not.toHaveBeenCalled();
});
it('a policy change during the confirmation dialog invalidates the authorized operation before credentials or transport',async()=>{
  const f=fixture();state.policy='confirm-cloud';vi.spyOn(window,'confirm').mockImplementationOnce(()=>{state.policy='never-cloud';f.changed();return true;});
  await expect(f.run({query:'Synthetic query',mode:'contextual',context:['Synthetic memory']})).rejects.toThrow(/mudou/);expect(fetch).not.toHaveBeenCalled();expect(state.headers).not.toHaveBeenCalled();
});
it('vault or policy changes during fetch/body parsing suppress both response and fallback',async()=>{
  for(const stage of ['fetch','body'])for(const change of ['vault','policy']){const f=fixture();state.policy='allow-cloud';
    const invalidate=()=>{if(change==='vault')f.current.ready=false;else state.policy='never-cloud';f.changed();};
    vi.mocked(fetch).mockImplementationOnce(async()=>{if(stage==='fetch')invalidate();let done=false;return{ok:true,body:{getReader:()=>({read:async()=>{if(stage==='body')invalidate();const wasDone=done;done=true;return{done:wasDone,value:new TextEncoder().encode(JSON.stringify(result({query:'Synthetic query',mode:'public'})))};},cancel:async()=>{},releaseLock:()=>{}})}} as Response;});
    await expect(f.run({query:'Synthetic query',mode:'public'})).rejects.toThrow(/mudou/);
  }
});
it('missing authentication headers and 4xx responses fail rather than returning research alternatives',async()=>{
  const f=fixture();state.headers.mockResolvedValueOnce({'Content-Type':'application/json'});await expect(f.run({query:'Synthetic query',mode:'public'})).rejects.toThrow(/indisponível/);expect(fetch).not.toHaveBeenCalled();
  for(const status of [401,403,429]){vi.mocked(fetch).mockResolvedValueOnce(new Response('{}',{status}));await expect(f.run({query:'Synthetic query',mode:'public'})).rejects.toThrow(/indisponível/);}
});
it('valid context failures may return public alternatives but never include raw provider diagnostics',async()=>{
  const f=fixture();vi.mocked(fetch).mockRejectedValueOnce(Error('SYNTHETIC_PRIVATE_DIAGNOSTIC'));
  const answer=await f.run({query:'Synthetic query',mode:'private-local'});expect(answer.sources.length).toBeGreaterThan(0);expect(answer.local_comparisons).toEqual([]);expect(JSON.stringify(answer)).not.toContain('SYNTHETIC_PRIVATE_DIAGNOSTIC');
});
it('invalid result identity, structure, links, JSON or excessive bytes are rejected without fabricated success',async()=>{
  const f=fixture();const request:WebResearchRequest={query:'Synthetic query',mode:'public'};const base=result(request);
  for(const data of [{...base,query:'Another query'},{...base,mode:'contextual'},{...base,main_ideas:undefined},{...base,local_comparisons:['Synthetic leaked comparison']},
    {...base,sources:[{...base.sources[0],url:'javascript:alert(1)'}]},{...base,sources:[{...base.sources[0],url:'https://user:password@example.org/'}]}]){
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(data),{status:200}));await expect(f.run(request)).rejects.toThrow(/indisponível/);
  }
  for(const body of ['{',' '.repeat(250001)]){vi.mocked(fetch).mockResolvedValueOnce(new Response(body,{status:200}));await expect(f.run(request)).rejects.toThrow(/indisponível/);}
});
it('validates UTF-8 request limits and bounded metadata before any authorization or transport',async()=>{
  const api=await import('./webResearchService');
  for(const request of [{query:'x',mode:'public'},{query:'🙂'.repeat(501),mode:'public'},{query:'Synthetic',mode:'bad'},
    {query:'Synthetic',mode:'contextual',context:['🙂'.repeat(501)]},{query:'Synthetic',mode:'contextual',context:Array(7).fill('x'.repeat(2000))},
    {query:'Synthetic',mode:'contextual',context:'bad'},{query:'Synthetic',mode:'public',max_sources:1.5}])await expect(api.runWebResearch(request as WebResearchRequest)).rejects.toThrow(/indisponível/);
  expect(fetch).not.toHaveBeenCalled();expect(state.headers).not.toHaveBeenCalled();
});
it('response byte overflow cancels the stream before decoding more data, and invalid UTF-8 cannot become a result',async()=>{
  const f=fixture();let reads=0;const cancel=vi.fn(async()=>{});const releaseLock=vi.fn();
  vi.mocked(fetch).mockResolvedValueOnce({ok:true,body:{getReader:()=>({read:async()=>{reads++;return{done:false,value:new Uint8Array(70000)};},cancel,releaseLock})}} as unknown as Response);
  await expect(f.run({query:'Synthetic query',mode:'public'})).rejects.toThrow(/indisponível/);expect(reads).toBe(4);expect(cancel).toHaveBeenCalledOnce();expect(releaseLock).toHaveBeenCalledOnce();
  vi.mocked(fetch).mockResolvedValueOnce(new Response(new Uint8Array([0xc3,0x28]),{status:200}));await expect(f.run({query:'Synthetic query',mode:'public'})).rejects.toThrow(/indisponível/);
});
