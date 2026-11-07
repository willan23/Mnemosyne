'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=process.env.MNEMOSYNE_POLICY_TEST_ROOT||path.resolve(__dirname,'..');
const config=process.env.MNEMOSYNE_GITLEAKS_CONFIG||path.join(root,'.gitleaks.toml');
const executable=process.env.MNEMOSYNE_GITLEAKS_BIN||'gitleaks';
function scan(input){
 const result=spawnSync(executable,['stdin','--config',config,'--redact=100','--no-banner','--no-color','--report-format=json','--report-path=-'],{input,encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});
 assert(!result.error,'The pinned Gitleaks executable must be available');assert([0,1].includes(result.status),'The scanner must complete normally');
 const report=JSON.parse(result.stdout);assert(Array.isArray(report));
 // Never include scanner input, raw reports, match values or stderr in assertion output.
 return {status:result.status,findings:report.map(row=>({rule:row.RuleID,line:row.StartLine,redacted:row.Secret==='REDACTED'}))};
}
test('the security check uses the reviewed Gitleaks version',()=>{
 const version=spawnSync(executable,['version'],{encoding:'utf8',windowsHide:true});assert(!version.error);assert.equal(version.status,0);assert.equal(version.stdout.trim(),'8.29.1');
});
test('only reviewed public Firebase identifiers and deterministic non-secret values are exempt',()=>{
 const publicIds=[...new Set(['frontend/src/firebase.ts','frontend/.env.template'].flatMap(file=>fs.readFileSync(path.join(root,file),'utf8').match(/AIza[A-Za-z0-9_-]{35}/g)||[]))];assert(publicIds.length>0);
 const harmless=['mnemosyne.pin.vault.v1','mnemosyne.pendingClip.v1','quarantine/bob/other','123e4567-e89b-42d3-a456-426614174000','123e4567-e89b-42d3-a456-426614174001'];
 const result=scan([...publicIds,...harmless].map(value=>`api_key = "${value}"`).join('\n'));assert.equal(result.status,0);assert.deepEqual(result.findings,[]);
});
test('other Google, generic and Stripe shaped credentials still fail with redacted findings',()=>{
 // Deterministic synthetic fixtures were never issued by a provider. Assemble them so this
 // test source contains no full credential-shaped literal; detector coverage must not vary
 // with the first character or entropy of a randomly generated string.
 const generic=['7qW','2eR','9tY','4uI','6oP','8aS','3dF','5gH','1jK','0lZ','xCv','BnM'].join('');
 const google='AIza'+generic.slice(0,35),stripe='sk_'+'test_'+generic.repeat(3).slice(0,96);
 const result=scan(`apiKey = "${google}"\napi_key = "${generic}"\nSTRIPE_SECRET_KEY=${stripe}\n`);
 assert.equal(result.status,1);for(const rule of ['gcp-api-key','generic-api-key','stripe-access-token'])assert(result.findings.some(row=>row.rule===rule),`The default ${rule} detector must remain active`);assert(result.findings.every(row=>row.redacted));
});
