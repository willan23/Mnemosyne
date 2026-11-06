import type {SessionData} from '../hooks/useSessions';
import {cognitiveEngine} from '../engines/CognitiveEngine';
import {semanticCandidateEligibility} from './semanticCandidateCapture';
import {withSemanticCandidateOperation} from './semanticCandidateOperations';
import {buildEncryptedMemoryFields} from './memoryCrypto';
import {getLocalAiConfig,type MemoryPermission} from './localAiConfig';
import {ATTACHMENT_WRITES_ENABLED} from '../config/releaseGates';
import {fileExtension,isTextLikeExtension,inferUploadContentType,maxUploadBytesForFile} from '../utils/fileTypes';
import {assertFileFitsStorageLimits} from '../utils/storage';
import {buildDocumentDigest} from './documentSummary';
import {attachmentTypeForFile,categorizeDocument,extractReadableText,formatBytes,summarizeDocument,MAX_TEXT_EXTRACT_CHARS} from './documentText';
import {preparePersonalAttachment,type PreparedPersonalAttachment} from './attachmentUploadClient';
import {attachmentBytesDigest} from './attachmentUploadCheckpoint';
import {encodeAttachmentHeader} from '../../../functions/src/attachmentEnvelope';
import {parseDocumentImportPlan,type DocumentImportMemory} from '../../../functions/src/documentImportContract';
import type {CapturedDocumentImport} from './documentImportRecovery';

export interface DocumentPlanBuildDeps {
  id:()=>string; now:()=>number; policy:()=>MemoryPermission; attachmentsEnabled:()=>boolean;
  extract:typeof extractReadableText; encrypt:typeof buildEncryptedMemoryFields;
  process:typeof cognitiveEngine.processMemory; prepareAttachment:typeof preparePersonalAttachment;
  yieldTask?:()=>Promise<void>;
}
const defaults=():DocumentPlanBuildDeps=>({id:()=>crypto.randomUUID(),now:Date.now,policy:()=>getLocalAiConfig().memoryPermission,attachmentsEnabled:()=>ATTACHMENT_WRITES_ENABLED,
  extract:extractReadableText,encrypt:buildEncryptedMemoryFields,process:(...args)=>cognitiveEngine.processMemory(...args),prepareAttachment:preparePersonalAttachment});
const fail=()=>new Error('O lote documental contém ficheiros, caminhos ou conteúdos inválidos.');
type Position=[number,number,number];
const orbit=(center:Position,radius:number):Position=>{const angle=Math.random()*Math.PI*2;const elevation=(Math.random()-.5)*Math.PI*.3;
  return[center[0]+radius*Math.cos(elevation)*Math.cos(angle),center[1]+radius*Math.sin(elevation),center[2]+radius*Math.cos(elevation)*Math.sin(angle)];};
async function spaced(positions:Position[],guard:()=>void,yieldTask:()=>Promise<void>):Promise<Position>{
  if(!positions.length)return[0,0,0];let best:Position=[0,0,0];let distance=-1;
  for(let i=0;i<100;i++){guard();const candidate=orbit([0,0,0],50+Math.random()*60+positions.length*12);let minimum=Infinity;
    for(let at=0;at<positions.length;at++){guard();minimum=Math.min(minimum,Math.hypot(...candidate.map((value,axis)=>value-positions[at][axis])));if((at+1)%128===0){await yieldTask();guard();}}
    if(minimum>distance){best=candidate;distance=minimum;}if(minimum>=55)break;}
  return best;
}
/** Captures all UUIDs and folder relationships before the first file read. Performs local analysis and sealing only. */
export async function buildDocumentImportPlan(uid:string,input:File[],existing:SessionData[],outerGuard:()=>void,deps=defaults()):Promise<CapturedDocumentImport>{
  outerGuard();const policy=deps.policy();const guard=()=>{outerGuard();if(deps.policy()!==policy)throw fail();};
  const yieldTask=deps.yieldTask??(()=>new Promise<void>(resolve=>setTimeout(resolve,0)));
  if(!Array.isArray(input)||input.length<1||input.length>20)throw new Error('Importa entre um e 20 documentos por lote.');
  const files=[...input];const now=deps.now();
  const paths=new Set<string>();const folders=new Set<string>();
  const captured=files.map(file=>{
    const path=(file.webkitRelativePath||file.name).replace(/\\/g,'/');const parts=path.split('/');
    if(!file.name||path.length>1024||!Number.isSafeInteger(file.size)||file.size<1||paths.has(path)||parts.length>17||parts.some(part=>!part||part==='.'||part==='..'||Array.from(part).some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127)))throw fail();
    paths.add(path);const fileName=parts.pop()!;const directory=parts.join('/');for(let i=1;i<=parts.length;i++)folders.add(parts.slice(0,i).join('/'));
    return{file,path,directory,fileName,id:deps.id(),attachmentId:deps.id()};
  });
  const directories=[...folders].sort((a,b)=>a.split('/').length-b.split('/').length||a.localeCompare(b));
  const hubIds=new Map(directories.map(path=>[path,deps.id()]));if(captured.some(item=>!item.directory))hubIds.set('',deps.id());
  const importId=deps.id();const uploads:PreparedPersonalAttachment[]=[];
  return withSemanticCandidateOperation(existing,{assertCurrent:guard,eligible:semanticCandidateEligibility(uid),yieldTask},async(cohort,semanticGuard)=>{const guard=semanticGuard;guard();
  const processed=[];
  for(const item of captured){
    guard();const extraction=await deps.extract(item.file,guard);guard();const readableText=extraction.text.trim();
    const optional=isTextLikeExtension(fileExtension(item.file.name))&&readableText.length>0;
    const includeOriginal=deps.attachmentsEnabled()&&policy!=='never-cloud'&&item.file.size<=maxUploadBytesForFile(item.file);
    if(!optional&&(!includeOriginal||!['allow-cloud','confirm-cloud'].includes(policy)))throw new Error('Este ficheiro exige um anexo cifrado. Confirma a permissão de armazenamento antes de importar.');
    if(!['allow-cloud','confirm-cloud','never-cloud'].includes(policy))throw fail();
    if(!optional)assertFileFitsStorageLimits(item.file);
    let attachmentId:string|null=null;
    if(includeOriginal){const prepared=await deps.prepareAttachment({uid,id:item.attachmentId,file:item.file},guard);guard();uploads.push(prepared);attachmentId=prepared.id;}
    const category=categorizeDocument(item.file,extraction.text);const digest=buildDocumentDigest(extraction.text,{fileName:item.file.name,category});
    const summary=optional?[
      `[Documento aprendido: ${item.file.name}]`,'',`Categoria: ${category}`,`Tipo: ${inferUploadContentType(item.file)}`,`Tamanho: ${formatBytes(item.file.size)}`,
      `Extração: ${extraction.method}${attachmentId?'':' (sem anexo no armazenamento)'}`,`Texto indexado: até ${MAX_TEXT_EXTRACT_CHARS} caracteres.`,'',readableText.slice(0,MAX_TEXT_EXTRACT_CHARS),
    ].join('\n'):summarizeDocument(item.file,category,extraction.method,digest);
    processed.push({...item,category,digest,summary,method:extraction.method,readable:!!readableText,attachmentId,type:attachmentTypeForFile(item.file)});
  }
  const memories:DocumentImportMemory[]=[];const positions=new Map<string,Position>();const suns:Position[]=cohort.sunPositions();
  async function seal(id:string,role:'hub'|'document',text:string,title:string,category:string,tags:string[],attachmentIds:string[],parentId:string|null,modality:'mixed'|'document'|'image'|'audio'|'video',position:Position|null){
    guard();let cognitive:Awaited<ReturnType<typeof cognitiveEngine.processMemory>>|null=null;
    try{cognitive=await deps.process(text,cohort.prefix(),{assertCurrent:semanticGuard});guard();}catch{guard();console.warn('Aprendizagem local sem enriquecimento semântico.');}
    const source=role==='hub'?'document-batch':'document-upload';const sealed=await deps.encrypt(text,title);guard();
    memories.push({sessionId:id,role,enc:sealed.enc,attachmentIds,metadata:{tags:[...new Set(['auto-learned',source,modality,...tags])],category,embedding:cognitive?.embedding||null,embeddingModel:cognitive?.embeddingModel||null,
      connections:[],semanticClusterId:cognitive?.semanticClusterId||null,position:position||cognitive?.position||null,importance:cognitive?.importance||.55,celestialType:role==='hub'?'sun':'planet',parentId,
      taxonomyLane:null,projectStatus:null,generatedProvider:null,generatedModel:null,generatedImageProvider:null,generatedImageModel:null,
      learning:{schemaVersion:1,source,modality,learnedAt:now,batchId:importId,attachmentCount:attachmentIds.length},processingMethod:`learned:${source}+${cognitive?'local-embedding':'links-only'}`}});
  }
  // A root hub is also needed when loose files and subfolders are selected together.
  for(const directory of [...(hubIds.has('')?['']:[]),...directories]){
    const parts=directory.split('/');const parentPath=directory?parts.slice(0,-1).join('/'):'';const parentId=directory&&parentPath?hubIds.get(parentPath)!:null;
    const center=parentId?positions.get(parentPath)!:null;const position=center?orbit(center,30+Math.random()*15):await spaced(suns,guard,yieldTask);guard();if(!center)suns.push(position);positions.set(directory,position);
    const direct=processed.filter(item=>item.directory===directory);const children=directories.filter(child=>child.split('/').slice(0,-1).join('/')===directory);
    const categoryGroups=new Map<string,typeof direct>();for(const item of direct)categoryGroups.set(item.category,[...(categoryGroups.get(item.category)||[]),item]);
    const lines=[...categoryGroups].map(([category,items])=>`### ${category}\n${items.map(item=>`- ${item.fileName} (${formatBytes(item.file.size)}, ${item.method}): ${item.digest.overview.slice(0,220)}`).join('\n')}`);
    const name=directory?parts.at(-1)!:`Lote documental (${direct.length})`;
    const text=[directory?`# Pasta de Projeto: ${name}`:`[Sistema solar documental: ${direct.length} ficheiros]`,directory?`Caminho: ${directory}`:'',`Lote: ${importId}`,`Importado em: ${new Date(now).toLocaleString('pt-PT')}`,'',
      ...(children.length?['## Subpastas',...children.map(child=>`- ${child.split('/').at(-1)}`)]:[]),'','## Ficheiros',lines.length?lines.join('\n'):'Apenas subpastas.'].join('\n');
    await seal(hubIds.get(directory)!,'hub',text,directory?`Pasta: ${name}`:name,'Documentos',directory?['directory','folder','projeto','pasta-assimilada',name.toLowerCase(),`projeto:${parts[0].toLowerCase()}`]:['documentos',`lote:${importId}`],
      direct.flatMap(item=>item.attachmentId?[item.attachmentId]:[]),parentId,'mixed',position);
  }
  for(const item of processed){const tags=['documento',`lote:${importId}`,item.category.toLowerCase(),...(item.directory?['projeto',item.directory.split('/')[0].toLowerCase()]:[])];
    await seal(item.id,'document',item.summary,item.fileName,item.category,tags,item.attachmentId?[item.attachmentId]:[],hubIds.get(item.directory)!,item.type,null);}
  const attachments=[];for(const upload of uploads){attachments.push({id:upload.id,headerDigest:await attachmentBytesDigest(encodeAttachmentHeader(upload.header))});guard();}
  const edges=memories.filter(item=>typeof item.metadata.parentId==='string').map(item=>{const [sourceId,targetId]=[item.sessionId,item.metadata.parentId as string].sort();return{sourceId,targetId};});
  const plan=parseDocumentImportPlan({importId,memories,attachments,edges});guard();
  return{plan,uploads,result:{batchId:importId,imported:files.length,hubId:memories[0].sessionId}};
  });
}
