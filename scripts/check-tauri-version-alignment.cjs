'use strict';
const fs=require('node:fs'),path=require('node:path');
function assess(input){
  const stable=value=>typeof value==='string'&&/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value);
  const versions=input.rustVersions??[],reasons=[];
  if(versions.length!==1||!versions.every(stable))reasons.push('unambiguous_stable_rust_core_required');
  for(const name of ['apiVersion','cliVersion'])if(!stable(input[name]))reasons.push('stable_'+name+'_required');
  const minor=value=>value.split('.').slice(0,2).join('.');
  if(!reasons.length){if(minor(versions[0])!==minor(input.apiVersion))reasons.push('api_rust_major_minor_mismatch');if(minor(versions[0])!==minor(input.cliVersion))reasons.push('cli_rust_major_minor_mismatch');}
  if(input.lockedApiVersion!==input.apiVersion||input.lockedCliVersion!==input.cliVersion)reasons.push('installed_versions_must_match_lock');
  if(input.apiProductionDependency!==true)reasons.push('runtime_api_must_be_a_production_dependency');
  const plugins=input.plugins??[],seen=new Set();
  if(!Array.isArray(plugins))reasons.push('invalid_plugin_versions');
  else for(const plugin of plugins){
    if(!plugin||typeof plugin.name!=='string'||!/^[a-z][a-z-]{0,63}$/.test(plugin.name)||seen.has(plugin.name)){reasons.push('invalid_plugin_versions');continue;}
    seen.add(plugin.name);const label='plugin_'+plugin.name+'_',rust=plugin.rustVersions;
    const rustValid=Array.isArray(rust)&&rust.length===1&&rust.every(stable);
    if(!rustValid)reasons.push(label+'unambiguous_stable_rust_required');
    if(!stable(plugin.jsVersion))reasons.push(label+'stable_js_required');
    if(rustValid&&stable(plugin.jsVersion)&&minor(rust[0])!==minor(plugin.jsVersion))reasons.push(label+'js_rust_major_minor_mismatch');
    if(plugin.lockedJsVersion!==plugin.jsVersion)reasons.push(label+'installed_version_must_match_lock');
    if(plugin.productionDependency!==true)reasons.push(label+'runtime_must_be_a_production_dependency');
  }
  return{aligned:reasons.length===0,reasons};
}
function inspect(root){
  const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
  const manifest=read('frontend/package.json'),lock=read('frontend/package-lock.json'),cargo=fs.readFileSync(path.join(root,'frontend/src-tauri/Cargo.lock'),'utf8');
  const rustVersionsFor=name=>cargo.split('[[package]]').filter(block=>new RegExp('^name\\s*=\\s*"'+name+'"\\s*$','m').test(block)).map(block=>/^version\s*=\s*"([^"]+)"\s*$/m.exec(block)?.[1]);
  const rustVersions=rustVersionsFor('tauri');
  const pluginNames=[...new Set([...Object.keys(manifest.dependencies??{}),...Object.keys(manifest.devDependencies??{})].filter(name=>name.startsWith('@tauri-apps/plugin-')))];
  const plugins=pluginNames.map(packageName=>{
    const name=packageName.slice('@tauri-apps/plugin-'.length);if(!/^[a-z][a-z-]{0,63}$/.test(name))throw Error('Invalid Tauri plugin name');
    return{name,rustVersions:rustVersionsFor('tauri-plugin-'+name),jsVersion:read('frontend/node_modules/'+packageName+'/package.json').version,
      lockedJsVersion:lock.packages['node_modules/'+packageName]?.version,productionDependency:Boolean(manifest.dependencies?.[packageName]&&!manifest.devDependencies?.[packageName])};
  });
  const input={rustVersions,apiVersion:read('frontend/node_modules/@tauri-apps/api/package.json').version,cliVersion:read('frontend/node_modules/@tauri-apps/cli/package.json').version,
    lockedApiVersion:lock.packages['node_modules/@tauri-apps/api']?.version,lockedCliVersion:lock.packages['node_modules/@tauri-apps/cli']?.version,
    apiProductionDependency:Boolean(manifest.dependencies?.['@tauri-apps/api']&&!manifest.devDependencies?.['@tauri-apps/api']),plugins};
  return{v:1,...assess(input),versions:{rust:rustVersions,api:input.apiVersion,cli:input.cliVersion,plugins},apiProductionDependency:input.apiProductionDependency,productionMutations:0};
}
module.exports={assess,inspect};
if(require.main===module){try{const args=process.argv.slice(2);if(args.length&&!(args.length===2&&args[0]==='--out'&&path.isAbsolute(args[1])))throw Error();const report=inspect(path.resolve(__dirname,'..'));if(args.length)fs.writeFileSync(args[1],JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));if(!report.aligned)process.exitCode=1;}catch{console.error('{"aligned":false,"reason":"tauri_version_inspection_failed"}');process.exitCode=1;}}
