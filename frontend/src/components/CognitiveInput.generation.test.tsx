vi.mock('./CommsP2PContentRecoveryPanel',()=>({CommsP2PContentRecoveryPanel:()=>null}));
vi.mock('../services/commsP2PContent',()=>({hasPendingCommsP2PContent:()=>false,observeCommsP2PContent:()=>()=>{},observeCommsP2PInbox:()=>()=>{},readCommsP2PInbox:async()=>({rows:[],next:null,scanned:0,unavailable:0}),acknowledgeStoredCommsP2P:vi.fn(),resumeCommsP2PContent:vi.fn(),createCommsP2PContentLink:vi.fn(),sendCommsP2PContent:vi.fn()}));
vi.mock('../services/commsP2PSignaling',()=>({commsP2PRequestBinding:(value:Record<string,unknown>)=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='actorUid')),hasPendingCommsP2P:()=>false,hasStoredCommsP2PSession:()=>false,observeCommsP2P:()=>()=>{},mutateCommsP2PSignal:vi.fn(),watchCommsP2PSignal:()=>()=>{},commsP2PHash:vi.fn()}));
vi.mock('./CommsP2PRecoveryPanel',()=>({CommsP2PRecoveryPanel:()=>null}));
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CognitiveInput } from './CognitiveInput';

const state = vi.hoisted(() => ({ uid: 'alice', attachments: true, generateText: vi.fn(), generateImage: vi.fn(),
  learnText: vi.fn(), learnImage: vi.fn(), revise: vi.fn(), success: vi.fn(), error: vi.fn(), personalCreate: vi.fn(),teamCreate:vi.fn(), semantic: vi.fn(), preview: vi.fn(), previewTeamActive: false, previewEpoch: 1, ready: true, personalEnabled: true,teamEnabled:true, pending: false,revisionPending:false,teamRevisionPending:false, contexts: [] as unknown[] }));
vi.mock('../firebase', () => ({ db: {}, auth: { get currentUser() { return { uid: state.uid }; } } }));
vi.mock('../contexts/UIContext', () => ({ useUI: () => ({ isCommandPaletteOpen: false }) }));
vi.mock('../hooks/useSubscription', () => ({ useSubscription: () => ({ canCreateMemory: () => true, getRemainingMemories: () => 20, isLoading: false }) }));
vi.mock('../hooks/useMyTeams', () => ({ useMyTeams: () => [{ id: 'synthetic-team', name: 'Synthetic team', memberUids: ['alice'], keyRotationStatus: state.previewTeamActive ? 'active' : 'rotation_pending', activeKeyEpoch: state.previewEpoch, activeKeyId: 'synthetic-key' }] }));
vi.mock('../config/monetization', () => ({ isFreeFirstMode: true }));
vi.mock('../config/releaseGates', () => ({ TEAM_WRITES_ENABLED: true, get ATTACHMENT_WRITES_ENABLED() { return state.attachments; }, ATTACHMENT_READ_ONLY_MESSAGE: 'Synthetic attachments closed' }));
vi.mock('../utils/translations', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../utils/desktopCapture', () => ({ OPEN_CAPTURE_EVENT: 'synthetic-capture-open', notifyCaptureActive: vi.fn() }));
// Preview Worker lifecycle/ranking is exercised by its own hook/client/browser tests.
vi.mock('../hooks/useCapturePreview', () => ({ useCapturePreview: (...args: unknown[]) => state.preview(...args) }));
vi.mock('../services/aiGenerationService', () => ({ generateTextFromPrompt: (...args: unknown[]) => state.generateText(...args), generateImageFromPrompt: (...args: unknown[]) => state.generateImage(...args) }));
vi.mock('../services/aiGenerationContext', () => ({ withAiGenerationContext: async (input: { uid: string; teamId?: string }, work: (context: unknown) => Promise<unknown>) => {
  if (input.uid !== state.uid) throw Error('Synthetic account changed');
  const assertCurrent = () => {if(input.uid !== state.uid || !state.ready) throw Error('Synthetic account/vault changed');};
  const context = { uid: input.uid, scope: input.teamId ? { kind: 'team', teamId: input.teamId, keyEpoch: 1, keyId: 'synthetic-key' } : { kind: 'personal' }, assertCurrent, assertAccess: async () => assertCurrent() };
  state.contexts.push(context); const result = await work(context);
  if (input.uid !== state.uid) throw Error('Synthetic account changed'); return result;
} }));
vi.mock('../services/learningService', () => ({ learnGeneratedText: (...args: unknown[]) => state.learnText(...args),
  learnGeneratedImage: (...args: unknown[]) => state.learnImage(...args), reviseLearnedMemory: (...args: unknown[]) => state.revise(...args),
  learnDocumentBatch: vi.fn(), sessionToMemoryObject: (session: {id:string}) => ({id:session.id}) }));
vi.mock('../services/obsidianVaultImport', () => ({ importObsidianVault: vi.fn(), looksLikeObsidianVault: () => false }));
vi.mock('../services/memoryCrypto', () => ({ MemoryCryptoLockedError: class extends Error {} }));
vi.mock('../services/sessionMemoryFields', () => ({ buildSessionWriteFields: vi.fn() }));
vi.mock('../services/teamKeyAccess', () => ({ unlockTeamKey: vi.fn() }));
vi.mock('../services/attachmentUploadClient', () => ({ uploadEncryptedAttachment: vi.fn() }));
vi.mock('../services/attachedMemoryRecovery', () => ({ createMemoryWithAttachments: vi.fn(),createTeamMemory:(...args:unknown[])=>state.teamCreate(...args),assertTeamMemoryCreationEnabled:()=>{if(!state.teamEnabled)throw Error('Synthetic team creation closed');}, createPersonalMemory: (...args: unknown[]) => state.personalCreate(...args), hasPendingAttachedMemoryCreation: () => state.pending,
  assertPersonalMemoryCreationEnabled:()=>{if(!state.personalEnabled)throw Error('Synthetic personal creation closed');} }));
vi.mock('../engines/CognitiveEngine', () => ({ cognitiveEngine: { processMemory: (...args: unknown[]) => state.semantic(...args), generateTitle: () => 'Synthetic manual title' } }));
vi.mock('../services/localAiConfig', () => ({getLocalAiConfig: () => ({memoryPermission:'never-cloud',failurePolicy:'save-with-warning'})}));
vi.mock('./AttachedMemoryRecoveryPanel', () => ({ AttachedMemoryRecoveryPanel: () => null }));
vi.mock('./ClipCaptureRecoveryPanel', () => ({ ClipCaptureRecoveryPanel: () => null }));
vi.mock('./PersonalConnectionRecoveryPanel', () => ({ PersonalConnectionRecoveryPanel: () => null }));
vi.mock('./ObsidianImportRecoveryPanel',()=>({ObsidianImportRecoveryPanel:()=>null}));
vi.mock('./DocumentImportRecoveryPanel',()=>({DocumentImportRecoveryPanel:()=>null}));
vi.mock('./PersonalRevisionRecoveryPanel',()=>({PersonalRevisionRecoveryPanel:()=>null}));
vi.mock('./TeamRevisionRecoveryPanel',()=>({TeamRevisionRecoveryPanel:()=>null}));
vi.mock('../services/teamRevisionRecovery',()=>({hasPendingTeamRevision:()=>state.teamRevisionPending}));
vi.mock('./CommsImportRecoveryPanel',()=>({CommsImportRecoveryPanel:()=>null}));
vi.mock('./CommsIdentityRolloverPanel',()=>({CommsIdentityRolloverPanel:()=>null}));
vi.mock('./CommsContactRecoveryPanel',()=>({CommsContactRecoveryPanel:()=>null}));
vi.mock('./CommsDeliveryRecoveryPanel',()=>({CommsDeliveryRecoveryPanel:()=>null}));
vi.mock('../services/personalLearnedRevision',()=>({hasPendingPersonalRevision:()=>state.revisionPending}));
vi.mock('../hooks/useSyncFeedback',()=>({useSyncFeedback:()=>({epoch:0,capture:(uid:string)=>()=>state.uid===uid && state.ready})}));
// These tests isolate generation/persistence orchestration; real encrypted draft scope/storage has its own hook/browser suite.
vi.mock('../hooks/useCognitiveDraft',async()=>{const {useState,useRef}=await import('react');return{useCognitiveDraft:()=>{
  const edit=useRef(0);const [text,writeText]=useState(''),[generatedImage,setGeneratedImage]=useState<unknown>(null),[generatedImagePrompt,setGeneratedImagePrompt]=useState('');
  const setText=(value:string)=>{edit.current++;writeText(value);};
  const [learnedGeneration,setLearnedGeneration]=useState<unknown>(null),[targetTeamId,setTargetTeamId]=useState('');
  return{text,setText,generatedImage,setGeneratedImage,generatedImagePrompt,setGeneratedImagePrompt,learnedGeneration,setLearnedGeneration,targetTeamId,setTargetTeamId,
    ready:state.ready,message:null,dirty:false,flush:async()=>{},discard:async()=>{},scope:state.uid,capture:()=>()=>state.ready,captureEdit:()=>{const captured=edit.current;return()=>captured===edit.current&&state.ready;},
    setGenerationResult:(value:{text:string;image:unknown;imagePrompt:string;generation:unknown})=>{setText(value.text);setGeneratedImage(value.image);setGeneratedImagePrompt(value.imagePrompt);setLearnedGeneration(value.generation);}};
}};});
vi.mock('./ImageLightbox', () => ({ ImageLightbox: () => null }));
vi.mock('react-hot-toast', () => ({ default: { success: (...args: unknown[]) => state.success(...args), error: (...args: unknown[]) => state.error(...args) } }));

beforeEach(() => {
  state.uid = 'alice'; state.attachments = true; state.ready = true; state.personalEnabled=true;state.teamEnabled=true;state.pending=false;state.revisionPending=false;state.teamRevisionPending=false;state.contexts = [];
  state.preview.mockReset().mockReturnValue([]); state.previewTeamActive = false; state.previewEpoch = 1;
  [state.generateText, state.generateImage, state.learnText, state.learnImage, state.revise, state.success, state.error, state.personalCreate,state.teamCreate, state.semantic].forEach(mock => mock.mockReset());
  state.semantic.mockResolvedValue({embedding:[1],embeddingModel:'synthetic-local'});state.personalCreate.mockResolvedValue({id:'synthetic-manual'});state.teamCreate.mockResolvedValue({id:'synthetic-team-confirmed'});
  state.generateText.mockResolvedValue('Synthetic answer'); state.learnText.mockResolvedValue({ id: 'synthetic-text-id' });
  state.generateImage.mockResolvedValue({ dataUrl: 'data:image/png;base64,c3ludGhldGlj', mediaType: 'image/png', provider: 'synthetic' });
  state.learnImage.mockResolvedValue({ id: 'synthetic-image-id' }); state.revise.mockResolvedValue(undefined);
  sessionStorage.clear();
});
it('binds the capture preview to the active team epoch and withdraws it on rotation, account change or vault lock', () => {
  state.previewTeamActive = true;
  const rows = [{ id: 'synthetic', uid: 'alice', text: 'Synthetic observation', timestamp: 1, updatedAt: 1 }];
  const { rerender } = render(<CognitiveInput existingMemories={rows} />);
  act(() => window.dispatchEvent(new Event('synthetic-capture-open')));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Synthetic draft for related memories' } });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'synthetic-team' } });
  const first = state.preview.mock.lastCall![2]; expect(first).toMatchObject({ uid: 'alice', teamId: 'synthetic-team' });
  state.previewEpoch = 2; rerender(<CognitiveInput existingMemories={rows} />);
  expect(state.preview.mock.lastCall![2].key).not.toBe(first.key);
  state.previewTeamActive = false; rerender(<CognitiveInput existingMemories={rows} />); expect(state.preview.mock.lastCall![2]).toBeNull();
  state.previewTeamActive = true; state.uid = 'bob'; rerender(<CognitiveInput existingMemories={rows} />); expect(state.preview.mock.lastCall![2]).toBeNull();
  state.uid = 'alice'; state.ready = false; rerender(<CognitiveInput existingMemories={rows} />); expect(state.preview.mock.lastCall![2]).toBeNull();
});
async function composer(command: string, team = true) {
  render(<CognitiveInput />);
  act(() => window.dispatchEvent(new Event('synthetic-capture-open')));
  const input = await screen.findByRole('textbox');
  fireEvent.change(input, { target: { value: command } });
  if (team) fireEvent.change(screen.getByRole('combobox'), { target: { value: 'synthetic-team' } });
  return input;
}
it('uses one team context for generation and learning, then preserves that team during revision', async () => {
  const input = await composer('/texto gerar Synthetic prompt');
  fireEvent.click(screen.getByRole('button', { name: 'Cristalizar pensamento' }));
  await waitFor(() => expect(state.success).toHaveBeenCalledOnce());
  expect(state.generateText).toHaveBeenCalledWith('Synthetic prompt', { context: state.contexts[0] });
  expect(state.learnText).toHaveBeenCalledWith('alice', 'Synthetic prompt', 'Synthetic answer', [], state.contexts[0]);
  expect(screen.getByRole('combobox')).toBeDisabled();
  fireEvent.change(input, { target: { value: 'Synthetic revised answer' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cristalizar pensamento' }));
  await waitFor(() => expect(state.revise).toHaveBeenCalledOnce());
  expect(state.contexts[1]).toMatchObject({ uid: 'alice', scope: { kind: 'team', teamId: 'synthetic-team' } });
  expect(state.revise).toHaveBeenCalledWith('synthetic-text-id', 'alice', 'Synthetic revised answer', [], expect.objectContaining({uid:'alice',scope:{kind:'team',teamId:'synthetic-team',keyEpoch:1,keyId:'synthetic-key'},assertCurrent:expect.any(Function)}),undefined,undefined);
});
it('does not revise an existing generation under a different account', async () => {
  const input = await composer('/texto gerar Synthetic prompt', false);
  fireEvent.click(screen.getByRole('button', { name: 'Cristalizar pensamento' }));
  await waitFor(() => expect(state.success).toHaveBeenCalledOnce());
  state.uid = 'bob'; fireEvent.change(input, { target: { value: 'Synthetic revised answer' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cristalizar pensamento' }));
  await waitFor(() => expect(state.error).toHaveBeenCalled());
  expect(state.revise).not.toHaveBeenCalled(); expect(state.success).toHaveBeenCalledOnce();
});
it('publishes image preview and success only after learning succeeds in its team scope', async () => {
  await composer('/imagem gerar Synthetic image'); state.learnImage.mockRejectedValue(Error('Synthetic persistence failed'));
  fireEvent.click(screen.getByRole('button', { name: 'Cristalizar pensamento' }));
  await waitFor(() => expect(state.error).toHaveBeenCalled());
  expect(state.generateImage).toHaveBeenCalledWith('Synthetic image', { context: state.contexts[0] });
  expect(state.learnImage).toHaveBeenCalledWith('alice', 'Synthetic image', expect.anything(), [], state.contexts[0]);
  expect(screen.queryByAltText('Imagem gerada pela IA')).toBeNull(); expect(state.success).not.toHaveBeenCalled();
});
it('does not spend provider budget on a learned image while attachment writes are closed', async () => {
  state.attachments = false; await composer('/imagem gerar Synthetic image');
  fireEvent.click(screen.getByRole('button', { name: 'Cristalizar pensamento' }));
  await waitFor(() => expect(state.error).toHaveBeenCalledWith('Synthetic attachments closed'));
  expect(state.generateImage).not.toHaveBeenCalled(); expect(state.learnImage).not.toHaveBeenCalled();
});
it('manual personal text uses the durable creator with the context captured before semantic enrichment',async()=>{
  await composer('Synthetic manual thought',false);fireEvent.click(screen.getByRole('button',{name:'Cristalizar pensamento'}));
  await waitFor(()=>expect(state.personalCreate).toHaveBeenCalledOnce());await waitFor(()=>expect(state.success).toHaveBeenCalledOnce());
  expect(state.personalCreate).toHaveBeenCalledWith(expect.objectContaining({uid:'alice',text:'Synthetic manual thought',metadata:expect.objectContaining({connections:[]})}),undefined,expect.any(Function));
  expect(state.generateText).not.toHaveBeenCalled();expect(state.generateImage).not.toHaveBeenCalled();
});
it('manual account or vault loss during enrichment prevents creation and suppresses stale feedback',async()=>{
  for(const mode of ['account','vault']){
    const view=render(<CognitiveInput />);act(()=>window.dispatchEvent(new Event('synthetic-capture-open')));
    fireEvent.change(await screen.findByRole('textbox'),{target:{value:'Synthetic manual thought'}});
    let finish!:()=>void;state.semantic.mockImplementationOnce(()=>new Promise(resolve=>{finish=()=>resolve({embedding:[1]});}));
    fireEvent.click(screen.getByRole('button',{name:'Cristalizar pensamento'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));
    await act(async()=>{if(mode==='account')state.uid='bob';else state.ready=false;finish();});
    expect(state.personalCreate).not.toHaveBeenCalled();expect(state.success).not.toHaveBeenCalled();expect(state.error).not.toHaveBeenCalled();
    view.unmount();state.uid='alice';state.ready=true;
  }
});
it('manual late creation acknowledgement after account switch leaves the draft and suppresses success',async()=>{
  await composer('Synthetic manual thought',false);let finish!:(result:unknown)=>void;
  state.personalCreate.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  fireEvent.click(screen.getByRole('button',{name:'Cristalizar pensamento'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));
  await act(async()=>{state.uid='bob';finish({id:'synthetic-manual'});});
  expect(screen.getByRole('textbox')).toHaveValue('Synthetic manual thought');expect(state.success).not.toHaveBeenCalled();expect(state.error).not.toHaveBeenCalled();
});
it('closed personal creation or a pending operation prevents provider spending for generated text',async()=>{
  for(const mode of ['closed','pending']){
    const view=render(<CognitiveInput />);act(()=>window.dispatchEvent(new Event('synthetic-capture-open')));
    fireEvent.change(await screen.findByRole('textbox'),{target:{value:'/texto gerar Synthetic prompt'}});
    if(mode==='closed')state.personalEnabled=false;else state.pending=true;
    fireEvent.click(screen.getByRole('button',{name:'Cristalizar pensamento'}));await waitFor(()=>expect(state.error).toHaveBeenCalled());
    expect(state.generateText).not.toHaveBeenCalled();expect(state.learnText).not.toHaveBeenCalled();view.unmount();state.personalEnabled=true;state.teamEnabled=true;state.pending=false;state.error.mockClear();
  }
});
it('manual team enrichment uses only readable live memories from the captured team',async()=>{
  const memories=[{id:'allowed',teamId:'synthetic-team',uid:'alice',text:'Synthetic allowed'},
    {id:'personal',uid:'alice',teamId:null,text:'Synthetic personal'}, {id:'foreign',teamId:'other-team',text:'Synthetic foreign'},
    {id:'locked',teamId:'synthetic-team',encLocked:true}, {id:'deleted',teamId:'synthetic-team',deletedAt:1}];
  const created=vi.fn();render(<CognitiveInput existingMemories={memories as never} onMemoryCreated={created}/>);act(()=>window.dispatchEvent(new Event('synthetic-capture-open')));
  fireEvent.change(await screen.findByRole('textbox'),{target:{value:'Synthetic manual team thought'}});
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'synthetic-team'}});
  fireEvent.click(screen.getByRole('button',{name:'Cristalizar pensamento'}));await waitFor(()=>expect(state.success).toHaveBeenCalledOnce());
  expect(state.semantic).toHaveBeenCalledWith('Synthetic manual team thought',memories,expect.objectContaining({assertCurrent:expect.any(Function),eligible:expect.any(Function)}));
  const options=state.semantic.mock.calls[0][2];expect(memories.filter(options.eligible).map(memory=>memory.id)).toEqual(['allowed']);
  expect(()=>options.assertCurrent()).not.toThrow();state.ready=false;expect(()=>options.assertCurrent()).toThrow();state.ready=true;expect(state.personalCreate).not.toHaveBeenCalled();
  expect(state.teamCreate).toHaveBeenCalledWith(expect.objectContaining({uid:'alice',teamId:'synthetic-team',keyEpoch:1,keyId:'synthetic-key'}),undefined,expect.any(Function),expect.any(Function));expect(created).toHaveBeenCalledWith('synthetic-team-confirmed');
});
it('closed team admission prevents generation provider spending and keeps the typed request',async()=>{
  const input=await composer('/texto gerar Synthetic team prompt');fireEvent.change(screen.getByRole('combobox'),{target:{value:'synthetic-team'}});state.teamEnabled=false;fireEvent.click(screen.getByRole('button',{name:'Cristalizar pensamento'}));await waitFor(()=>expect(state.error).toHaveBeenCalled());expect(state.generateText).not.toHaveBeenCalled();expect(state.learnText).not.toHaveBeenCalled();expect(state.teamCreate).not.toHaveBeenCalled();expect(input).toHaveValue('/texto gerar Synthetic team prompt');
});
it('hands the displayed personal baseline to revision and preserves a draft on failure',async()=>{
  const baseline={sessionId:'synthetic-text-id',stateHash:'a'.repeat(64),stateDigest:'b'.repeat(64),revision:10};
  state.learnText.mockResolvedValue({id:'synthetic-text-id',personalRevisionBaseline:baseline});const input=await composer('/texto gerar Synthetic prompt',false);
  fireEvent.click(screen.getByRole('button',{name:'Cristalizar pensamento'}));await waitFor(()=>expect(state.success).toHaveBeenCalledOnce());
  state.revise.mockRejectedValueOnce(Error('Synthetic conflict'));fireEvent.change(input,{target:{value:'Synthetic edited draft'}});
  fireEvent.click(screen.getByRole('button',{name:'Cristalizar pensamento'}));await waitFor(()=>expect(state.error).toHaveBeenCalled());
  expect(state.revise).toHaveBeenCalledWith('synthetic-text-id','alice','Synthetic edited draft',[],expect.objectContaining({uid:'alice',scope:{kind:'personal'},assertCurrent:expect.any(Function)}),baseline,undefined);expect(input).toHaveValue('Synthetic edited draft');
});
it('a pending personal revision prevents another provider request',async()=>{
  state.revisionPending=true;await composer('/texto gerar Synthetic prompt',false);fireEvent.click(screen.getByRole('button',{name:'Cristalizar pensamento'}));
  await waitFor(()=>expect(state.error).toHaveBeenCalled());expect(state.generateText).not.toHaveBeenCalled();expect(state.learnText).not.toHaveBeenCalled();
});
it('late revision completion after vault change leaves the new draft and suppresses feedback',async()=>{
  const input=await composer('/texto gerar Synthetic prompt',false);fireEvent.click(screen.getByRole('button',{name:'Cristalizar pensamento'}));await waitFor(()=>expect(state.success).toHaveBeenCalledOnce());
  let finish!:()=>void;state.revise.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
  fireEvent.change(input,{target:{value:'Synthetic revised draft'}});fireEvent.click(screen.getByRole('button',{name:'Cristalizar pensamento'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));
  await act(async()=>{state.ready=false;finish();});expect(input).toHaveValue('Synthetic revised draft');expect(state.success).toHaveBeenCalledOnce();expect(state.error).not.toHaveBeenCalled();
});
it('a confirmed creation without an available baseline remains visible and refuses repeat provider or revision work',async()=>{
  state.learnText.mockResolvedValue({id:'synthetic-text-id',personalRevisionUnavailable:true});const input=await composer('/texto gerar Synthetic prompt',false);
  fireEvent.click(screen.getByRole('button',{name:'Cristalizar pensamento'}));await waitFor(()=>expect(state.success).toHaveBeenCalledOnce());
  expect(await screen.findByRole('status')).toHaveTextContent('A memória foi guardada');expect(input).toHaveValue('Synthetic answer');
  expect(screen.getByRole('button',{name:'Cristalizar pensamento'})).toBeDisabled();fireEvent.keyDown(input,{key:'Enter',ctrlKey:true});
  expect(state.generateText).toHaveBeenCalledOnce();expect(state.learnText).toHaveBeenCalledOnce();expect(state.revise).not.toHaveBeenCalled();
});
it.each(['/texto gerar Synthetic prompt','/imagem gerar Synthetic prompt'])('a pending team revision prevents provider spending: %s',async command=>{
  state.teamRevisionPending=true;await composer(command);fireEvent.click(screen.getByRole('button',{name:'Cristalizar pensamento'}));await waitFor(()=>expect(state.error).toHaveBeenCalled());expect(state.generateText).not.toHaveBeenCalled();expect(state.generateImage).not.toHaveBeenCalled();
});
it('a team creation with unavailable baseline retains its visible result and refuses revision',async()=>{
  state.learnText.mockResolvedValue({id:'synthetic-text-id',teamRevisionUnavailable:true});const input=await composer('/texto gerar Synthetic prompt');fireEvent.click(screen.getByRole('button',{name:'Cristalizar pensamento'}));await waitFor(()=>expect(state.success).toHaveBeenCalledOnce());expect(input).toHaveValue('Synthetic answer');expect(screen.getByRole('button',{name:'Cristalizar pensamento'})).toBeDisabled();fireEvent.keyDown(input,{key:'Enter',ctrlKey:true});expect(state.revise).not.toHaveBeenCalled();expect(state.generateText).toHaveBeenCalledOnce();
});
it('a concurrent text edit survives a late revision acknowledgement and invalidates its captured guard',async()=>{
  const baseline={sessionId:'synthetic-text-id',teamId:'synthetic-team',keyEpoch:1,keyId:'synthetic-key'};
  state.learnText.mockResolvedValue({id:'synthetic-text-id',teamRevisionBaseline:baseline});const input=await composer('/texto gerar Synthetic prompt');fireEvent.click(screen.getByRole('button',{name:'Cristalizar pensamento'}));await waitFor(()=>expect(state.success).toHaveBeenCalledOnce());
  let finish!:()=>void;state.revise.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));fireEvent.change(input,{target:{value:'Submitted revision'}});fireEvent.click(screen.getByRole('button',{name:'Cristalizar pensamento'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));
  const context=state.revise.mock.calls[0][4];expect(state.revise.mock.calls[0][6]).toBe(baseline);expect(()=>context.assertCurrent()).not.toThrow();fireEvent.change(input,{target:{value:'New unsaved text'}});expect(()=>context.assertCurrent()).toThrow('draft changed');await act(async()=>finish());expect(input).toHaveValue('New unsaved text');expect(state.success).toHaveBeenCalledOnce();
});
