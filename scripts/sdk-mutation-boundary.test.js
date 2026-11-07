'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test'),path=require('node:path');
const {inspectSource,inspectWorkspace}=require('./sdk-mutation-boundary');
test('allows named reads, SDK local persistence, sentinels and type-only data contracts',()=>{
  for(const source of["import {doc,getDoc,onSnapshot,clearIndexedDbPersistence,arrayUnion} from 'firebase/firestore'","import type * as sdk from 'firebase/firestore'","import {type Firestore,type Transaction} from 'firebase/firestore'","export {doc as memoryRef} from 'firebase/firestore'"])
    assert.deepEqual(inspectSource('source.ts',source),[]);
});
test('rejects direct mutation bindings and aliases without needing execution or import reachability',()=>{
  for(const operation of['addDoc','setDoc','updateDoc','deleteDoc','writeBatch','runTransaction']){
    for(const pkg of['firebase/firestore','firebase/firestore/lite','@firebase/firestore']){
      const findings=inspectSource('source.ts',`import {${operation} as hidden} from '${pkg}'`);assert.equal(findings.length,1);assert.equal(findings[0].operation,operation);
    }
  }
});
test('rejects opaque namespace default compat and dynamic loading instead of claiming those aliases are read-only',()=>{
  for(const source of["import * as sdk from 'firebase/firestore'","import sdk from 'firebase/firestore'","import 'firebase/compat/firestore'","const sdk = require('firebase/firestore')","const sdk=await import('firebase/firestore/lite')","import sdk = require('firebase/firestore')","export * from 'firebase/firestore'"])
    assert(inspectSource('source.ts',source).length>0);
});
test('rejects mutation re-exports and malformed sources but ignores independent server transports',()=>{
  assert.equal(inspectSource('source.ts',"export {setDoc as save} from 'firebase/firestore'")[0].operation,'setDoc');
  assert(inspectSource('source.ts','import {').some(row=>row.reason==='source_parse_failed'));
  assert.deepEqual(inspectSource('source.ts',"import {httpsCallable} from 'firebase/functions'"),[]);
});
test('the current frontend has no direct Firestore mutation bindings',()=>{
  const report=inspectWorkspace(path.resolve(__dirname,'..'));assert(report.sourceCount>250);assert.equal(report.passed,true);assert.deepEqual(report.findings,[]);
});
