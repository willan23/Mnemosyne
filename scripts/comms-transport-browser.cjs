'use strict';
/** Actual transport crypto and same-browser WebRTC loopback. No cloud Auth, relay or production endpoints. */
const path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),frontend=path.join(root,'frontend');let phase='runtime';
async function main(){
  assert.equal(process.versions.node,'22.23.3');const{build}=require(path.join(frontend,'node_modules/esbuild')),{chromium}=require(path.join(frontend,'node_modules/@playwright/test'));
  const source=`import * as transport from './src/services/commsTransport';import * as cryptoUtils from './src/utils/crypto';
    window.transportProof=async()=>{
      const pair=await cryptoUtils.generateRSAKeyPair(),pem=await cryptoUtils.exportPublicKey(pair.publicKey),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pem));
      const fingerprint=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
      const input={message:'Synthetic transmissão browser ç €',attachment:new File([new Uint8Array(1024).fill(65)],'synthetic.txt',{type:'text/plain'}),publicKeyPem:pem,fingerprint};
      const sealed=await transport.encryptCommsEnvelope(input,()=>{}),wire=JSON.stringify({type:'mnemosyne-transmission',senderId:'alice',recipientId:'bob',...sealed,timestamp:1,status:'p2p'});
      const caller=new RTCPeerConnection({iceServers:[]}),callee=new RTCPeerConnection({iceServers:[]});let callerQueue=[],calleeQueue=[],receiving,externalIceCandidates=0;
      const offerIce=event=>{if(event.candidate)callerQueue.push(event.candidate.toJSON());},answerIce=event=>{if(event.candidate)calleeQueue.push(event.candidate.toJSON());};caller.onicecandidate=offerIce;callee.onicecandidate=answerIce;
      const sender=caller.createDataChannel('mnemosyne-e2e',{ordered:true});
      const received=new Promise((resolve,reject)=>{callee.ondatachannel=event=>{receiving=event.channel;receiving.onmessage=async event=>{try{const value=transport.parseCommsP2PMessage(event.data,'alice','bob'),opened=await transport.decryptCommsEnvelope(value,pair.privateKey,()=>{});resolve({messageMatches:opened.message===input.message,attachmentBytes:opened.attachment.size,mime:opened.attachment.type});}catch(error){reject(error);}};};});
      const gathered=peer=>peer.iceGatheringState==='complete'?Promise.resolve():new Promise(resolve=>peer.addEventListener('icegatheringstatechange',()=>{if(peer.iceGatheringState==='complete')resolve();}));
      try{
        const offer=await caller.createOffer();await caller.setLocalDescription(offer);await gathered(caller);await callee.setRemoteDescription(transport.validateCommsSdp({type:'offer',sdp:caller.localDescription.sdp},'offer'));
        const answer=await callee.createAnswer();await callee.setLocalDescription(answer);await gathered(callee);await caller.setRemoteDescription(transport.validateCommsSdp({type:'answer',sdp:callee.localDescription.sdp},'answer'));
        for(const candidate of callerQueue){if(/ typ (srflx|relay) /.test(candidate.candidate))externalIceCandidates++;await callee.addIceCandidate(transport.validateCommsIce(candidate));}
        for(const candidate of calleeQueue){if(/ typ (srflx|relay) /.test(candidate.candidate))externalIceCandidates++;await caller.addIceCandidate(transport.validateCommsIce(candidate));}
        await new Promise((resolve,reject)=>{if(sender.readyState==='open')return resolve();sender.onopen=resolve;sender.onerror=reject;});
        const wireBytes=new TextEncoder().encode(wire).length,maximum=caller.sctp.maxMessageSize;if(!maximum||wireBytes>maximum)throw Error('Synthetic wire exceeds negotiated bound');sender.send(wire);
        const result=await received;let forgedSenderRefused=false;try{transport.parseCommsP2PMessage(wire,'carol','bob');}catch{forgedSenderRefused=true;}
        let wrongKeyRefused=false;const other=await cryptoUtils.generateRSAKeyPair();try{await transport.decryptCommsEnvelope(sealed,other.privateKey,()=>{});}catch{wrongKeyRefused=true;}
        return{v:1,browser:'Chromium',actualTransportService:true,realRsaAes:true,realWebRtcLoopback:true,actualPanelHandlers:false,cloudAuthOrRelay:false,wireBytes,negotiatedMaximum:maximum,externalIceCandidates,forgedSenderRefused,wrongKeyRefused,...result,providerCalls:0,productionMutations:0};
      }finally{sender.close();receiving?.close();caller.close();callee.close();}
    };`;
  phase='bundle';const result=await build({stdin:{contents:source,resolveDir:frontend,loader:'ts'},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent'});
  const server=http.createServer((request,response)=>{if(request.url==='/'){response.writeHead(200,{'content-type':'text/html'});response.end('<!doctype html><script src="/bundle.js"></script>');}else if(request.url==='/bundle.js'){response.writeHead(200,{'content-type':'application/javascript'});response.end(result.outputFiles[0].text);}else{response.writeHead(404);response.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;let browser,externalHttpRequests=0;
  try{phase='loopback';browser=await chromium.launch({headless:true});const context=await browser.newContext();await context.route('**/*',route=>{if(!route.request().url().startsWith(origin+'/')){externalHttpRequests++;return route.abort();}return route.continue();});const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>window.transportProof);const proof=await page.evaluate(()=>Promise.race([window.transportProof(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Synthetic loopback deadline')),20000))]));
    for(const key of['actualTransportService','realRsaAes','realWebRtcLoopback','forgedSenderRefused','wrongKeyRefused','messageMatches'])assert.equal(proof[key],true,key);assert.equal(proof.attachmentBytes,1024);assert.equal(proof.mime,'text/plain');assert.equal(proof.externalIceCandidates,0);assert.equal(externalHttpRequests,0);process.stdout.write(JSON.stringify({...proof,externalHttpRequests})+'\n');
  }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{process.stderr.write(JSON.stringify({error:'comms_transport_browser_failed',phase,errorType:error?.name,diagnostic:phase==='bundle'?error.errors?.map(row=>({text:row.text,line:row.location?.line})):undefined})+'\n');process.exitCode=1;});
