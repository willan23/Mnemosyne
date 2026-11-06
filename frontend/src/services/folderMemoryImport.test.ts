import {expect,it,vi} from 'vitest';
vi.mock('../firebase',()=>({default:{},db:{},auth:{}}));
import {importFolderMemories,type FolderImportDeps} from './folderMemoryImport';
const fixture=()=>({vault:vi.fn(async()=>({imported:25})),documents:vi.fn(async()=>({imported:20}))} as unknown as FolderImportDeps);
const files=(ext:string)=>Array.from({length:25},(_,index)=>{const file=new File(['synthetic'],`Note-${index}.${ext}`);Object.defineProperty(file,'webkitRelativePath',{value:`Vault/Note-${index}.${ext}`});return file;});
it('routes all Markdown notes to the full vault protocol without the generic twenty-file cut',async()=>{
  const deps=fixture();const guard=vi.fn();const input=files('md');expect(await importFolderMemories('alice',input,[],guard,deps)).toEqual({imported:25});expect(deps.documents).not.toHaveBeenCalled();
  expect(deps.vault).toHaveBeenCalledWith('alice',input,[],{assertCurrent:guard});expect(guard).toHaveBeenCalledTimes(2);
});
it('preserves the existing generic document limit and propagates the same captured actor guard',async()=>{
  const deps=fixture();const guard=vi.fn();const input=files('txt');await importFolderMemories('alice',input,[],guard,deps);expect(deps.vault).not.toHaveBeenCalled();expect(deps.documents).toHaveBeenCalledWith('alice',input.slice(0,20),[],{assertCurrent:guard});
});
it('a changed scope refuses dispatch and a late response cannot claim completion',async()=>{
  const deps=fixture();const guard=vi.fn(()=>{throw Error('Synthetic changed scope');});await expect(importFolderMemories('alice',files('md'),[],guard,deps)).rejects.toThrow();expect(deps.vault).not.toHaveBeenCalled();
  guard.mockReset();guard.mockImplementationOnce(()=>undefined).mockImplementation(()=>{throw Error('Synthetic late response');});await expect(importFolderMemories('alice',files('md'),[],guard,deps)).rejects.toThrow();expect(deps.vault).toHaveBeenCalledOnce();
});
