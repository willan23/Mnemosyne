import type {SessionData} from '../hooks/useSessions';
import {importObsidianVault,looksLikeObsidianVault} from './obsidianVaultImport';
import {learnDocumentBatch} from './learningService';
export interface FolderImportDeps{vault:typeof importObsidianVault;documents:typeof learnDocumentBatch}
/** Both settings pickers retain a Markdown vault's full topology and captured actor. */
export async function importFolderMemories(uid:string,files:File[],memories:readonly SessionData[],guard:()=>void,deps:FolderImportDeps={vault:importObsidianVault,documents:learnDocumentBatch}){
  guard();const captured=[...files];
  const result=looksLikeObsidianVault(captured)?await deps.vault(uid,captured,memories,{assertCurrent:guard}):await deps.documents(uid,captured.slice(0,20),memories,{assertCurrent:guard});
  guard();return{imported:result.imported};
}
