'use strict';
const { providerHttp } = require('../lib/providerTransport');
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {fetchProviderResponse,ProviderTransportError}=require('../lib/providerTransport');
async function server(work,run){
  // Each fixture owns short-lived sockets, including when Windows reuses an ephemeral port.
  const instance=http.createServer((req,res)=>{res.setHeader('connection','close');work(req,res);});await new Promise(resolve=>instance.listen(0,'127.0.0.1',resolve));
  try{return await run('http://127.0.0.1:'+instance.address().port);}
  finally{instance.closeAllConnections();await new Promise(resolve=>instance.close(resolve));}
}
function safeError(error){assert(error instanceof ProviderTransportError);assert.equal(error.message,'Resposta do fornecedor indisponível ou fora dos limites.');return true;}

test('provider transport refuses a real 307 without forwarding POST, body or authorization',async()=>{
  let originalRequests=0,redirectedRequests=0;
  await server((req,res)=>{redirectedRequests++;res.end('unexpected');},async target=>{
    await server((req,res)=>{originalRequests++;req.resume();res.writeHead(307,{location:target+'/redirected'});res.end();},async origin=>{
      await assert.rejects(fetchProviderResponse(origin,{method:'POST',headers:{authorization:'Bearer synthetic-private-provider-key'},body:'synthetic-private-prompt'},2000,1024),safeError);
      assert.equal(originalRequests,1);assert.equal(redirectedRequests,0);
    });
  });
});

test('provider response deadline covers a body stalled after successful headers',async()=>{
  await server((req,res)=>{req.resume();res.writeHead(200,{'content-type':'application/json'});res.write('{"synthetic":');},async origin=>{
    await assert.rejects(fetchProviderResponse(origin,{method:'GET'},250,1024),safeError);
  });
});

test('provider response deadline also covers a server that never sends headers',async()=>{
  await server(req=>req.resume(),async origin=>{
    await assert.rejects(fetchProviderResponse(origin,{method:'GET'},250,1024),safeError);
  });
});

for(const explicitLength of [true,false])test('provider transport bounds '+(explicitLength?'declared':'streamed')+' response bytes',async()=>{
  await server((req,res)=>{req.resume();res.writeHead(200,{'content-type':'application/json',...(explicitLength?{'content-length':'2048'}:{})});res.end('x'.repeat(2048));},async origin=>{
    await assert.rejects(fetchProviderResponse(origin,{method:'GET'},2000,64),safeError);
  });
});

test('provider transport preserves successful JSON and image bytes within the limits',async()=>{
  const image=Buffer.from([137,80,78,71,0,1,2,3]);
  await server((req,res)=>{req.resume();if(req.url==='/image'){res.writeHead(200,{'content-type':'image/png'});res.end(image);}else{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'Synthetic answer'}}]}));}},async origin=>{
    const json=await fetchProviderResponse(origin,{method:'POST',body:'Synthetic prompt'},2000,1024);
    assert.equal((await json.json()).choices[0].message.content,'Synthetic answer');assert.equal(json.headers.get('content-length'),null);
    const binary=await fetchProviderResponse(origin+'/image',{method:'GET'},2000,1024);
    assert.equal(binary.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await binary.arrayBuffer()),image);
  });
});

test('provider byte budget also bounds a small gzip response after decompression',async()=>{
  const compressed=require('node:zlib').gzipSync(Buffer.from('x'.repeat(4096)));
  assert(compressed.length<64);
  await server((req,res)=>{req.resume();res.writeHead(200,{'content-encoding':'gzip','content-length':String(compressed.length)});res.end(compressed);},async origin=>{
    await assert.rejects(fetchProviderResponse(origin,{method:'GET'},2000,64),safeError);
  });
});

test('provider HTTP failures retain status while discarding the upstream body',async()=>{
  await server((req,res)=>{req.resume();res.writeHead(429,{'content-type':'application/json'});res.end('synthetic-private-upstream-body');},async origin=>{
    const response=await fetchProviderResponse(origin,{method:'GET'},2000,1024);
    assert.equal(response.status,429);assert.equal(response.ok,false);assert.equal(await response.text(),'');
  });
});

test('invalid provider deadlines and byte limits fail before constructing a request',async()=>{
  const previous=providerHttp.fetch;let calls=0;providerHttp.fetch=async()=>{calls++;throw Error('Unexpected fetch');};
  try{for(const [timeout,bytes]of [[0,1024],[120001,1024],[1000,0],[1000,16777217],[NaN,1024],[1000,Infinity]])await assert.rejects(fetchProviderResponse('https://example.invalid',{method:'GET'},timeout,bytes),safeError);assert.equal(calls,0);}
  finally{providerHttp.fetch=previous;}
});

test('transport exceptions never include a URL, credential, prompt or raw error',async()=>{
  const previous=providerHttp.fetch;providerHttp.fetch=async()=>{throw Error('synthetic-private-key-and-prompt');};
  try{await assert.rejects(fetchProviderResponse('https://example.invalid/synthetic-private',{method:'POST',headers:{authorization:'synthetic-private-key'},body:'synthetic-private-prompt'},1000,1024),safeError);}
  finally{providerHttp.fetch=previous;}
});
