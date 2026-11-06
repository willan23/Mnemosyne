const test=require('node:test'),assert=require('node:assert/strict');
const {recordMemorySupersession}=require('../lib/memorySupersession');
const operationId='11111111-1111-4111-8111-111111111111';
test('supersession uses explicit revision provenance and excludes every content field',()=>{
  const writes=[],db={doc:path=>path},tx={create:(path,value)=>writes.push({path,value})};
  const input={operationId,memoryId:'note',previousRevision:1,revision:2,versionId:'memory-edit-'+operationId,source:'memory-edit',
    text:'SYNTHETIC-PRIVATE',title:'SYNTHETIC-TITLE',enc:{ct:'SYNTHETIC-CIPHER'},query:'SYNTHETIC-QUERY',embedding:[1,0]};
  recordMemorySupersession(tx,db,'alice',input);
  assert.equal(writes.length,1);assert.match(writes[0].path,/^users\/alice\/memoryEvents\/[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(writes[0].value).sort(),['schemaVersion','kind','memoryId','previousRevision','revision','versionId','occurredAt','recordedAt','source'].sort());
  assert.equal(writes[0].value.kind,'supersede');assert.equal(JSON.stringify(writes).includes('SYNTHETIC'),false);
  recordMemorySupersession(tx,db,'alice',input);assert.equal(writes[1].path,writes[0].path);
});
test('invalid provenance refuses before creating a ledger record',()=>{
  const input={operationId,memoryId:'note',previousRevision:1,revision:2,versionId:'memory-edit-'+operationId,source:'memory-edit'};
  for(const patch of [{source:'unknown'},{versionId:'other'},{revision:1},{revision:NaN},{previousRevision:-1},{operationId:'bad'},{memoryId:'path/escape'}]){
    assert.throws(()=>recordMemorySupersession({create:()=>assert.fail('unexpected write')},{doc:()=>assert.fail('unexpected reference')},'alice',{...input,...patch}),/^Error: memory_supersession_invalid$/);
  }
});
