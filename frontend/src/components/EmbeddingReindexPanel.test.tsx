import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ prepare: vi.fn(), discard: vi.fn(), ready: true,
  promote: vi.fn(), rollback: vi.fn(),
  changed: null as (() => void) | null }));
vi.mock('../services/embeddingReindex', () => ({ prepareEmbeddingReindex: state.prepare, discardEmbeddingReindex: state.discard }));
vi.mock('../services/embeddingPromotion', () => ({ promotePreparedEmbeddings: state.promote, rollbackEmbeddingSelection: state.rollback }));
vi.mock('../services/memoryCrypto', () => ({ isMemoryCryptoReady: () => state.ready,
  onMemoryCryptoChanged: (callback: () => void) => { state.changed = callback; return () => { state.changed = null; }; } }));
vi.mock('../utils/translations', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { EmbeddingReindexPanel } from './EmbeddingReindexPanel';
import { writeEmbeddingSelection } from '../services/embeddingSelection';
beforeEach(() => { localStorage.clear(); state.ready = true; state.prepare.mockReset().mockResolvedValue({}); state.discard.mockReset().mockResolvedValue(undefined); state.promote.mockReset().mockResolvedValue({}); state.rollback.mockReset(); });

it('exposes explicit activation and rollback controls', async () => {
  render(<EmbeddingReindexPanel uid="alice" sessions={[]} />);
  fireEvent.click(screen.getByText('reindexActivate'));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('reindexStatus_activated'));
  expect(state.promote).toHaveBeenCalledWith('alice', 'multilingualCandidate', expect.any(Function), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  act(() => writeEmbeddingSelection('alice', 'multilingualCandidate'));
  expect(screen.getByText('reindexSelected')).toBeInTheDocument();
  fireEvent.click(screen.getByText('reindexRollback'));
  expect(state.rollback).toHaveBeenCalledWith('alice');
});

it('offers explicit preparation and discard without activating an index', async () => {
  render(<EmbeddingReindexPanel uid="alice" sessions={[]} />);
  expect(state.prepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('reindexStart'));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('reindexStatus_prepared'));
  expect(state.prepare).toHaveBeenCalledWith('alice', 'multilingualCandidate', expect.any(Function), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  fireEvent.click(screen.getByText('reindexDiscard'));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('reindexStatus_discarded'));
  expect(state.discard).toHaveBeenCalledWith('alice', 'multilingualCandidate');
});

it('cancels preparation on lock and on unmount', async () => {
  state.prepare.mockImplementation((_uid, _profile, _read, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('cancelled')));
  }));
  const view = render(<EmbeddingReindexPanel uid="alice" sessions={[]} />);
  fireEvent.click(screen.getByText('reindexStart'));
  const first = state.prepare.mock.calls[0][3].signal as AbortSignal;
  await act(async () => { state.ready = false; state.changed?.(); });
  expect(first.aborted).toBe(true);
  expect(screen.getByText('reindexStart')).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('reindexStatus_cancelled');
  act(() => { state.ready = true; state.changed?.(); });
  fireEvent.click(screen.getByText('reindexStart'));
  const second = state.prepare.mock.calls[1][3].signal as AbortSignal;
  view.unmount();
  expect(second.aborted).toBe(true);
});
