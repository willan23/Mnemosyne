import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({uid:'alice',listeners:new Set<(user:{uid:string})=>void>(),packets:[] as Array<{name:string;command:{actorUid:string;request:unknown}}>,receipt:undefined as Record<string,unknown>|undefined,swap:false,teamKey:null as CryptoKey|null}));
vi.mock('../firebase',()=>({default:{},db:{},auth:{get currentUser(){return{uid:state.uid};}}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:(user:{uid:string})=>void)=>{state.listeners.add(callback);return()=>state.listeners.delete(callback);}}));
vi.mock('../config/releaseGates',async original=>({...await original<typeof import('../config/releaseGates')>(),PERSONAL_MEMORY_CREATION_ENABLED:true,TEAM_WRITES_ENABLED:true}));
vi.mock('firebase/firestore',async original=>({...await original<typeof import('firebase/firestore')>(),doc:()=>({}),getDocFromServer:async()=>({data:()=>({name:'Synthetic crew',ownerUid:'alice',memberUids:['alice'],wrappedKeys:{alice:{v:1,alg:'RSA-OAEP',ct:'AQ=='}},activeKeyEpoch:2,activeKeyId:'33333333-3333-4333-8333-333333333333',keyRotationStatus:'active'})})}));
vi.mock('./teamKeyAccess',()=>({unlockTeamKey:async()=>{state.teamKey??=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);return state.teamKey;}}));
vi.mock('firebase/functions',()=>({getFunctions:()=>({}),httpsCallable:(_functions:unknown,name:string)=>async(command:{actorUid:string;request:Record<string,unknown>})=>{
  state.packets.push({name,command:structuredClone(command)});if(state.swap){state.swap=false;state.uid='bob';for(const callback of state.listeners)callback({uid:'bob'});throw Error('Synthetic swapped token refused');}
  const {canonicalAttachedMemoryJson}=await import('../../../functions/src/attachedMemoryContract');const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalAttachedMemoryJson(command.request)))),byte=>byte.toString(16).padStart(2,'0')).join('');
  const unknown={sessionId:command.request.sessionId,digest,status:'unknown',createdAt:null};if(name==='createPersonalMemory'||name==='createTeamMemory')state.receipt={...unknown,status:'committed',createdAt:1000};return{data:state.receipt??unknown};
}}));
import {createPersonalMemory,createTeamMemory} from './attachedMemoryRecovery';
import {decryptTeamMemoryEnvelope} from './teamVault';
import {setMemoryCryptoMnemonic} from './memoryCrypto';
import {parseAttachedMemoryCommand} from '../../../functions/src/attachedMemoryContract';
const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
beforeEach(()=>{state.uid='alice';state.listeners.clear();state.packets=[];state.receipt=undefined;state.swap=false;localStorage.clear();setMemoryCryptoMnemonic(words);Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name:string,_options:unknown,work:(lock:object)=>Promise<unknown>)=>work({})}});});
beforeEach(()=>{state.teamKey=null;});
afterEach(()=>{setMemoryCryptoMnemonic(null);vi.restoreAllMocks();});
it('default SDK packets wrap captured actor and preserve the exact canonical request across admission and confirmation',async()=>{
  const result=await createPersonalMemory({uid:'alice',text:'SYNTHETIC_PRIVATE_CAPTURE_917',title:null,metadata:{connections:[]}});expect(result.id).toBeTruthy();expect(state.packets.map(packet=>packet.name)).toEqual(['createPersonalMemory','getAttachedMemoryCreationStatus','getAttachedMemoryCreationStatus']);
  for(const packet of state.packets){expect(packet.command.actorUid).toBe('alice');expect(parseAttachedMemoryCommand(packet.command).request).toEqual(state.packets[0].command.request);}expect(JSON.stringify(state.packets)).not.toContain('SYNTHETIC_PRIVATE_CAPTURE');expect(localStorage.getItem('mnemosyne:attached-memory-creation:v1:alice')).toBeNull();
});
it('token retrieval under a different account keeps the captured actor and the original encrypted own request',async()=>{
  state.swap=true;await expect(createPersonalMemory({uid:'alice',text:'SYNTHETIC_PRIVATE_CAPTURE_917',title:null,metadata:{connections:[]}})).rejects.toThrow();expect(state.packets).toHaveLength(1);expect(state.packets[0].command.actorUid).toBe('alice');expect(state.uid).toBe('bob');expect(localStorage.getItem('mnemosyne:attached-memory-creation:v1:alice')).toBeTruthy();expect(localStorage.getItem('mnemosyne:attached-memory-creation:v1:bob')).toBeNull();expect(state.receipt).toBeUndefined();
});
it('default team creation packet uses v2 AAD for the captured epoch and routes through its own callable',async()=>{
  const proposal={uid:'alice',teamId:'crew',keyEpoch:2,keyId:'33333333-3333-4333-8333-333333333333',text:'SYNTHETIC_TEAM_CAPTURE_917',title:null,metadata:{connections:[]}};const result=await createTeamMemory(proposal);expect(result.id).toBeTruthy();expect(state.packets.map(packet=>packet.name)).toEqual(['createTeamMemory','getAttachedMemoryCreationStatus','getAttachedMemoryCreationStatus']);const request=parseAttachedMemoryCommand(state.packets[0].command).request;expect(request).toMatchObject({teamId:'crew',keyEpoch:2,keyId:proposal.keyId,enc:{v:2},attachmentIds:[]});expect((await decryptTeamMemoryEnvelope(state.teamKey!,request.enc,{teamId:'crew',keyEpoch:2,keyId:proposal.keyId})).text).toBe(proposal.text);await expect(decryptTeamMemoryEnvelope(state.teamKey!,request.enc,{teamId:'crew',keyEpoch:3,keyId:proposal.keyId})).rejects.toThrow();expect(JSON.stringify(state.packets)).not.toContain(proposal.text);for(const packet of state.packets)expect(packet.command.actorUid).toBe('alice');
});
it('default team preparation refuses a different active epoch before submitting ciphertext',async()=>{
  await expect(createTeamMemory({uid:'alice',teamId:'crew',keyEpoch:1,keyId:'33333333-3333-4333-8333-333333333333',text:'SYNTHETIC_TEAM_CAPTURE_917',metadata:{connections:[]}})).rejects.toThrow();expect(state.packets).toHaveLength(0);expect(state.teamKey).toBeNull();expect(localStorage.getItem('mnemosyne:attached-memory-creation:v1:alice')).toBeNull();
});
