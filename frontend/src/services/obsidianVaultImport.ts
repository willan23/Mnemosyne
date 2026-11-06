/** Client-only Obsidian parsing and sealing; durable creation/progress belongs to the import protocol. */
import type {SessionData} from '../hooks/useSessions';
import {celestialTypeForLane,laneTag,type ProjectStatus,type TaxonomyLane} from '../utils/taxonomy';
import {buildEncryptedMemoryFields} from './memoryCrypto';
import {startCapturedObsidianImport,type CapturedObsidianImport} from './obsidianImportRecovery';
import {parseObsidianImportPlan,type ObsidianImportEdge,type ObsidianImportMemory} from '../../../functions/src/obsidianImportContract';
import {buildWikilinkIndex,looksLikeObsidianVault,isMarkdownVaultFile,parseObsidianFiles,resolveNoteConnections,summarizeParseStats,type ParsedObsidianNote} from './obsidianVaultParse';

export const MAX_OBSIDIAN_VAULT_NOTES=150;
export const MAX_OBSIDIAN_NOTE_CHARS=120_000;
export interface ObsidianVaultImportResult{imported:number;linked:number;unresolvedLinks:number;hubIds:string[];memoryIds:string[];statsLabel:string;skipped:number}
export interface ObsidianImportOptions{onProgress?:(done:number,total:number)=>void;sourceTag?:'obsidian-vault'|'starter-universe';skipped?:number;batchPrefix?:string;assertCurrent?:()=>void}
export interface ObsidianPlanBuildDeps{id:()=>string;encrypt:typeof buildEncryptedMemoryFields}
const unique=(values:string[])=>[...new Set(values.filter(Boolean))];
function categoryForLane(lane:TaxonomyLane|null,folder:string|null):string{
  if(lane==='A')return'Diário';if(lane==='B')return'Projetos';if(lane==='C')return'Fundamentos';if(lane==='D')return'Ferramentas';if(lane==='E')return'Biblioteca';return folder||'Obsidian';
}
function spacedPosition(index:number,lane:TaxonomyLane|null,total:number):[number,number,number]{
  const offsets:Record<TaxonomyLane,number>={A:-40,B:-20,C:0,D:20,E:40};const angle=index/Math.max(total,1)*Math.PI*2;const radius=12+index%7*3;
  return[(lane?offsets[lane]:0)+Math.cos(angle)*radius,(index%5-2)*2.5,Math.sin(angle)*radius];
}
function captureNotes(notes:ParsedObsidianNote[]):ParsedObsidianNote[]{
  if(!Array.isArray(notes)||!notes.length||notes.length>MAX_OBSIDIAN_VAULT_NOTES)throw new Error('Importa entre uma e 150 notas Markdown por lote.');
  const result=structuredClone(notes);const paths=new Set<string>();
  for(const note of result){
    if(!note||!['path','stem','title','content'].every(key=>typeof note[key as keyof ParsedObsidianNote]==='string')||!note.path||note.path.length>1024||note.stem.length>1000||note.title.length>1000||note.content.length>MAX_OBSIDIAN_NOTE_CHARS||paths.has(note.path)||
      (note.topFolder!==null&&(typeof note.topFolder!=='string'||note.topFolder.length>200))||(note.lane!==null&&!['A','B','C','D','E'].includes(note.lane))||
      (note.projectStatus!==null&&!['planned','active','done'].includes(note.projectStatus))||!Array.isArray(note.wikilinks)||note.wikilinks.some(link=>typeof link!=='string'||link.length>1000)||
      !note.frontmatter||!Array.isArray(note.frontmatter.tags)||note.frontmatter.tags.length>90||note.frontmatter.tags.some(tag=>typeof tag!=='string'||tag.length>200)||
      !Array.isArray(note.frontmatter.aliases)||note.frontmatter.aliases.length>100||note.frontmatter.aliases.some(alias=>typeof alias!=='string'||alias.length>1000)||
      !note.frontmatter.raw||typeof note.frontmatter.raw!=='object'||Array.isArray(note.frontmatter.raw))throw new Error('O lote contém notas inválidas ou demasiado grandes.');
    paths.add(note.path);
  }
  return result;
}
export async function buildObsidianImportPlan(input:ParsedObsidianNote[],options:ObsidianImportOptions={},guard:()=>void=()=>{},deps:ObsidianPlanBuildDeps={id:()=>crypto.randomUUID(),encrypt:buildEncryptedMemoryFields}):Promise<CapturedObsidianImport>{
  guard();const notes=captureNotes(input);const source=options.sourceTag??'obsidian-vault';const importId=`${options.batchPrefix??'obsidian'}-${deps.id()}`;
  const topFolders=unique(notes.map(note=>note.topFolder).filter((folder):folder is string=>folder!==null));
  const hubByFolder=new Map(topFolders.map(folder=>[folder,deps.id()]));const created=notes.map(note=>({id:deps.id(),note}));
  const drafts:Array<{sessionId:string;role:'hub'|'note';text:string;title:string;metadata:Record<string,unknown>}>=[];
  for(let index=0;index<topFolders.length;index++){
    const folder=topFolders[index];const lane=notes.find(note=>note.topFolder===folder)?.lane??null;
    drafts.push({sessionId:hubByFolder.get(folder)!,role:'hub',title:folder,
      text:[`[Constelação: ${folder}]`,'Pasta de topo importada.',`Notas neste cluster: ${notes.filter(note=>note.topFolder===folder).length}.`,lane?`Lane: ${lane}`:''].filter(Boolean).join('\n'),
      metadata:{tags:unique(['auto-learned',source,'text',source==='starter-universe'?'starter':'obsidian','vault','folder-hub',`lote:${importId}`,lane?laneTag(lane):'']),category:categoryForLane(lane,folder),connections:[],importance:0.55,celestialType:'sun',
        parentId:null,taxonomyLane:lane,projectStatus:null,position:spacedPosition(index,lane,topFolders.length+2).map((value,axis)=>axis===1?value+8:value*1.8)}});
  }
  for(let index=0;index<created.length;index++){
    const {id,note}=created[index];const header=note.title&&!note.content.startsWith(note.title)?`${note.title}\n\n`:'';
    drafts.push({sessionId:id,role:'note',text:`${header}${note.content}`.trim(),title:note.title,
      metadata:{tags:unique(['auto-learned',source,'text',source==='starter-universe'?'starter':'obsidian','vault',`lote:${importId}`,note.lane?laneTag(note.lane):'',note.projectStatus?`status:${note.projectStatus}`:'',...note.frontmatter.tags.map(tag=>tag.replace(/^#/,''))]),
        category:categoryForLane(note.lane,note.topFolder),connections:[],importance:0.55,celestialType:celestialTypeForLane(note.lane),parentId:note.topFolder?hubByFolder.get(note.topFolder)!:null,taxonomyLane:note.lane,projectStatus:note.projectStatus,position:spacedPosition(index,note.lane,notes.length)}});
  }
  const edges:ObsidianImportEdge[]=[];const pairs=new Set<string>();const add=(first:string,second:string,kind:ObsidianImportEdge['kind'])=>{
    const [sourceId,targetId]=[first,second].sort();const key=JSON.stringify([sourceId,targetId]);if(pairs.has(key))return;pairs.add(key);edges.push({sourceId,targetId,kind});
  };
  for(const draft of drafts)if(typeof draft.metadata.parentId==='string')add(draft.sessionId,draft.metadata.parentId,'parent');
  const wikilinks=buildWikilinkIndex(created);let unresolvedLinks=0;
  for(const {id,note}of created){const {resolved,unresolved}=resolveNoteConnections(note,wikilinks,id);unresolvedLinks+=unresolved.length;for(const target of resolved)add(id,target,'wikilink');}
  // Validate the entire shape/topology before the first encryption or outbound mutation.
  const placeholder={v:1 as const,iv:'A'.repeat(16),ct:'B'.repeat(32)};
  parseObsidianImportPlan({importId,source,memories:drafts.map(draft=>({sessionId:draft.sessionId,role:draft.role,metadata:draft.metadata,enc:placeholder})),edges});guard();
  const memories:ObsidianImportMemory[]=[];
  for(const draft of drafts){guard();const sealed=await deps.encrypt(draft.text,draft.title);guard();memories.push({sessionId:draft.sessionId,role:draft.role,metadata:draft.metadata,enc:sealed.enc});}
  const plan=parseObsidianImportPlan({importId,source,memories,edges});guard();const lanes:Partial<Record<TaxonomyLane,number>>={};for(const note of notes)if(note.lane)lanes[note.lane]=(lanes[note.lane]??0)+1;
  return{plan,result:{imported:notes.length,linked:edges.filter(edge=>edge.kind==='wikilink').length,unresolvedLinks,hubIds:[...hubByFolder.values()],memoryIds:created.map(item=>item.id),
    statsLabel:summarizeParseStats({notes:notes.length,withFrontmatter:notes.filter(note=>Object.keys(note.frontmatter.raw).length>0).length,wikilinkRefs:notes.reduce((sum,note)=>sum+note.wikilinks.length,0),lanes}),skipped:options.skipped??0}};
}
export{looksLikeObsidianVault};
export async function importParsedObsidianNotes(uid:string,notes:ParsedObsidianNote[],_existingMemories?:SessionData[],options:ObsidianImportOptions={}):Promise<ObsidianVaultImportResult>{
  const captured=captureNotes(notes);const selected={...options};
  return startCapturedObsidianImport(uid,guard=>buildObsidianImportPlan(captured,selected,guard),selected.assertCurrent,selected.onProgress);
}
export async function importObsidianVault(uid:string,files:File[],_existingMemories?:SessionData[],options:{onProgress?:(done:number,total:number)=>void;assertCurrent?:()=>void}={}):Promise<ObsidianVaultImportResult>{
  const captured=[...files];const selected={...options};
  return startCapturedObsidianImport(uid,async guard=>{
    if(captured.some(file=>isMarkdownVaultFile(file)&&file.size>1_000_000))throw new Error('O lote contém uma nota demasiado grande.');
    const {notes,skipped}=await parseObsidianFiles(captured,guard);guard();return buildObsidianImportPlan(notes,{skipped:skipped.length,sourceTag:'obsidian-vault',batchPrefix:'obsidian'},guard);
  },selected.assertCurrent,selected.onProgress);
}
export type{ProjectStatus,TaxonomyLane};
