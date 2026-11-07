'use strict';
// Architectural guard. Firestore rules and server authorization remain the authority.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ts=require('../frontend/node_modules/typescript');
const SDK_MUTATIONS=new Set(['addDoc','setDoc','updateDoc','deleteDoc','writeBatch','runTransaction']);
const sdk=name=>/^(?:firebase\/(?:firestore(?:\/lite)?|compat\/firestore)|@firebase\/firestore)$/.test(name);
function inspectSource(relative,text){
  const source=ts.createSourceFile(relative,text,ts.ScriptTarget.Latest,true),findings=[];
  const add=(node,reason,operation)=>findings.push({path:relative,line:source.getLineAndCharacterOfPosition(node.getStart()).line+1,reason,...(operation?{operation}:{})});
  if(source.parseDiagnostics.length){add(source,'source_parse_failed');return findings;}
  function named(node,bindings){
    if(!bindings||!ts.isNamedImports(bindings)&&!ts.isNamedExports(bindings)){add(node,'opaque_sdk_binding');return;}
    for(const item of bindings.elements)if(!item.isTypeOnly){const operation=item.propertyName?.text??item.name.text;if(SDK_MUTATIONS.has(operation))add(item,'sdk_mutation_binding',operation);}
  }
  function visit(node){
    if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)&&sdk(node.moduleSpecifier.text)){
      const clause=node.importClause;if(clause?.isTypeOnly)return;
      if(node.moduleSpecifier.text==='firebase/compat/firestore'){add(node,'compat_sdk_import');return;}
      if(clause?.name)add(node,'opaque_sdk_binding');
      named(node,clause?.namedBindings);
    }
    if(ts.isExportDeclaration(node)&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)&&sdk(node.moduleSpecifier.text)&&!node.isTypeOnly)named(node,node.exportClause);
    if(ts.isImportEqualsDeclaration(node)&&ts.isExternalModuleReference(node.moduleReference)&&ts.isStringLiteral(node.moduleReference.expression)&&sdk(node.moduleReference.expression.text)&&!node.isTypeOnly)add(node,'opaque_sdk_binding');
    if(ts.isCallExpression(node)&&node.arguments.length===1&&ts.isStringLiteral(node.arguments[0])&&sdk(node.arguments[0].text)&&
      (node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==='require'))add(node,'dynamic_sdk_import');
    ts.forEachChild(node,visit);
  }visit(source);return findings;
}
function inspectWorkspace(root){
  const files=[];function walk(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
    const file=path.join(folder,entry.name);if(entry.isSymbolicLink())throw Error('Source symlink not inspected');
    if(entry.isDirectory())walk(file);else if(/\.[cm]?[jt]sx?$/.test(file)&&!/(?:\.d\.ts$|\.test\.|\.spec\.|[\\/]__tests__[\\/])/.test(file))files.push(file);
  }}walk(path.join(root,'frontend','src'));
  const sources=[],findings=[];for(const file of files.sort()){
    const relative=path.relative(root,file).replaceAll('\\','/'),text=fs.readFileSync(file,'utf8');sources.push({path:relative,sha256:crypto.createHash('sha256').update(text).digest('hex')});findings.push(...inspectSource(relative,text));
  }
  return{v:1,generatedAt:new Date().toISOString(),policy:'Frontend logical writes use authenticated server protocols; direct Firestore SDK mutation bindings are retired',
    scope:'Non-test frontend/src JS/TS; named imports/re-exports and opaque imports of Firebase Firestore packages',
    limits:['Does not analyze arbitrary package re-exports, computed imports, eval, dependencies, native code or REST transports','A clean scan is not proof of runtime execution, rule deployment or server authorization'],
    productionMutations:0,sourceCount:sources.length,sources,findings,passed:findings.length===0};
}
if(require.main===module){try{
  const args=process.argv.slice(2);if(args.length&&!(args.length===2&&args[0]==='--out'&&path.isAbsolute(args[1])))throw Error('Absolute output required');
  const report=inspectWorkspace(path.resolve(__dirname,'..'));if(args.length)fs.writeFileSync(args[1],JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({sourceCount:report.sourceCount,findings:report.findings,passed:report.passed,productionMutations:0}));if(!report.passed)process.exitCode=1;
}catch{console.error('{"passed":false,"error":"sdk_boundary_check_failed"}');process.exitCode=1;}}
module.exports={inspectSource,inspectWorkspace};
