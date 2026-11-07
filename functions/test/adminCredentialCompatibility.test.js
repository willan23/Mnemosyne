'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {generateKeyPairSync}=require('node:crypto');const admin=require('firebase-admin');
test('Admin native credential parsing accepts RSA PKCS8/PKCS1 and rejects malformed PEM without requesting a token',()=>{
  // Ephemeral synthetic keys remain in memory; no real credential or token is read, logged or requested.
  const pair=generateKeyPairSync('rsa',{modulusLength:2048});
  for(const type of ['pkcs8','pkcs1']){
    const credential=admin.credential.cert({projectId:'demo-mnemosyne-rules',clientEmail:'synthetic@demo-mnemosyne-rules.iam.gserviceaccount.com',privateKey:pair.privateKey.export({type,format:'pem'})});
    assert.equal(typeof credential.getAccessToken,'function');
  }
  assert.throws(()=>admin.credential.cert({projectId:'demo-mnemosyne-rules',clientEmail:'synthetic@demo-mnemosyne-rules.iam.gserviceaccount.com',privateKey:'synthetic-invalid-pem'}),error=>error.code==='app/invalid-credential');
});
