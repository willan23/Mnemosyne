'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {GENERATION_HTTP_POLICY,generationFunctionUrl,generationFunctionsBase}=require('../lib/generationHttpPolicy');

test('function and client limits leave time after the selected provider deadline',()=>{
  for(const policy of Object.values(GENERATION_HTTP_POLICY)){
    assert(policy.providerTimeoutMs>0&&policy.providerTimeoutMs<=120000);
    assert(policy.functionTimeoutSeconds*1000>=policy.providerTimeoutMs+30000);
    assert(policy.clientTimeoutMs>=policy.functionTimeoutSeconds*1000+15000);
    assert(policy.maxResponseBytes>0&&policy.maxResponseBytes<=17*1024*1024);
  }
});
test('generation endpoints reach regional Functions directly rather than the 60-second Hosting proxy',()=>{
  assert.equal(generationFunctionUrl('image'),'https://europe-west1-mnemosyne-one.cloudfunctions.net/generateImage');
  assert.equal(generationFunctionUrl('text',{projectId:'demo-mnemosyne-rules'}),'https://europe-west1-demo-mnemosyne-rules.cloudfunctions.net/generateText');
});
test('only explicit development can address a loopback Functions emulator',()=>{
  for(const origin of ['http://localhost:5001','http://127.0.0.1:5001/','http://[::1]:5001']){
    assert.throws(()=>generationFunctionsBase({emulatorOrigin:origin}));
    assert(generationFunctionUrl('image',{projectId:'demo-mnemosyne-rules',development:true,emulatorOrigin:origin}).endsWith('/demo-mnemosyne-rules/europe-west1/generateImage'));
  }
});
test('endpoint configuration cannot introduce foreign hosts, credentials, path/query injection or a different function',()=>{
  for(const origin of ['https://example.invalid','http://127.0.0.1.evil.invalid:5001','http://user:secret@localhost:5001','http://localhost:5001/other','http://localhost:5001/?key=private','http://localhost:5001/#private','file:///tmp'])assert.throws(()=>generationFunctionsBase({development:true,emulatorOrigin:origin}));
  for(const projectId of ['','../other','alice@example.invalid','mnemosyne-one?key=x','https://evil.invalid','x'.repeat(31)])assert.throws(()=>generationFunctionsBase({projectId}));
  assert.throws(()=>generationFunctionUrl('other'));
});
