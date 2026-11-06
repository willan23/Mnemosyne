'use strict';
// Isolated Auth-only demo project. Never reads local Firebase project selection or ADC.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),tempRoot=path.resolve(os.tmpdir()),temporary=fs.mkdtempSync(path.join(tempRoot,'mnemosyne-demo-auth-')),config=path.join(temporary,'firebase.json');
if(path.dirname(path.resolve(temporary))!==tempRoot||!path.basename(temporary).startsWith('mnemosyne-demo-auth-'))throw Error('Unexpected demo scratch directory');
fs.writeFileSync(config,JSON.stringify({emulators:{auth:{host:'127.0.0.1',port:19099},hub:{host:'127.0.0.1',port:17400},logging:{host:'127.0.0.1',port:17500},ui:{enabled:false},singleProjectMode:true}}));
const env={...process.env,GCLOUD_PROJECT:'demo-mnemosyne-rules',FIREBASE_CONFIG:JSON.stringify({projectId:'demo-mnemosyne-rules'}),FIREBASE_EMULATORS_SKIP_UPDATE_CHECK:'1'};delete env.GOOGLE_APPLICATION_CREDENTIALS;
try{const result=spawnSync(`npx --yes firebase-tools emulators:exec --config "${config}" --only auth --project demo-mnemosyne-rules "node scripts/account-email-verification-browser.cjs"`,{cwd:root,env,shell:true,encoding:'utf8',maxBuffer:8*1024*1024});for(const output of[result.stdout,result.stderr])if(output)process.stdout.write(output.replace(/(oobCode=)[^&\s]+/g,'$1[redacted]'));process.exitCode=result.status??1;}finally{fs.rmSync(temporary,{recursive:true,force:true});}
