'use strict';
const { providerHttp } = require('../lib/providerTransport');
const test=require('node:test'),assert=require('node:assert/strict');
const {OPENROUTER_FREE_MODEL,openRouterFreeRequest,openRouterFreeResponse,generateOpenRouterFreeText}=require('../lib/openrouterFreeGeneration');
const valid=()=>({model:'google/gemma-4-31b-it',provider:'Google AI Studio',usage:{cost:0},choices:[{message:{content:'Synthetic free answer'},finish_reason:'stop'}]});
test('free request fixes the model, processor, all price caps, privacy and single-attempt route',()=>{
  const request=openRouterFreeRequest('Synthetic prompt',OPENROUTER_FREE_MODEL,900);
  assert.equal(request.model,'google/gemma-4-31b-it:free');assert(!request.models&&!request.plugins&&!request.tools&&!request.route);
  assert.deepEqual(request.provider,{only:['google-ai-studio'],allow_fallbacks:false,require_parameters:true,data_collection:'deny',max_price:{prompt:0,completion:0,request:0,image:0}});
  assert.deepEqual(request.reasoning,{enabled:false});assert.equal(request.stream,false);assert.equal(request.max_tokens,900);
  const other=openRouterFreeRequest('Another synthetic prompt',OPENROUTER_FREE_MODEL,64);request.provider.max_price.prompt=99;assert.equal(other.provider.max_price.prompt,0);
});
test('paid models, routers, arrays, excessive tokens and invalid prompts are refused before network',async()=>{
  const saved=providerHttp.fetch;let calls=0;providerHttp.fetch=async()=>{calls++;throw Error('Unexpected network');};
  try{for(const model of ['google/gemma-4-31b-it','openrouter/auto','openrouter/free','another/model:free',[],null])await assert.rejects(generateOpenRouterFreeText('Synthetic prompt',model,64,'synthetic-key'));
    for(const tokens of [0,63,901,Infinity,'900'])await assert.rejects(generateOpenRouterFreeText('Synthetic prompt',OPENROUTER_FREE_MODEL,tokens,'synthetic-key'));
    for(const prompt of ['', 'x','x'.repeat(4001),null])await assert.rejects(generateOpenRouterFreeText(prompt,OPENROUTER_FREE_MODEL,64,'synthetic-key'));
    for(const key of ['',null,'synthetic\nheader'])await assert.rejects(generateOpenRouterFreeText('Synthetic prompt',OPENROUTER_FREE_MODEL,64,key));assert.equal(calls,0);
  }finally{providerHttp.fetch=saved;}
});
test('free response requires the selected model, an exact zero reported cost, text and no tool calls',()=>{
  assert.deepEqual(openRouterFreeResponse(valid()),{text:'Synthetic free answer',model:'google/gemma-4-31b-it',provider:'openrouter-google-ai-studio',inference_cost_usd:0});
  for(const model of [OPENROUTER_FREE_MODEL,'google/gemma-4-31b-it-20260402','google/gemma-4-31b-it-20260402:free'])assert.equal(openRouterFreeResponse({...valid(),model}).model,model);
  for(const cost of [undefined,null,'0',.00001,-1,Infinity])assert.throws(()=>openRouterFreeResponse({...valid(),usage:{cost}}));
  for(const model of ['other/paid-model','google/gemma-4-31b-it:paid',undefined])assert.throws(()=>openRouterFreeResponse({...valid(),model}));
  assert.throws(()=>openRouterFreeResponse({...valid(),provider:'Unknown provider'}));
  for(const content of ['',null,'x'.repeat(128001)]){const data=valid();data.choices[0].message.content=content;assert.throws(()=>openRouterFreeResponse(data));}
  for(const calls of [[{function:{name:'untrusted'}}],{},'tools']){const data=valid();data.choices[0].message.tool_calls=calls;assert.throws(()=>openRouterFreeResponse(data));}
  const empty=valid();empty.choices[0].message.tool_calls=[];assert.equal(openRouterFreeResponse(empty).inference_cost_usd,0);
  assert.throws(()=>openRouterFreeResponse({...valid(),error:{code:429,message:'synthetic-private-error'}}),e=>e.status===429&&!e.message.includes('synthetic-private'));
});
test('actual adapter sends one fixed HTTPS request with credentials only in headers and no fallback',async()=>{
  const saved=providerHttp.fetch,requests=[];providerHttp.fetch=async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify(valid()),{status:200,headers:{'content-type':'application/json'}});};
  try{const response=await generateOpenRouterFreeText('Synthetic prompt',OPENROUTER_FREE_MODEL,64,'synthetic-private-key');assert.equal(response.inference_cost_usd,0);assert.equal(requests.length,1);const {url,options}=requests[0];assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer synthetic-private-key');const body=JSON.parse(options.body);assert.equal(body.model,OPENROUTER_FREE_MODEL);assert.equal(body.provider.max_price.prompt,0);assert(!options.body.includes('synthetic-private-key'));
  }finally{providerHttp.fetch=saved;}
});
test('rate limits, payment-required, unavailable and invalid successful responses never retry or change models',async()=>{
  const saved=providerHttp.fetch;
  try{for(const status of [402,429,503]){let calls=0;providerHttp.fetch=async()=>{calls++;return new Response('synthetic-private-upstream-error',{status});};await assert.rejects(generateOpenRouterFreeText('Synthetic prompt',OPENROUTER_FREE_MODEL,64,'synthetic-key'),e=>e.status===status&&!e.message.includes('synthetic-private'));assert.equal(calls,1);}
    for(const body of [{...valid(),usage:{cost:.01}},{...valid(),model:'other/model'},{error:{code:429}},{not:'a completion'}]){let calls=0;providerHttp.fetch=async()=>{calls++;return new Response(JSON.stringify(body),{status:200});};await assert.rejects(generateOpenRouterFreeText('Synthetic prompt',OPENROUTER_FREE_MODEL,64,'synthetic-key'));assert.equal(calls,1);}
  }finally{providerHttp.fetch=saved;}
});
