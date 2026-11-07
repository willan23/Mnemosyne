'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),assert=require('node:assert/strict'),test=require('node:test');
const cli=path.join(__dirname,'android-runtime-pilot.cjs'),{args}=require(cli),output=path.join(os.tmpdir(),'mnemosyne-native-arguments-only');
test('native pilot requires a declared emulator and new absolute report path',()=>{
  assert.deepEqual(args(['--serial','emulator-5580','--out',output]),{serial:'emulator-5580',out:output});
  for(const values of [[],['--serial','R8_SYNTHETIC_PHYSICAL','--out',output],['--serial','emulator-5580;command','--out',output],['--serial','emulator-5580','--out','relative'],['--serial','emulator-5580','--url','https://example.invalid'],['--serial','emulator-5580','--out',output,'--out',output],['--serial','emulator-5580','--out']])assert.throws(()=>args(values),/native_arguments/);
});
test('public CLI refuses invalid target before requesting ADB or creating evidence',()=>{
  const result=cp.spawnSync(process.execPath,[cli,'--serial','R8_SYNTHETIC_PHYSICAL','--out',output],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(result.status,1);assert.match(result.stderr,/native_arguments/);assert(!result.stdout.includes('ANDROID_NATIVE'));
});
test('existing evidence is refused before resolving the Android SDK or touching a device',()=>{
  const parent=path.resolve(os.tmpdir()),folder=fs.mkdtempSync(path.join(parent,'mnemosyne-native-evidence-test-'));
  try{const file=path.join(folder,'prior.txt'),bytes=Buffer.from('Synthetic prior evidence');fs.writeFileSync(file,bytes);const result=cp.spawnSync(process.execPath,[cli,'--serial','emulator-5580','--out',folder],{encoding:'utf8',windowsHide:true,timeout:10000,env:{...process.env,ANDROID_HOME:path.join(folder,'unavailable-sdk'),ANDROID_SDK_ROOT:path.join(folder,'unavailable-sdk')}});assert.equal(result.status,1);assert.match(result.stderr,/native_report_exists/);assert.deepEqual(fs.readFileSync(file),bytes);assert.deepEqual(fs.readdirSync(folder),['prior.txt']);}
  finally{const target=path.resolve(folder);assert.equal(path.dirname(target),parent);assert(path.basename(target).startsWith('mnemosyne-native-evidence-test-'));fs.rmSync(target,{recursive:true,force:true});}
});
