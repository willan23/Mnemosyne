'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {assess,inspect}=require('./check-tauri-version-alignment.cjs');
const valid=()=>({rustVersions:['2.12.4'],apiVersion:'2.12.4',cliVersion:'2.12.3',lockedApiVersion:'2.12.4',lockedCliVersion:'2.12.3',apiProductionDependency:true});
test('patch differences are accepted within the supported major/minor pair',()=>assert.deepEqual(assess(valid()),{aligned:true,reasons:[]}));
test('the observed API mismatch fails even when a diagnostic command exits zero',()=>{const value=valid();value.apiVersion=value.lockedApiVersion='2.11.0';assert(assess(value).reasons.includes('api_rust_major_minor_mismatch'));assert.equal(assess(value).aligned,false);});
test('an incompatible CLI is refused independently of the API',()=>{const value=valid();value.cliVersion=value.lockedCliVersion='3.0.0';assert(assess(value).reasons.includes('cli_rust_major_minor_mismatch'));});

test('the observed updater mismatch is refused before the native build',()=>{
  const value=valid();value.plugins=[{name:'updater',rustVersions:['2.14.0'],jsVersion:'2.10.1',lockedJsVersion:'2.10.1',productionDependency:true}];
  assert.equal(assess(value).aligned,false);
});

test('plugin patch releases align, while stale installations, ambiguous Rust versions and dev-only runtime plugins fail',()=>{
  const plugin={name:'updater',rustVersions:['2.14.0'],jsVersion:'2.14.1',lockedJsVersion:'2.14.1',productionDependency:true};
  assert(assess({...valid(),plugins:[plugin]}).aligned);
  for(const change of [{lockedJsVersion:'2.14.0'},{rustVersions:['2.14.0','2.13.0']},{jsVersion:'2.14.0-alpha.1'},{productionDependency:false}])assert(!assess({...valid(),plugins:[{...plugin,...change}]}).aligned);
  assert(!assess({...valid(),plugins:[plugin,plugin]}).aligned);
  assert(!assess({...valid(),plugins:{}}).aligned);
});
test('ambiguous core versions and prereleases cannot certify a stable release',()=>{assert(!assess({...valid(),rustVersions:['2.11.0','2.12.4']}).aligned);assert(!assess({...valid(),rustVersions:['3.0.0-alpha.3']}).aligned);});
test('an installation different from the lock and a runtime SDK outside production dependencies are refused',()=>{assert(assess({...valid(),lockedApiVersion:'2.12.3'}).reasons.includes('installed_versions_must_match_lock'));assert(assess({...valid(),apiProductionDependency:false}).reasons.includes('runtime_api_must_be_a_production_dependency'));});
test('the current project installation and audited runtime classification are aligned',()=>{const report=inspect(path.resolve(__dirname,'..'));assert.equal(report.aligned,true);assert.equal(report.apiProductionDependency,true);assert.equal(report.versions.plugins.length,4);assert(report.versions.plugins.some(plugin=>plugin.name==='updater'));});
