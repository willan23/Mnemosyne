import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ShareModal} from './ShareModal';
const state=vi.hoisted(()=>({uid:'alice' as string|null,ready:true,enabled:true,prepare:vi.fn(),send:vi.fn(),dispose:vi.fn(),qr:vi.fn(),auth:new Set<(value:{uid:string}|null)=>void>(),vault:new Set<()=>void>()}));
vi.mock('../firebase',()=>({auth:{get currentUser(){return state.uid?{uid:state.uid}:null;}}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:(value:{uid:string}|null)=>void)=>{state.auth.add(callback);callback(state.uid?{uid:state.uid}:null);return()=>state.auth.delete(callback);}}));
vi.mock('../services/memoryCrypto',()=>({isMemoryCryptoReady:()=>state.ready,onMemoryCryptoChanged:(callback:()=>void)=>{state.vault.add(callback);return()=>state.vault.delete(callback);}}));
vi.mock('../config/releaseGates',()=>({get CAPSULE_PUBLICATION_ENABLED(){return state.enabled;}}));
vi.mock('../services/capsulePublicationService',()=>({capsulePublicationService:{prepare:(...args:unknown[])=>state.prepare(...args)}}));
vi.mock('qrcode',()=>({default:{toDataURL:(...args:unknown[])=>state.qr(...args)}}));
vi.mock('../utils/export',()=>({downloadMemory:vi.fn()}));
const id='00000000-0000-4000-8000-000000000001';
const memory={id:'a',uid:'alice',updatedAt:100,timestamp:1,text:'SYNTHETIC_PRIVATE_TEXT',title:'Synthetic title'};
const prepared=()=>({request:{publicationId:id,sources:[{sessionId:'a'}]},digest:'a'.repeat(64),send:(...args:unknown[])=>state.send(...args),dispose:()=>state.dispose()});
const show=(props:Partial<React.ComponentProps<typeof ShareModal>>={})=>render(<MemoryRouter><ShareModal session={memory} onClose={vi.fn()} {...props}/></MemoryRouter>);
beforeEach(()=>{
  state.uid='alice';state.ready=true;state.enabled=true;state.auth.clear();state.vault.clear();[state.prepare,state.send,state.dispose,state.qr].forEach(mock=>mock.mockReset());
  state.prepare.mockImplementation(async()=>prepared());state.send.mockResolvedValue({status:'committed',publicationId:id});state.qr.mockResolvedValue('data:image/png;base64,AA==');
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.open=true;}});
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.open=false;}});
});
afterEach(cleanup);
async function generate(){fireEvent.change(screen.getByLabelText(/Passphrase, pelo menos/),{target:{value:'SYNTHETIC_PASSPHRASE'}});fireEvent.click(screen.getByRole('button',{name:'Gerar cápsula cifrada'}));}
it('keeps the dialog draft and linked consent while related rows load, then uses only the ready subset',async()=>{
  const first={...memory,id:'b'},next={...memory,id:'c'},onClose=vi.fn(),retry=vi.fn();
  const view=show({relatedSessions:[first],onClose,onRetryRelated:retry});
  fireEvent.change(screen.getByLabelText(/Passphrase, pelo menos/),{target:{value:'SYNTHETIC_PASSPHRASE'}});fireEvent.click(screen.getByRole('checkbox',{name:/memória\(s\) ligada/}));
  const rerender=(status:'ready'|'loading'|'unavailable',rows:typeof memory[])=>view.rerender(<MemoryRouter><ShareModal session={memory} onClose={onClose} relatedSessions={rows} relatedStatus={status} onRetryRelated={retry}/></MemoryRouter>);
  rerender('loading',[]);expect(screen.getByRole('button',{name:'Gerar cápsula cifrada'})).toBeDisabled();expect(screen.getByLabelText(/Passphrase, pelo menos/)).toHaveValue('SYNTHETIC_PASSPHRASE');expect(screen.getByRole('checkbox',{name:/memória\(s\) ligada/})).toBeChecked();
  rerender('unavailable',[]);fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));expect(retry).toHaveBeenCalledOnce();expect(state.prepare).not.toHaveBeenCalled();
  rerender('ready',[next]);fireEvent.click(screen.getByRole('button',{name:'Gerar cápsula cifrada'}));await waitFor(()=>expect(state.send).toHaveBeenCalledOnce());
  expect(state.prepare.mock.calls[0][0].map((row:{id:string})=>row.id)).toEqual(['a','c']);
});
it('disposes a linked preparation that finishes after its related view changes and unlocks the draft for retry',async()=>{
  let finish!:(value:ReturnType<typeof prepared>)=>void;state.prepare.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
  const rows=[{...memory,id:'b'}],onClose=vi.fn(),view=show({relatedSessions:rows,onClose});
  fireEvent.click(screen.getByRole('checkbox',{name:/memória\(s\) ligada/}));await generate();await waitFor(()=>expect(state.prepare).toHaveBeenCalledOnce());
  view.rerender(<MemoryRouter><ShareModal session={memory} onClose={onClose} relatedSessions={[]} relatedStatus="loading"/></MemoryRouter>);
  await act(async()=>finish(prepared()));expect(state.dispose).toHaveBeenCalledOnce();expect(state.send).not.toHaveBeenCalled();
  view.rerender(<MemoryRouter><ShareModal session={memory} onClose={onClose} relatedSessions={rows} relatedStatus="ready"/></MemoryRouter>);
  expect(screen.getByRole('button',{name:'Gerar cápsula cifrada'})).toBeEnabled();await generate();await waitFor(()=>expect(state.send).toHaveBeenCalledOnce());expect(state.prepare).toHaveBeenCalledTimes(2);
});
it('can resume its already prepared encrypted request while the live related subset is unavailable',async()=>{
  state.send.mockRejectedValueOnce(Error('Lost synthetic receipt'));const onClose=vi.fn(),rows=[{...memory,id:'b'}],view=show({relatedSessions:rows,onClose});
  fireEvent.click(screen.getByRole('checkbox',{name:/memória\(s\) ligada/}));await generate();await waitFor(()=>expect(screen.getByRole('button',{name:'Retomar publicação'})).toBeEnabled());
  view.rerender(<MemoryRouter><ShareModal session={memory} onClose={onClose} relatedSessions={[]} relatedStatus="loading"/></MemoryRouter>);
  fireEvent.click(screen.getByRole('button',{name:'Retomar publicação'}));await waitFor(()=>expect(state.send).toHaveBeenCalledTimes(2));expect(state.prepare).toHaveBeenCalledOnce();
});
it('only exposes a confirmed link and retains one prepared request after a lost response',async()=>{
  state.send.mockRejectedValueOnce(Error('PRIVATE_DIAGNOSTIC'));show();await generate();
  expect(screen.queryByLabelText('Link da cápsula confirmada')).toBeNull();await screen.findByRole('button',{name:'Retomar publicação'});
  await waitFor(()=>expect(screen.getByRole('button',{name:'Retomar publicação'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Retomar publicação'}));
  const input=await screen.findByLabelText('Link da cápsula confirmada');expect((input as HTMLInputElement).value.includes(id)).toBe(true);expect((input as HTMLInputElement).value.includes('SYNTHETIC_PASSPHRASE')).toBe(false);
  expect(state.prepare).toHaveBeenCalledTimes(1);expect(state.send.mock.calls.map(call=>call[0])).toEqual(['publish','publish']);expect(screen.queryByText('PRIVATE_DIAGNOSTIC')).toBeNull();
  const management=screen.getByRole('link',{name:'Gerir e retirar cápsulas'});expect(management.getAttribute('href')).toBe('/capsules#share='+id);
});
it('cancels an unconfirmed request only after a server acknowledgement',async()=>{
  state.send.mockRejectedValueOnce(Error('Synthetic lost response')).mockResolvedValueOnce({status:'cancelled',publicationId:id});show();await generate();
  await waitFor(()=>expect(screen.getByRole('button',{name:'Cancelar pedido'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Cancelar pedido'}));
  await screen.findByText('Pedido cancelado.');expect(state.send).toHaveBeenLastCalledWith('cancel');expect(state.dispose).toHaveBeenCalled();expect(screen.getByLabelText(/Passphrase, pelo menos/)).toBeEnabled();expect(screen.queryByLabelText('Link da cápsula confirmada')).toBeNull();
});
it('filters related sources to the same readable scope and preserves the 13-source pack capacity',async()=>{
  const related=Array.from({length:15},(_,index)=>({...memory,id:'own-'+index}));related.push({...memory,id:'foreign',uid:'bob'});related.push({...memory,id:'team',teamId:'crew'} as typeof memory);
  show({relatedSessions:related});fireEvent.click(screen.getByRole('checkbox',{name:/Incluir 12 memória/}));await generate();await screen.findByLabelText('Link da cápsula confirmada');
  const sources=state.prepare.mock.calls[0][0] as Array<{id:string}>;expect(sources).toHaveLength(13);expect(sources.some(row=>row.id==='foreign'||row.id==='team')).toBe(false);
});
it('account change while encryption is pending disposes the result without publishing or displaying a late link',async()=>{
  let resolve!:(value:unknown)=>void;state.prepare.mockReturnValueOnce(new Promise(done=>{resolve=done;}));show();await generate();await waitFor(()=>expect(state.prepare).toHaveBeenCalledOnce());
  await act(async()=>{state.uid='bob';state.auth.forEach(callback=>callback({uid:'bob'}));});await act(async()=>{resolve(prepared());});
  expect(state.send).not.toHaveBeenCalled();expect(state.dispose).toHaveBeenCalled();expect(screen.queryByRole('dialog')).toBeNull();expect(screen.queryByLabelText('Link da cápsula confirmada')).toBeNull();
});
it('keeps publication closed while preserving local export and existing-link management',async()=>{
  state.enabled=false;show();expect(screen.getByRole('button',{name:'Gerar cápsula cifrada'})).toBeDisabled();expect(screen.getByRole('link',{name:'Gerir e retirar cápsulas'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Exportar TXT'})).toBeEnabled();expect(state.prepare).not.toHaveBeenCalled();
});
it('native cancellation closes the dialog and retires pending work',async()=>{
  const close=vi.fn();show({onClose:close});await generate();await screen.findByLabelText('Link da cápsula confirmada');fireEvent(screen.getByRole('dialog'),new Event('cancel',{bubbles:true,cancelable:true}));expect(close).toHaveBeenCalledOnce();expect(state.dispose).toHaveBeenCalled();
});
