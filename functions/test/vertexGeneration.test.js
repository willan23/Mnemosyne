'use strict';
const {beforeEach,afterEach,test}=require('node:test'),assert=require('node:assert/strict');
const {providerHttp}=require('../lib/providerTransport');
const {generateVertexText}=require('../lib/geminiGeneration');
const {ProviderHttpError}=require('../lib/providerErrorPolicy');
const {resolveTextModel,resolveImageModel,aiModelAllowedForPlan}=require('../lib/modelPolicy');
const original=providerHttp.fetch,requests=[];
const answer=(parts=[{text:'Synthetic answer'}],modelVersion='gemini-3.5-flash')=>new Response(JSON.stringify({modelVersion,candidates:[{finishReason:'STOP',content:{role:'model',parts}}]}),{status:200});
beforeEach(()=>{requests.length=0;providerHttp.fetch=async(url,init)=>{requests.push({url:String(url),init,body:JSON.parse(init.body)});return answer();};});
afterEach(()=>{providerHttp.fetch=original;});
test('official Vertex SDK uses only the fixed express endpoint and a header credential',async()=>{
 const result=await generateVertexText('Synthetic prompt','gemini-3.5-flash',64,'synthetic-vertex-private');
 assert.deepEqual(result,{text:'Synthetic answer',model:'gemini-3.5-flash',provider:'vertex'});assert.equal(requests.length,1);
 const {url,init,body}=requests[0];assert.equal(url,'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.5-flash:generateContent');
 assert.equal(new Headers(init.headers).get('x-goog-api-key'),'synthetic-vertex-private');assert.equal(init.redirect,'error');
 assert.equal(body.generationConfig.maxOutputTokens,64);assert.equal(body.generationConfig.candidateCount,1);assert.equal(body.tools,undefined);assert.equal(body.cachedContent,undefined);
});
test('Vertex rejects other endpoints/models or token budgets before transport',async()=>{
 for(const [model,tokens,key]of [['gemini-3.5-flash-lite',64,'synthetic'],['gemini-3.5-flash',901,'synthetic'],['gemini-3.5-flash',64,''],['https://synthetic.invalid',64,'synthetic']])await assert.rejects(generateVertexText('Synthetic',model,tokens,key));
 assert.equal(requests.length,0);
});
test('Vertex never retries or falls back on payment, authentication, rate limit or upstream errors',async()=>{
 for(const status of [401,402,403,404,429,500]){
  let calls=0;providerHttp.fetch=async()=>{calls++;return new Response('synthetic-private-provider-body',{status});};
  await assert.rejects(generateVertexText('Synthetic','gemini-3.5-flash',64,'synthetic-private'),error=>error instanceof ProviderHttpError&&error.status===status&&!error.message.includes('synthetic-private'));
  assert.equal(calls,1);
 }
});
test('Vertex suppresses thought content and rejects tools, files, empty output or unexpected models',async()=>{
 providerHttp.fetch=async()=>answer([{text:'Synthetic thought',thought:true},{text:'Synthetic answer'}]);
 assert.equal((await generateVertexText('Synthetic','gemini-3.5-flash',64,'synthetic')).text,'Synthetic answer');
 for(const [parts,version]of [[[ {functionCall:{name:'write',args:{}}}],'gemini-3.5-flash'],[[{fileData:{fileUri:'https://synthetic.invalid'}}],'gemini-3.5-flash'],[[],'gemini-3.5-flash'],[[{text:'Synthetic'}],'other-model']]){
  providerHttp.fetch=async()=>answer(parts,version);await assert.rejects(generateVertexText('Synthetic','gemini-3.5-flash',64,'synthetic'));
 }
});
test('Vertex retains redirect and response size limits',async()=>{
 for(const response of [new Response(null,{status:307,headers:{location:'https://synthetic.invalid'}}),new Response('{}',{headers:{'content-length':'1048577'}})]){
  providerHttp.fetch=async()=>response;await assert.rejects(generateVertexText('Synthetic','gemini-3.5-flash',64,'synthetic'));
 }
});
test('Vertex is a distinct text-only model and is not enabled for free plans',()=>{
 assert.equal(resolveTextModel('vertex-flash').provider,'vertex');assert.equal(resolveImageModel('vertex-flash'),null);
 assert.equal(aiModelAllowedForPlan('text','vertex-flash','free'),false);assert.equal(aiModelAllowedForPlan('text','vertex-flash','pro'),true);
});
