'use strict';
const { providerHttp } = require('../lib/providerTransport');
const {beforeEach,afterEach,test}=require('node:test'),assert=require('node:assert/strict');
const {generateGeminiText,generateGeminiImage}=require('../lib/geminiGeneration');
const {ProviderHttpError,shouldTripProviderCircuit}=require('../lib/providerErrorPolicy');
const {png}=require('./providerFixtures');
const originalFetch=providerHttp.fetch,requests=[];
const answer=(model,parts,finishReason='STOP')=>new Response(JSON.stringify({modelVersion:model,candidates:[{finishReason,content:{role:'model',parts}}]}),{status:200,headers:{'content-type':'application/json'}});
beforeEach(()=>{requests.length=0;providerHttp.fetch=async()=>{throw Error('Unexpected transport');};});
afterEach(()=>{providerHttp.fetch=originalFetch;});
function intercept(reply){providerHttp.fetch=async(url,init)=>{requests.push({url:String(url),init,body:JSON.parse(init.body)});return reply(url,init);};}
test('official SDK sends one bounded text request, with header credentials and no tools or alternate endpoint',async()=>{
 intercept(()=>answer('gemini-3.5-flash-lite',[{text:'Synthetic answer'}]));
 const result=await generateGeminiText('Synthetic prompt','gemini-3.5-flash-lite',64,'synthetic-private-key');
 assert.equal(result.text,'Synthetic answer');assert.equal(result.provider,'gemini');assert.equal(requests.length,1);
 const {url,init,body}=requests[0];assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
 assert.equal(url.includes('synthetic-private'),false);assert.equal(new Headers(init.headers).get('x-goog-api-key')==='synthetic-private-key',true);
 assert.equal(init.redirect,'error');assert.equal(body.generationConfig.maxOutputTokens,64);assert.equal(body.generationConfig.candidateCount,1);assert.equal(body.tools,undefined);
});
test('SDK cannot retry payment, authentication or upstream failures and errors omit upstream content',async()=>{
 for(const status of [401,402,429,500]){
  requests.length=0;intercept(()=>new Response('synthetic-private-error-content',{status}));
  await assert.rejects(generateGeminiText('Synthetic prompt','gemini-3.5-flash-lite',64,'synthetic-private-key'),error=>error instanceof ProviderHttpError&&error.status===status&&!error.message.includes('synthetic-private'));
  assert.equal(requests.length,1);
 }
});
test('empty, unexpected-model and tool responses are rejected without trusting upstream text',async()=>{
 for(const [model,parts]of [['other-model',[{text:'Synthetic answer'}]],['gemini-3.5-flash-lite',[]],['gemini-3.5-flash-lite',[{functionCall:{name:'write',args:{}}},{text:'Synthetic answer'}]]]){
  intercept(()=>answer(model,parts));await assert.rejects(generateGeminiText('Synthetic prompt','gemini-3.5-flash-lite',64,'synthetic-private-key'),error=>!error.message.includes('synthetic-private'));
 }
});
test('safety rejection does not disable the provider for other users',async()=>{
 intercept(()=>new Response(JSON.stringify({promptFeedback:{blockReason:'SAFETY'}}),{status:200}));
 await assert.rejects(generateGeminiText('Synthetic prompt','gemini-3.5-flash-lite',64,'synthetic-private-key'),error=>error instanceof ProviderHttpError&&error.status===422&&!shouldTripProviderCircuit(error));
});
test('SDK image generation accepts only the selected raster bytes and fixed dimensions',async()=>{
 intercept(()=>answer('gemini-3.1-flash-image',[{inlineData:{mimeType:'image/png',data:png().toString('base64')}}]));
 const result=await generateGeminiImage('Synthetic image','gemini-3.1-flash-image','synthetic-private-key');
 assert.equal(result.width,1024);assert.equal(result.height,1024);assert.equal(result.media_type,'image/png');assert.equal(result.image_url,null);
 assert.equal(requests[0].body.generationConfig.imageConfig.aspectRatio,'1:1');assert.equal(requests[0].body.generationConfig.imageConfig.imageSize,'1K');assert.equal(requests.length,1);
});
test('image URLs, MIME disagreement and oversized images cannot become persisted output',async()=>{
 for(const parts of [[{fileData:{fileUri:'https://synthetic.invalid/private',mimeType:'image/png'}}],[{inlineData:{mimeType:'image/jpeg',data:png().toString('base64')}}],[{inlineData:{mimeType:'image/png',data:png(512,512).toString('base64')}}]]){
  intercept(()=>answer('gemini-3.1-flash-image',parts));await assert.rejects(generateGeminiImage('Synthetic image','gemini-3.1-flash-image','synthetic-private-key'));
 }
});
test('redirects and responses beyond the byte budget are refused by the SDK transport',async()=>{
 intercept(()=>new Response(null,{status:307,headers:{location:'https://synthetic.invalid/redirect'}}));
 await assert.rejects(generateGeminiText('Synthetic prompt','gemini-3.5-flash-lite',64,'synthetic-private-key'));assert.equal(requests.length,1);
 requests.length=0;intercept(()=>new Response('{}',{status:200,headers:{'content-length':'1048577'}}));
 await assert.rejects(generateGeminiText('Synthetic prompt','gemini-3.5-flash-lite',64,'synthetic-private-key'));assert.equal(requests.length,1);
});
test('missing credentials, unknown model or invalid output quota do not reach the SDK transport',async()=>{
 intercept(()=>answer('gemini-3.5-flash-lite',[{text:'Synthetic answer'}]));
 for(const [model,tokens,key]of [['other-model',64,'synthetic-key'],['gemini-3.5-flash-lite',901,'synthetic-key'],['gemini-3.5-flash-lite',64,'']])await assert.rejects(generateGeminiText('Synthetic prompt',model,tokens,key));
 assert.equal(requests.length,0);
});
