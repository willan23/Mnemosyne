import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {generatePairingKey,pairingPrivateKey,encryptPairingHandshake,decryptPairingHandshake} from './mobilePairingCrypto';
beforeAll(()=>vi.stubGlobal('crypto',webcrypto));afterAll(()=>vi.unstubAllGlobals());
it('actual ECDH/AES pairs roundtrip and reject a private scalar paired with different public coordinates',async()=>{
  const a=await generatePairingKey(()=>{}),b=await generatePairingKey(()=>{}),cipher=await encryptPairingHandshake({v:2,synthetic:true},a.privateKey,b.publicKeyJwk,()=>{});expect(await decryptPairingHandshake(cipher,b.privateKey,a.publicKeyJwk,()=>{})).toEqual({v:2,synthetic:true});
  await expect(pairingPrivateKey({...a.privateKeyJwk,d:b.privateKeyJwk.d},a.publicKeyJwk,()=>{})).rejects.toThrow();
});
it('captures private scalar/public coordinates before await and stops after caller retirement',async()=>{
  const a=await generatePairingKey(()=>{}),copy={...a.privateKeyJwk},opening=pairingPrivateKey(copy,a.publicKeyJwk,()=>{});copy.d='A'.repeat(43);await expect(opening).resolves.toBeTruthy();await expect(pairingPrivateKey(a.privateKeyJwk,a.publicKeyJwk,()=>{throw Error('Synthetic retired');})).rejects.toThrow('Synthetic retired');
});
