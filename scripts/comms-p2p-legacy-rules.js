'use strict';
const crypto=require('node:crypto');
const invalid=()=>new Error('P2P published policy unavailable');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');

/** Read-only release/ruleset verification against the exact local closed source.
 * Source integrity is not a substitute for the emulator/cloud denial tests. */
async function verifyClosedCommsP2PRules(client,projectId,source,expectedSha256){
  if(!/^[a-z][a-z0-9-]{5,29}$/.test(projectId??'')||typeof source!=='string'||Buffer.byteLength(source)>2_000_000||
    !/^[a-f0-9]{64}$/.test(expectedSha256??'')||hash(source)!==expectedSha256)throw invalid();
  const body=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\r\n]*/g,'');
  const room=/match\s+\/p2pRooms\/\{roomId\}\s*\{\s*allow\s+read\s*,\s*write\s*:\s*if\s+false\s*;/;
  if(!room.test(body))throw invalid();
  for(const side of['callerCandidates','calleeCandidates'])if(!new RegExp('match\\s+/'+side+'/\\{candidateId\\}\\s*\\{\\s*allow\\s+read\\s*,\\s*write\\s*:\\s*if\\s+false\\s*;\\s*\\}').test(body))throw invalid();
  const releaseName=`projects/${projectId}/releases/cloud.firestore`;
  const release=(await client.request({url:`https://firebaserules.googleapis.com/v1/${releaseName}`,timeout:20000,retry:false})).data;
  const prefix=`projects/${projectId}/rulesets/`;
  if(release?.name!==releaseName||typeof release.rulesetName!=='string'||!release.rulesetName.startsWith(prefix)||
     !/^[a-zA-Z0-9-]+$/.test(release.rulesetName.slice(prefix.length))||typeof release.updateTime!=='string')throw invalid();
  const ruleset=(await client.request({url:`https://firebaserules.googleapis.com/v1/${release.rulesetName}`,timeout:20000,retry:false})).data;
  if(ruleset?.name!==release.rulesetName||!Array.isArray(ruleset.source?.files)||ruleset.source.files.length!==1||
      typeof ruleset.source.files[0].content!=='string'||hash(ruleset.source.files[0].content)!==expectedSha256)throw invalid();
  const again=(await client.request({url:`https://firebaserules.googleapis.com/v1/${releaseName}`,timeout:20000,retry:false})).data;
  if(again?.name!==release.name||again.rulesetName!==release.rulesetName||again.updateTime!==release.updateTime)throw invalid();
  return{projectId,rulesSha256:expectedSha256,rulesetName:release.rulesetName,releaseUpdateTime:release.updateTime};
}
module.exports={verifyClosedCommsP2PRules};
