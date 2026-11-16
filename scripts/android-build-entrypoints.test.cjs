'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),test=require('node:test'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
function powershell(args,env=process.env){const result=cp.spawnSync('powershell.exe',['-NoProfile','-NonInteractive',...args],{cwd:path.dirname(root),env,encoding:'utf8',windowsHide:true,timeout:30000});assert(!result.error,result.error?.code);return result;}
const windows={skip:process.platform==='win32'?false:'PowerShell is verified in the Windows CI job'};
test('Android sequence stops at all six failures and preserves context, evidence and signing configuration',windows,()=>{
  const result=powershell(['-File',path.join(__dirname,'android/build-pipeline.test.ps1')]);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/ANDROID_SEQUENCE_ASSERTIONS_PASSED/);
});
test('public Android wrappers reject missing release version, stale version and removed bypasses before building',windows,()=>{
  for(const [relative,args]of [
    ['build-android.ps1',['-Target','ReleaseApk']],
    ['build-android.ps1',['-Target','ReleaseBundle','-VersionCode','123','-VersionName','0.0.0']],
    ['build-android.ps1',['-SkipWebBuild']],
    ['scripts/android/build-android-apk.ps1',[]],
    ['scripts/android/build-android-apk.ps1',['-VersionCode','123','-VersionName','0.0.0','-SkipTests']],
    ['scripts/android/build-playstore-aab.ps1',[]],
    ['scripts/android/build-playstore-aab.ps1',['-VersionCode','123','-VersionName','0.0.0']],
    ['scripts/android/build-playstore-aab.ps1',['-VersionCode','123','-VersionName','0.0.0','-SkipTests']],
    ['scripts/android/generate-release-keystore.ps1',[]],
    ['scripts/android/generate-release-keystore.ps1',['-KeystorePath','relative.p12','-Alias','synthetic']],
    ['build-android.ps1',['-Runner','echo']]]){
      const result=powershell(['-File',path.join(root,relative),...args]);assert.notEqual(result.status,0);assert(!result.stdout.includes('Android:'));
    }
});
test('real native executor propagates a nonzero process exit before invoking later builders',windows,()=>{
  const parent=path.resolve(os.tmpdir()),folder=fs.mkdtempSync(path.join(parent,'mnemosyne-android-native-exit-'));
  try{
    fs.writeFileSync(path.join(folder,'node.cmd'),'@echo off\r\nexit /b 47\r\n');
    const output=path.join(folder,'report'),result=powershell(['-File',path.join(root,'build-android.ps1'),'-Target','Debug','-ReportDirectory',output],{...process.env,PATH:folder+path.delimiter+process.env.PATH});
    assert.notEqual(result.status,0);const report=JSON.parse(fs.readFileSync(path.join(output,'android-build-result.json'),'utf8').replace(/^\uFEFF/,''));
    assert.equal(report.failedStep,'node22');assert.equal(report.failedExitCode,47);assert.deepEqual(report.completedSteps,[]);assert.equal(report.nativeBuildCompleted,false);assert.equal(report.published,false);
  }finally{const target=path.resolve(folder);assert.equal(path.dirname(target),parent);assert(path.basename(target).startsWith('mnemosyne-android-native-exit-'));fs.rmSync(target,{recursive:true,force:true});}
});
test('keytool password transport, rejection, cleanup and real synthetic PKCS12 generation',windows,()=>{
  const result=powershell(['-File',path.join(__dirname,'android/generate-release-keystore.test.ps1')],{...process.env,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/ANDROID_KEYSTORE_ASSERTIONS_PASSED/);
});
