import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {StoredReviewInbox} from '../services/reviewInboxStore';
const fixture = vi.hoisted(() => ({uid: 'alice', rows: new Map<string, StoredReviewInbox>(), listeners: new Set<(user: {uid: string}) => void>(),
  beforeWrite: (async () => {}) as (uid: string) => Promise<void>, afterWrite: (async () => {}) as (uid: string) => Promise<void>, read: async (_uid: string, row: StoredReviewInbox | undefined) => row}));
vi.mock('../firebase', () => ({default: {}, db: {}, storage: {}, auth: {get currentUser() {return {uid: fixture.uid};}}}));
vi.mock('firebase/auth', () => ({onAuthStateChanged: (_auth: unknown, cb: (user: {uid: string}) => void) => {fixture.listeners.add(cb); return () => fixture.listeners.delete(cb);}}));
vi.mock('../services/reviewInboxStore', () => ({reviewInboxStore: {
  get: async (uid: string) => fixture.read(uid, fixture.rows.has(uid) ? structuredClone(fixture.rows.get(uid)) : undefined),
  compareExchange: async (uid: string, expected: string | null, next: StoredReviewInbox, guard: () => void) => {
    await fixture.beforeWrite(uid); guard(); if ((fixture.rows.has(uid) ? JSON.stringify(fixture.rows.get(uid)) : null) !== expected) throw Error('Synthetic stale version');
    fixture.rows.set(uid, structuredClone(next)); await fixture.afterWrite(uid);
  }, clear: async (uid: string, guard: () => void) => {guard(); fixture.rows.delete(uid);},
}}));
import type { MemoryObject } from '../types/universe';
import { useUniverseStore } from '../store/universeStore';
import {decryptMemoryEnvelope, encryptMemoryFields, setMemoryCryptoMnemonic} from '../services/memoryCrypto';
import {createReviewItem, loadReviewInbox, saveReviewInbox, exportReviewInboxBackup} from '../services/reviewInbox';
import { ReviewInboxPanel } from './ReviewInboxPanel';

const WORDS = [
  'abandon', 'ability', 'able', 'about', 'above', 'absent',
  'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident',
];
const NativeURL = URL;
const nativeDialogMethods = ['showModal', 'close'] as const;
const nativeDialogDescriptors = nativeDialogMethods.map(name => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name));
function backupFile(text: string) {const file = new File([text], 'synthetic-review-backup.json', {type: 'application/json'}); Object.defineProperty(file, 'text', {value: async () => text, configurable: true}); return file;}

function memory(id: string, extra: Partial<MemoryObject> = {}): MemoryObject {
  return {
    id, text: 'Source text', title: 'Source note', celestialType: 'planet',
    position: [0, 0, 0], embedding: [], connections: [], importance: 0.5,
    timestamp: 1, updatedAt: 1, uid: 'alice', ...extra,
  };
}

beforeEach(() => {
  // jsdom does not implement native dialog focus/inert behavior; Chromium covers it separately.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {configurable: true, value(this: HTMLDialogElement) {this.setAttribute('open', '');}});
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {configurable: true, value(this: HTMLDialogElement) {this.removeAttribute('open');}});
  fixture.uid = 'alice'; fixture.rows.clear(); fixture.beforeWrite = async () => {}; fixture.afterWrite = async () => {}; fixture.read = async (_uid, row) => row;
  vi.stubGlobal('navigator', {locks: {request: async (_name: string, _options: unknown, work: (lock: object) => Promise<unknown>) => work({})}});
  vi.stubGlobal('URL', class extends NativeURL {static createObjectURL = vi.fn(() => 'blob:synthetic-review'); static revokeObjectURL = vi.fn();});
});
afterEach(async () => {
  cleanup(); await waitFor(() => expect(fixture.listeners.size).toBe(0));
  nativeDialogMethods.forEach((name, index) => {const descriptor = nativeDialogDescriptors[index]; if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor); else Reflect.deleteProperty(HTMLDialogElement.prototype, name);});
  setMemoryCryptoMnemonic(null);
  localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('ReviewInboxPanel', () => {
  it('retires a save synchronously when native Escape cancellation closes the panel', async () => {
    useUniverseStore.setState({language: 'en'}); setMemoryCryptoMnemonic(WORDS);
    let release!: () => void; fixture.beforeWrite = () => new Promise<void>(resolve => {release = resolve;});
    const onClose = vi.fn();
    render(<ReviewInboxPanel uid="alice" memories={[memory('source-1')]} selectedMemoryId="source-1" onOpenSource={vi.fn()} onClose={onClose}/>);
    await screen.findByText('No review questions yet.');
    fireEvent.change(screen.getByRole('textbox', {name: 'Review question'}), {target: {value: 'Synthetic retired Escape question'}});
    fireEvent.click(screen.getByRole('button', {name: 'Add question'})); await waitFor(() => expect(release).toBeTypeOf('function'));
    const event = new Event('cancel', {bubbles: false, cancelable: true}); fireEvent(screen.getByRole('dialog'), event);
    expect(event.defaultPrevented).toBe(true); expect(onClose).toHaveBeenCalledOnce();
    await act(async () => release()); expect(fixture.rows.size).toBe(0); expect(screen.queryByRole('alert')).toBeNull();
  });
  it('creates a local encrypted question and opens the original source', async () => {
    useUniverseStore.setState({ language: 'en' });
    setMemoryCryptoMnemonic(WORDS);
    const onOpenSource = vi.fn();
    render(<ReviewInboxPanel uid="alice" memories={[memory('source-1')]}
      selectedMemoryId="source-1" onOpenSource={onOpenSource} onClose={vi.fn()} />);
    await screen.findByText('No review questions yet.');
    fireEvent.change(screen.getByRole('textbox', { name: 'Review question' }),
      { target: { value: 'What was the private decision?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add question' }));
    await screen.findByText('What was the private decision?');
    await waitFor(() => expect(fixture.rows.has('alice')).toBe(true));
    expect(JSON.stringify(fixture.rows.get('alice'))).not.toContain('private decision'); expect(localStorage.getItem('mnemosyne:review-inbox:v1:alice')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Open source' }));
    expect(onOpenSource).toHaveBeenCalledWith('source-1');
  });

  it('does not create a question from a team or locked memory', async () => {
    useUniverseStore.setState({ language: 'en' });
    setMemoryCryptoMnemonic(WORDS);
    render(<ReviewInboxPanel uid="alice" memories={[
      memory('team', { teamId: 'crew' }), memory('locked', { encLocked: true }),
    ]} selectedMemoryId="team" onOpenSource={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add question' })).toBeDisabled());
    expect(screen.getByText('Select a personal memory to create a question.')).toBeInTheDocument();
  });

  it('previews legacy questions only on demand and requires explicit account attribution while preserving the exact source', async () => {
    useUniverseStore.setState({language: 'en'}); setMemoryCryptoMnemonic(WORDS);
    const old = createReviewItem('source-1', 'Synthetic legacy question', 1), source = JSON.stringify(await encryptMemoryFields({text: JSON.stringify([old])}));
    localStorage.setItem('mnemosyne:review-inbox:v1:alice', source);
    render(<ReviewInboxPanel uid="alice" memories={[memory('source-1')]} selectedMemoryId="source-1" onOpenSource={vi.fn()} onClose={vi.fn()}/>);
    await screen.findByRole('button', {name: 'Preview previous reviews'}); expect(screen.queryByText('Synthetic legacy question')).toBeNull();
    fireEvent.click(screen.getByRole('button', {name: 'Preview previous reviews'})); await screen.findByText('Synthetic legacy question');
    const importButton = screen.getByRole('button', {name: 'Import reviewed questions'}); expect(importButton).toBeDisabled(); expect(fixture.rows.size).toBe(0);
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(importButton);
    await waitFor(() => expect(fixture.rows.has('alice')).toBe(true));
    const body = JSON.parse((await decryptMemoryEnvelope(fixture.rows.get('alice')!.enc)).text); expect(body.items).toEqual([old]); expect(body.legacyImports[0].sourceRaw).toBe(source);
    expect(localStorage.getItem('mnemosyne:review-inbox:v1:alice')).toBe(source);
  });

  it.each(['account', 'vault'])('a late save after %s ABA cannot clear a newly typed question or publish its old callback', async kind => {
    useUniverseStore.setState({language: 'en'}); setMemoryCryptoMnemonic(WORDS);
    let release!: () => void; fixture.afterWrite = async () => new Promise<void>(resolve => {release = resolve;});
    render(<ReviewInboxPanel uid="alice" memories={[memory('source-1')]} selectedMemoryId="source-1" onOpenSource={vi.fn()} onClose={vi.fn()}/>);
    await screen.findByText('No review questions yet.'); fireEvent.change(screen.getByRole('textbox', {name: 'Review question'}), {target: {value: 'Synthetic old operation'}});
    fireEvent.click(screen.getByRole('button', {name: 'Add question'})); await waitFor(() => expect(fixture.rows.has('alice')).toBe(true));
    act(() => {if (kind === 'account') {fixture.uid = 'bob'; fixture.listeners.forEach(cb => cb({uid: 'bob'})); fixture.uid = 'alice'; fixture.listeners.forEach(cb => cb({uid: 'alice'}));}
      else {setMemoryCryptoMnemonic(null); setMemoryCryptoMnemonic(WORDS);}});
    await screen.findByText('Synthetic old operation'); fireEvent.change(screen.getByRole('textbox', {name: 'Review question'}), {target: {value: 'Synthetic new draft'}});
    await act(async () => release()); expect(screen.getByRole('textbox', {name: 'Review question'})).toHaveValue('Synthetic new draft'); expect(screen.queryByRole('alert')).toBeNull();
    expect((await loadReviewInbox('alice')).items).toHaveLength(1);
  });

  it('a source removed before commit stops question creation and a new account never receives the old draft', async () => {
    useUniverseStore.setState({language: 'en'}); setMemoryCryptoMnemonic(WORDS); let release!: () => void;
    fixture.beforeWrite = async () => new Promise<void>(resolve => {release = resolve;});
    const view = render(<ReviewInboxPanel uid="alice" memories={[memory('source-1')]} selectedMemoryId="source-1" onOpenSource={vi.fn()} onClose={vi.fn()}/>);
    await screen.findByText('No review questions yet.'); fireEvent.change(screen.getByRole('textbox', {name: 'Review question'}), {target: {value: 'Synthetic pending question'}});
    fireEvent.click(screen.getByRole('button', {name: 'Add question'})); await waitFor(() => expect(release).toBeTypeOf('function'));
    view.rerender(<ReviewInboxPanel uid="alice" memories={[]} selectedMemoryId={null} onOpenSource={vi.fn()} onClose={vi.fn()}/>);
    await act(async () => release()); expect(fixture.rows.size).toBe(0); await screen.findByRole('alert');
    act(() => {fixture.uid = 'bob'; fixture.listeners.forEach(cb => cb({uid: 'bob'}));});
    view.rerender(<ReviewInboxPanel uid="bob" memories={[]} selectedMemoryId={null} onOpenSource={vi.fn()} onClose={vi.fn()}/>);
    expect(screen.getByRole('textbox', {name: 'Review question'})).toHaveValue(''); expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps an edit bound to its original captured revision after another tab changes the list', async () => {
    useUniverseStore.setState({language: 'en'}); setMemoryCryptoMnemonic(WORDS);
    const initial = createReviewItem('source-1', 'Synthetic first question', 1); await saveReviewInbox('alice', await loadReviewInbox('alice'), [initial]);
    render(<ReviewInboxPanel uid="alice" memories={[memory('source-1')]} selectedMemoryId="source-1" onOpenSource={vi.fn()} onClose={vi.fn()}/>);
    fireEvent.click(await screen.findByRole('button', {name: 'Synthetic first question'})); fireEvent.change(screen.getByRole('textbox', {name: 'Edit question'}), {target: {value: 'Synthetic stale edit'}});
    await act(async () => {await saveReviewInbox('alice', await loadReviewInbox('alice'), [{...initial, question: 'Synthetic other-tab question'}]);});
    await waitFor(() => expect(screen.getByRole('button', {name: 'Save'})).toBeEnabled()); fireEvent.click(screen.getByRole('button', {name: 'Save'}));
    await screen.findByRole('alert'); expect((await loadReviewInbox('alice')).items[0].question).toBe('Synthetic other-tab question');
  });

  it('an old load cannot display Alice questions after switching the mounted panel to Bob', async () => {
    useUniverseStore.setState({language: 'en'}); setMemoryCryptoMnemonic(WORDS);
    await saveReviewInbox('alice', await loadReviewInbox('alice'), [createReviewItem('source-1', 'Synthetic private Alice load', 1)]);
    let release!: () => void, held = false;
    fixture.read = async (uid, row) => {if (uid === 'alice' && !held) {held = true; await new Promise<void>(resolve => {release = resolve;});} return row;};
    const view = render(<ReviewInboxPanel uid="alice" memories={[memory('source-1')]} selectedMemoryId="source-1" onOpenSource={vi.fn()} onClose={vi.fn()}/>);
    await waitFor(() => expect(held).toBe(true)); act(() => {fixture.uid = 'bob'; fixture.listeners.forEach(cb => cb({uid: 'bob'}));});
    view.rerender(<ReviewInboxPanel uid="bob" memories={[]} selectedMemoryId={null} onOpenSource={vi.fn()} onClose={vi.fn()}/>);
    await screen.findByText('No review questions yet.'); await act(async () => release());
    expect(screen.queryByText('Synthetic private Alice load')).toBeNull(); expect(screen.queryByRole('alert')).toBeNull();
  });

  it('same-turn clicks admit one question and closing the view before admission retires the pending write', async () => {
    useUniverseStore.setState({language: 'en'}); setMemoryCryptoMnemonic(WORDS); let release!: () => void, writes = 0;
    fixture.beforeWrite = async () => {writes++; await new Promise<void>(resolve => {release = resolve;});};
    const onClose = vi.fn(); render(<ReviewInboxPanel uid="alice" memories={[memory('source-1')]} selectedMemoryId="source-1" onOpenSource={vi.fn()} onClose={onClose}/>);
    await screen.findByText('No review questions yet.'); fireEvent.change(screen.getByRole('textbox', {name: 'Review question'}), {target: {value: 'Synthetic pending close'}});
    const button = screen.getByRole('button', {name: 'Add question'}); act(() => {fireEvent.click(button); fireEvent.click(button);});
    await waitFor(() => expect(writes).toBe(1)); fireEvent.click(screen.getByRole('button', {name: 'Close'})); await act(async () => release());
    expect(onClose).toHaveBeenCalledOnce(); expect(fixture.rows.size).toBe(0); expect(screen.queryByRole('alert')).toBeNull();
  });

  it('exports an encrypted file through the guarded action without claiming that a browser download was saved', async () => {
    useUniverseStore.setState({language: 'en'}); setMemoryCryptoMnemonic(WORDS); const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await saveReviewInbox('alice', await loadReviewInbox('alice'), [createReviewItem('source-1', 'Synthetic exported question', 1)]); const before = JSON.stringify(fixture.rows.get('alice'));
    render(<ReviewInboxPanel uid="alice" memories={[memory('source-1')]} selectedMemoryId="source-1" onOpenSource={vi.fn()} onClose={vi.fn()}/>);
    await screen.findByRole('button', {name: 'Synthetic exported question'}); fireEvent.click(screen.getByRole('button', {name: 'Export encrypted backup'}));
    await screen.findByText('Export prepared. Check the downloaded file before relying on this backup.'); expect(click).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).toHaveBeenCalledOnce(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-review'); expect(JSON.stringify(fixture.rows.get('alice'))).toBe(before);
  });

  it('shows a backup copy preview, requires confirmation and then confirms a prior receipt without importing again', async () => {
    useUniverseStore.setState({language: 'en'}); setMemoryCryptoMnemonic(WORDS);
    const old = {...createReviewItem('source-1', 'Synthetic old backup question', 1), id: 'same'}, current = {...old, question: 'Synthetic current question'};
    let snapshot = await saveReviewInbox('alice', await loadReviewInbox('alice'), [old]); const backup = await exportReviewInboxBackup('alice', snapshot);
    snapshot = await saveReviewInbox('alice', snapshot, [current]); expect(snapshot.items).toEqual([current]);
    render(<ReviewInboxPanel uid="alice" memories={[memory('source-1')]} selectedMemoryId="source-1" onOpenSource={vi.fn()} onClose={vi.fn()}/>);
    await screen.findByRole('button', {name: 'Synthetic current question'}); fireEvent.change(screen.getByLabelText('Choose review backup'), {target: {files: [backupFile(backup.text)]}});
    const preview = await screen.findByLabelText('Restore preview'); expect(preview).toHaveTextContent('Create copy'); expect(preview).toHaveTextContent('Synthetic old backup question'); expect(preview).toHaveTextContent('Synthetic current question');
    expect(screen.getByRole('button', {name: 'Restore reviewed questions'})).toBeDisabled(); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', {name: 'Restore reviewed questions'}));
    await screen.findByText('Restore confirmed: 1 questions added.'); expect((await loadReviewInbox('alice')).items).toHaveLength(2); const stored = JSON.stringify(fixture.rows.get('alice'));
    fireEvent.change(screen.getByLabelText('Choose review backup'), {target: {files: [backupFile(backup.text)]}}); await screen.findByRole('button', {name: 'Confirm previous restore'});
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', {name: 'Confirm previous restore'})); await screen.findByText(/Restore receipt from/);
    expect(JSON.stringify(fixture.rows.get('alice'))).toBe(stored);
  });

  it('retires a file read on account ABA without displaying an old preview or clearing a new draft', async () => {
    useUniverseStore.setState({language: 'en'}); setMemoryCryptoMnemonic(WORDS);
    let snapshot = await saveReviewInbox('alice', await loadReviewInbox('alice'), [createReviewItem('source-1', 'Synthetic hidden backup question', 1)]);
    const backup = await exportReviewInboxBackup('alice', snapshot); snapshot = await saveReviewInbox('alice', snapshot, [createReviewItem('source-1', 'Synthetic current list', 1)]); expect(snapshot.items).toHaveLength(1);
    let release!: () => void; const file = backupFile(backup.text); Object.defineProperty(file, 'text', {value: () => new Promise<string>(resolve => {release = () => resolve(backup.text);}), configurable: true});
    render(<ReviewInboxPanel uid="alice" memories={[memory('source-1')]} selectedMemoryId="source-1" onOpenSource={vi.fn()} onClose={vi.fn()}/>);
    await screen.findByRole('button', {name: 'Synthetic current list'}); fireEvent.change(screen.getByLabelText('Choose review backup'), {target: {files: [file]}}); await waitFor(() => expect(release).toBeTypeOf('function'));
    act(() => {fixture.uid = 'bob'; fixture.listeners.forEach(cb => cb({uid: 'bob'})); fixture.uid = 'alice'; fixture.listeners.forEach(cb => cb({uid: 'alice'}));});
    await screen.findByRole('button', {name: 'Synthetic current list'}); fireEvent.change(screen.getByRole('textbox', {name: 'Review question'}), {target: {value: 'Synthetic new file-read draft'}});
    await act(async () => release()); expect(screen.queryByLabelText('Restore preview')).toBeNull(); expect(screen.queryByText(/From backup: Synthetic hidden/)).toBeNull();
    expect(screen.getByRole('textbox', {name: 'Review question'})).toHaveValue('Synthetic new file-read draft'); expect(screen.queryByRole('alert')).toBeNull();
  });
});
