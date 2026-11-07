import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AttachmentPreviewGrid } from './AttachmentPreviewGrid';
import type { Attachment } from '../types/attachments';
const state = vi.hoisted(() => ({ uid: 'alice' as string | null, ready: true, cryptoListeners: new Set<() => void>(), resolve: vi.fn(), fresh: vi.fn(), download: vi.fn(), success: vi.fn(), error: vi.fn(), listeners: new Set<(user: { uid: string } | null) => void>() }));
vi.mock('../firebase', () => ({ auth: { get currentUser() { return state.uid ? { uid: state.uid } : null; } } }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: (user: { uid: string } | null) => void) => {
  state.listeners.add(callback); callback(state.uid ? { uid: state.uid } : null); return () => state.listeners.delete(callback);
} }));
vi.mock('../services/attachmentAccess', () => ({ resolveAttachments: (...args: unknown[]) => state.resolve(...args), resolveAttachmentDownload: (...args: unknown[]) => state.fresh(...args) }));
vi.mock('../utils/storage', () => ({ formatFileSize: () => 'synthetic-size' }));
vi.mock('../services/memoryCrypto', () => ({ isMemoryCryptoReady: () => state.ready, onMemoryCryptoChanged: (callback: () => void) => {
  state.cryptoListeners.add(callback); return () => state.cryptoListeners.delete(callback);
} }));
vi.mock('../utils/export', () => ({ downloadAttachmentFile: (...args: unknown[]) => state.download(...args) }));
vi.mock('react-hot-toast', () => ({ default: { success: (...args: unknown[]) => state.success(...args), error: (...args: unknown[]) => state.error(...args) } }));
const items: Attachment[] = [{ type: 'image', name: 'synthetic.png', url: 'https://unsafe.example/?token=synthetic' }];
const resolved = () => [{ ...items[0], url: 'https://storage.googleapis.com/synthetic/safe', readSourceUrl: items[0].url, readExpiresAt: Date.now() + 120_000 }];
beforeEach(() => { state.uid = 'alice'; state.ready = true; state.cryptoListeners.clear(); state.listeners.clear(); [state.resolve, state.fresh, state.download, state.success, state.error].forEach(mock => mock.mockReset());
  state.resolve.mockResolvedValue(resolved()); state.fresh.mockResolvedValue({ url: 'https://storage.googleapis.com/synthetic/fresh' }); state.download.mockResolvedValue(undefined); });
afterEach(() => { vi.useRealTimers(); });
it('never renders original token references before authorization and clears them on session change', async () => {
  let finish!: (value: unknown) => void; state.resolve.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = render(<AttachmentPreviewGrid attachments={items} sessionId="first" />);
  expect(screen.queryByRole('img')).toBeNull(); expect(document.querySelector('[src*="unsafe.example"]')).toBeNull();
  await act(async () => finish(resolved())); expect(screen.getByRole('img').getAttribute('src')).toContain('/safe');
  state.resolve.mockReturnValueOnce(new Promise(() => undefined));
  view.rerender(<AttachmentPreviewGrid attachments={items} sessionId="second" />); expect(screen.queryByRole('img')).toBeNull();
});
it('does not publish authorization after logout and releases listeners on unmount', async () => {
  let finish!: (value: unknown) => void; state.resolve.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = render(<AttachmentPreviewGrid attachments={items} sessionId="note" />);
  await act(async () => { state.uid = null; state.listeners.forEach(listener => listener(null)); });
  await act(async () => finish(resolved())); expect(screen.queryByRole('img')).toBeNull();
  view.unmount(); expect(state.listeners.size).toBe(0);
});
it('downloads only after a fresh authorization, and denial has fixed feedback', async () => {
  const docs: Attachment[] = [{ ...items[0], type: 'document' }];
  state.resolve.mockResolvedValue([{ ...resolved()[0], type: 'document' }]);
  render(<AttachmentPreviewGrid attachments={docs} sessionId="note" />);
  const button = await screen.findByRole('button', { name: 'Descarregar' }); fireEvent.click(button);
  await waitFor(() => expect(state.download).toHaveBeenCalledWith('https://storage.googleapis.com/synthetic/fresh', 'synthetic.png', { guard: expect.any(Function) }));
  expect(state.fresh).toHaveBeenCalledWith(items[0].url, { sessionId: 'note' });
  state.fresh.mockRejectedValueOnce(Error('synthetic-sensitive-failure')); fireEvent.click(button);
  await waitFor(() => expect(state.error).toHaveBeenCalledWith('Não foi possível descarregar.')); expect(state.download).toHaveBeenCalledTimes(1);
});
it('re-authorizes before the displayed read URL expires', async () => {
  vi.useFakeTimers(); render(<AttachmentPreviewGrid attachments={items} sessionId="note" />);
  await act(async () => { await Promise.resolve(); }); expect(state.resolve).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(110_000); }); expect(state.resolve).toHaveBeenCalledTimes(2);
});
it('clears authorized media and the lightbox when the vault locks and reloads only after unlock', async () => {
  const view = render(<AttachmentPreviewGrid attachments={items} sessionId="note" />);
  await screen.findByRole('img'); fireEvent.click(screen.getByRole('button', { name: 'synthetic.png' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument(); const before = state.resolve.mock.calls.length;
  await act(async () => { state.ready = false; state.cryptoListeners.forEach(listener => listener()); });
  expect(screen.queryByRole('img')).toBeNull(); expect(screen.queryByRole('dialog')).toBeNull(); expect(state.resolve).toHaveBeenCalledTimes(before);
  await act(async () => { state.ready = true; state.cryptoListeners.forEach(listener => listener()); });
  await screen.findByRole('img'); expect(state.resolve).toHaveBeenCalledTimes(before + 1);
  view.unmount(); expect(state.cryptoListeners.size).toBe(0);
});
it('releases obsolete decrypted previews and fresh download resources, including unmount during authorization', async () => {
  const disposePreview = vi.fn(); const disposeDownload = vi.fn(); const disposeLate = vi.fn();
  state.resolve.mockResolvedValueOnce([{ ...resolved()[0], type: 'document', release: disposePreview }]);
  state.fresh.mockResolvedValueOnce({ url: 'blob:http://localhost/synthetic', release: disposeDownload });
  const view = render(<AttachmentPreviewGrid attachments={items} sessionId="note" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Descarregar' }));
  await waitFor(() => expect(disposeDownload).toHaveBeenCalledOnce());
  let finish!: (value: unknown) => void; state.resolve.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  view.rerender(<AttachmentPreviewGrid attachments={items} sessionId="other" />); expect(disposePreview).toHaveBeenCalledOnce();
  view.unmount(); await act(async () => finish([{ ...resolved()[0], release: disposeLate }])); expect(disposeLate).toHaveBeenCalledOnce();
});
