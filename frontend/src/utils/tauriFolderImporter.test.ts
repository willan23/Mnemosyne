import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({readDir:vi.fn(),readFile:vi.fn()}));
vi.mock('@tauri-apps/plugin-fs',()=>state);
import {selectAndReadTauriDirectory} from './tauriFolderImporter';
beforeEach(()=>{state.readDir.mockReset();state.readFile.mockReset();state.readDir.mockResolvedValue([{name:'first.md',isFile:true},{name:'second.md',isFile:true}]);state.readFile.mockResolvedValue(new TextEncoder().encode('Synthetic'));});
it('preserves relative Markdown paths and ignores hidden entries',async()=>{
  state.readDir.mockResolvedValue([{name:'.obsidian',isDirectory:true},{name:'note.md',isFile:true}]);const files=await selectAndReadTauriDirectory('C:\\Synthetic\\Vault');expect(files).toHaveLength(1);expect(files[0].webkitRelativePath).toBe('Vault/note.md');
  const text=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsText(files[0]);});expect(text).toBe('Synthetic');expect(state.readDir).toHaveBeenCalledOnce();
});
it.each(['directory','file'])('a scope transition during %s read stops before the next file',async stage=>{
  let current=true;const guard=()=>{if(!current)throw Error('Synthetic changed scope');};
  if(stage==='directory')state.readDir.mockImplementation(async()=>{current=false;return[{name:'first.md',isFile:true}];});else state.readFile.mockImplementation(async()=>{current=false;return new Uint8Array();});
  await expect(selectAndReadTauriDirectory('C:\\Synthetic\\Vault',guard)).rejects.toThrow('Synthetic changed scope');expect(state.readFile).toHaveBeenCalledTimes(stage==='directory'?0:1);
});
it('an unreadable file fails the whole selection without logging its path or silently skipping it',async()=>{
  const log=vi.spyOn(console,'warn');state.readFile.mockRejectedValue(Error('Synthetic private path'));await expect(selectAndReadTauriDirectory('C:\\Synthetic\\Vault')).rejects.toThrow('Não foi possível ler');expect(state.readFile).toHaveBeenCalledOnce();expect(log).not.toHaveBeenCalled();log.mockRestore();
});
