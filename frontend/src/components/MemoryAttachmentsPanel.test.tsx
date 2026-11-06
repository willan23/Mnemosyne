import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryAttachmentsPanel } from './MemoryAttachmentsPanel';
import type { MemoryObject } from '../types/universe';
const state = vi.hoisted(() => ({ uid: 'alice' as string | null, ready: true, writes: true, pending: false, listeners: new Set<() => void>(),
  associate: vi.fn(), recover: vi.fn(), cancel: vi.fn(), success: vi.fn(), error: vi.fn(), uploadList: vi.fn(), uploadResume: vi.fn(), uploadCancel: vi.fn(), downloadDraft: vi.fn() }));
vi.mock('../services/attachmentDraftRecovery', () => ({ downloadRecoveredAttachmentDraft: (...args: unknown[]) => state.downloadDraft(...args) }));
vi.mock('../firebase', () => ({ auth: { get currentUser() { return state.uid ? { uid: state.uid } : null; } } }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: (user: { uid: string } | null) => void) => { callback(state.uid ? { uid: state.uid } : null); return () => undefined; } }));
vi.mock('../config/releaseGates', () => ({ get ATTACHMENT_WRITES_ENABLED() { return state.writes; }, TEAM_WRITES_ENABLED: true }));
vi.mock('../services/memoryCrypto', () => ({ isMemoryCryptoReady: () => state.ready, onMemoryCryptoChanged: (callback: () => void) => { state.listeners.add(callback); return () => state.listeners.delete(callback); } }));
vi.mock('../services/teamVault', () => ({ onTeamKeyChanged: () => () => undefined }));
vi.mock('../services/attachmentUploadClient', () => ({ listRecoverableAttachmentUploads: (...args: unknown[]) => state.uploadList(...args),
  resumeEncryptedAttachmentUpload: (...args: unknown[]) => state.uploadResume(...args), cancelRecoverableAttachmentUpload: (...args: unknown[]) => state.uploadCancel(...args) }));
vi.mock('../services/attachmentUploadCheckpoint', () => ({ observeAttachmentUploadCheckpoints: (callback: () => void) => {
  window.addEventListener('synthetic-upload-checkpoint', callback); return () => window.removeEventListener('synthetic-upload-checkpoint', callback);
} }));
vi.mock('../services/attachmentMutationRecovery', () => ({ associateSessionAttachments: (...args: unknown[]) => state.associate(...args),
  recoverSessionAttachmentMutation: (...args: unknown[]) => state.recover(...args), cancelPendingSessionAttachmentMutation: (...args: unknown[]) => state.cancel(...args),
  hasPendingAttachmentMutation: () => state.pending, observeAttachmentMutations: (callback: () => void) => {
    window.addEventListener('synthetic-checkpoint', callback); return () => window.removeEventListener('synthetic-checkpoint', callback);
  } }));
vi.mock('./AttachmentUploader', () => ({ AttachmentUploader: ({ onChange }: { onChange: (value: unknown[]) => void }) => <button onClick={() => onChange([{ type: 'document', name: 'Anexo cifrado', url: 'mnemosyne-attachment:v1:11111111-1111-4111-8111-111111111111' }])}>Enviar anexo sintético</button> }));
vi.mock('react-hot-toast', () => ({ default: { success: (...args: unknown[]) => state.success(...args), error: (...args: unknown[]) => state.error(...args) } }));
const memory: MemoryObject = { id: 'note', uid: 'alice', text: 'Synthetic memory', timestamp: 1, updatedAt: 1,
  celestialType: 'planet', position: [0, 0, 0], embedding: [], connections: [], importance: 0.5 };
function deferred() { let resolve!: (value: unknown) => void; let reject!: (error: Error) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => { state.uid = 'alice'; state.ready = true; state.writes = true; state.pending = false; state.listeners.clear();
  [state.associate, state.recover, state.cancel, state.success, state.error, state.uploadList, state.uploadResume, state.uploadCancel, state.downloadDraft].forEach(mock => mock.mockReset());
  state.uploadList.mockResolvedValue({ items: [], nextAfterId: null }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('offers a local file download before cancellation without automatically cancelling or associating it', async () => {
  const id = '11111111-1111-4111-8111-111111111111'; state.writes = false;
  state.uploadList.mockResolvedValue({ items: [{ id, name: 'Synthetic original.md', phase: 'posting' }], nextAfterId: null });
  state.downloadDraft.mockResolvedValue(undefined); render(<MemoryAttachmentsPanel memory={memory} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Guardar ficheiro local' }));
  await waitFor(() => expect(state.success).toHaveBeenCalledWith('Download local iniciado. Verifica o ficheiro antes de cancelar ou repetir o envio.'));
  expect(state.downloadDraft).toHaveBeenCalledWith('alice', id); expect(state.uploadCancel).not.toHaveBeenCalled(); expect(state.associate).not.toHaveBeenCalled();
  expect(screen.getByText(/Synthetic original/)).toBeInTheDocument();
  vi.spyOn(window, 'confirm').mockReturnValue(false); fireEvent.click(screen.getByRole('button', { name: 'Cancelar este envio' })); expect(state.uploadCancel).not.toHaveBeenCalled();
});
it('shows sent files as unassociated; a lost acknowledgement retains recovery controls without success', async () => {
  const remote = deferred(); state.associate.mockReturnValue(remote.promise); render(<MemoryAttachmentsPanel memory={memory} />);
  fireEvent.click(screen.getByRole('button', { name: 'Enviar anexo sintético' })); expect(screen.getByRole('status').textContent).toContain('ainda por associar');
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar anexos nesta memória' })); expect(state.success).not.toHaveBeenCalled();
  await act(async () => { state.pending = true; window.dispatchEvent(new Event('synthetic-checkpoint')); remote.reject(Error('synthetic')); });
  expect(screen.getByRole('button', { name: 'Recuperar associação' })).toBeEnabled(); expect(screen.queryByRole('button', { name: 'Enviar anexo sintético' })).toBeNull();
  state.recover.mockImplementation(async () => { state.pending = false; return { status: 'committed' }; });
  fireEvent.click(screen.getByRole('button', { name: 'Recuperar associação' })); await waitFor(() => expect(state.success).toHaveBeenCalledWith('Anexos confirmados na memória.'));
});
it('does not display an old confirmation or clear a new view after switching memories', async () => {
  const remote = deferred(); state.associate.mockReturnValue(remote.promise); const view = render(<MemoryAttachmentsPanel memory={memory} />);
  fireEvent.click(screen.getByRole('button', { name: 'Enviar anexo sintético' })); fireEvent.click(screen.getByRole('button', { name: 'Confirmar anexos nesta memória' }));
  view.rerender(<MemoryAttachmentsPanel memory={{ ...memory, id: 'other-note' }} />);
  await act(async () => remote.resolve({ status: 'committed' })); expect(state.success).not.toHaveBeenCalled(); expect(screen.queryByText(/ainda por associar/)).toBeNull();
});
it('recovery remains visible when release gates close, and a locked vault disables it', async () => {
  state.writes = false; state.pending = true; render(<MemoryAttachmentsPanel memory={memory} />);
  expect(screen.getByRole('button', { name: 'Recuperar associação' })).toBeEnabled();
  await act(async () => { state.ready = false; state.listeners.forEach(callback => callback()); });
  expect(screen.getByRole('button', { name: 'Recuperar associação' })).toBeDisabled();
  await act(async () => { state.ready = true; state.listeners.forEach(callback => callback()); });
  vi.spyOn(window, 'confirm').mockReturnValue(true); state.cancel.mockImplementation(async () => { state.pending = false; return { status: 'committed' }; });
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar associação pendente' }));
  await waitFor(() => expect(state.success).toHaveBeenCalledWith('Anexos confirmados na memória.')); expect(state.success).not.toHaveBeenCalledWith('Associação cancelada.');
});
it('removal requires confirmation and does not optimistically erase the attachment or announce a late locked acknowledgement', async () => {
  const id = '11111111-1111-4111-8111-111111111111'; const remote = deferred(); state.associate.mockReturnValue(remote.promise);
  vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
  render(<MemoryAttachmentsPanel memory={{ ...memory, attachments: [{ type: 'document', name: 'Anexo cifrado', url: `mnemosyne-attachment:v1:${id}` }] }} />);
  const remove = screen.getByRole('button', { name: 'Retirar anexo 1 desta memória' }); fireEvent.click(remove); expect(state.associate).not.toHaveBeenCalled();
  fireEvent.click(remove); expect(state.associate).toHaveBeenCalledWith({ uid: 'alice', sessionId: 'note', action: 'remove', ids: [id] });
  expect(remove).toBeInTheDocument(); await act(async () => { state.ready = false; state.listeners.forEach(callback => callback()); remote.resolve({ status: 'committed' }); });
  expect(state.success).not.toHaveBeenCalled();
});
it('restored uploads remain unassociated until selection and a separate memory confirmation', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  state.uploadList.mockResolvedValue({ items: [{ id, name: 'Synthetic local draft.md', phase: 'ready' }], nextAfterId: null });
  state.uploadResume.mockResolvedValue({ status: 'ready', attachment: { type: 'document', name: 'Anexo cifrado', url: `mnemosyne-attachment:v1:${id}` } });
  render(<MemoryAttachmentsPanel memory={memory} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Recuperar este envio' }));
  await screen.findByRole('button', { name: 'Confirmar anexos nesta memória' });
  expect(state.associate).not.toHaveBeenCalled(); expect(state.success).toHaveBeenCalledWith('Envio confirmado. A associação a esta memória ainda precisa de confirmação.');
  state.associate.mockResolvedValue({ status: 'committed' }); fireEvent.click(screen.getByRole('button', { name: 'Confirmar anexos nesta memória' }));
  await waitFor(() => expect(state.associate).toHaveBeenCalledWith({ uid: 'alice', sessionId: 'note', action: 'add', ids: [id] }));
});
it('clears decrypted upload names on lock and ignores a recovery response from an old view', async () => {
  state.uploadList.mockResolvedValue({ items: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Synthetic local filename.md', phase: 'posting' }], nextAfterId: null });
  const remote = deferred(); state.uploadResume.mockReturnValue(remote.promise); const view = render(<MemoryAttachmentsPanel memory={memory} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Recuperar este envio' }));
  await act(async () => { state.ready = false; state.listeners.forEach(callback => callback()); }); expect(screen.queryByText(/Synthetic local filename/)).toBeNull();
  view.rerender(<MemoryAttachmentsPanel memory={{ ...memory, id: 'other-note' }} />);
  await act(async () => remote.resolve({ status: 'ready', attachment: { type: 'document', name: 'Anexo cifrado', url: 'synthetic' } }));
  expect(state.success).not.toHaveBeenCalled();
});
