'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const fail=reason=>{throw new Error(reason);};
function inspect(root,{includeDist=false}={}){
  root=fs.realpathSync(root);
  function read(relative){
    const target=path.resolve(root,relative),inside=path.relative(root,target);if(!inside||inside.startsWith('..')||path.isAbsolute(inside))fail('invalid_desktop_contract_path');
    let current=root;for(const part of inside.split(path.sep)){current=path.join(current,part);if(fs.lstatSync(current).isSymbolicLink())fail('desktop_contract_link_refused');}
    const stat=fs.statSync(target);if(!stat.isFile()||stat.size>3*1024*1024)fail('invalid_desktop_contract_file');return fs.readFileSync(target);
  }
  const json=relative=>JSON.parse(read(relative).toString('utf8').replace(/^\uFEFF/,''));
  const channelBytes=read('frontend/src/config/desktopReleaseChannel.json'),configBytes=read('frontend/src-tauri/tauri.conf.json');
  const channel=JSON.parse(channelBytes.toString('utf8').replace(/^\uFEFF/,'')),config=JSON.parse(configBytes.toString('utf8').replace(/^\uFEFF/,''));
  if(!channel||Object.keys(channel).sort().join(',')!=='feedPath,firstVersion,keyEpoch,legacyFeedPath,legacyFeedSha256,manifestPath,publicKeySha256,v'||channel.v!==1||channel.keyEpoch!==2||channel.firstVersion!=='1.0.9'||channel.feedPath!=='/desktop/v2/latest.json'||channel.manifestPath!=='/desktop/v2/release-manifest.json'||channel.legacyFeedPath!=='/desktop/latest.json'||!/^([a-f0-9]{64})$/.test(channel.publicKeySha256)||!/^([a-f0-9]{64})$/.test(channel.legacyFeedSha256))fail('invalid_desktop_release_channel');
  const version=config.version;if(typeof version!=='string'||version.length>64||!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version))fail('invalid_desktop_release_version');
  const parts=version.split('.').map(BigInt);if(parts[0]<1n||(parts[0]===1n&&parts[1]===0n&&parts[2]<9n))fail('desktop_epoch2_requires_new_version');
  const manifest=json('frontend/package.json'),lock=json('frontend/package-lock.json');
  if(manifest.version!==version||lock.version!==version||lock.packages?.['']?.version!==version)fail('desktop_app_version_mismatch');
  const cargo=read('frontend/src-tauri/Cargo.toml').toString('utf8').split(/\r?\n\[/)[0],cargoVersion=/^version\s*=\s*"([^"]+)"\s*$/m.exec(cargo)?.[1];
  const rust=read('frontend/src-tauri/Cargo.lock').toString('utf8').split('[[package]]').filter(block=>/^name\s*=\s*"mnemosyne"\s*$/m.test(block));
  if(cargoVersion!==version||rust.length!==1||/^version\s*=\s*"([^"]+)"\s*$/m.exec(rust[0])?.[1]!==version)fail('desktop_rust_version_mismatch');
  const updater=config.plugins?.updater;if(!updater||updater.requireSignedVersion!==true||updater.allowDowngrades!==false||typeof updater.pubkey!=='string'||updater.endpoints?.length!==1||updater.endpoints[0]!=='https://mnemosyne-one.web.app'+channel.feedPath)fail('desktop_updater_policy_mismatch');
  const sha=data=>crypto.createHash('sha256').update(data).digest('hex');if(sha(Buffer.from(updater.pubkey))!==channel.publicKeySha256)fail('desktop_updater_public_key_mismatch');
  for(const tree of includeDist?['public','dist']:['public'])if(sha(read('frontend/'+tree+channel.legacyFeedPath))!==channel.legacyFeedSha256)fail('legacy_desktop_feed_changed');
  return{v:1,...channel,version,configSha256:sha(configBytes),channelSha256:sha(channelBytes),legacyFeedPreserved:true,includeDist,productionMutations:0};
}
module.exports={inspect};
if(require.main===module){try{if(process.argv.length!==2)fail('unexpected_desktop_contract_arguments');console.log(JSON.stringify(inspect(path.resolve(__dirname,'..'))));}catch(error){console.error(JSON.stringify({valid:false,reason:/^[a-z_]+$/.test(error.message)?error.message:'desktop_release_contract_failed'}));process.exitCode=1;}}
