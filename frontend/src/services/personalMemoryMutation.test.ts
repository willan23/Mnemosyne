import { expect, it, vi } from 'vitest';
vi.mock('../firebase', () => ({ auth: {} }));
import { PersonalMemoryMutationError, withPersonalMemoryMutation, type PersonalMemoryMutationContext } from './personalMemoryMutation';
function setup() {
  const state = { uid: 'alice' as string | null, ready: true, listener: () => undefined as void };
  const stop = vi.fn();
  return { state, stop, deps: { uid: () => state.uid, ready: () => state.ready,
    subscribe: (listener: () => void) => { state.listener = listener; return stop; } } };
}
it('guards the complete lifecycle, returns the acknowledgement and disposes even on failure', async () => {
  const { deps, stop } = setup(); let captured!: PersonalMemoryMutationContext;
  await expect(withPersonalMemoryMutation('alice', async context => { captured = context; context.assertCurrent(); return 7; }, deps)).resolves.toBe(7);
  expect(stop).toHaveBeenCalledTimes(1); expect(() => captured.assertCurrent()).toThrow(PersonalMemoryMutationError);
  await expect(withPersonalMemoryMutation('alice', async () => { throw new Error('synthetic'); }, deps)).rejects.toThrow('synthetic');
  expect(stop).toHaveBeenCalledTimes(2);
});
it('refuses missing/different accounts and locked vaults before starting preparation', async () => {
  for (const mode of ['missing', 'other', 'locked', 'invalid'] as const) {
    const { state, deps } = setup(); const work = vi.fn();
    if (mode === 'missing') state.uid = null; if (mode === 'other') state.uid = 'bob'; if (mode === 'locked') state.ready = false;
    await expect(withPersonalMemoryMutation(mode === 'invalid' ? 'a/b' : 'alice', work, deps)).rejects.toThrow(PersonalMemoryMutationError);
    expect(work).not.toHaveBeenCalled();
  }
});
it('latches observed changes even if the account or vault is restored before continuation', async () => {
  for (const mode of ['account', 'vault', 'late'] as const) {
    const { state, deps, stop } = setup();
    await expect(withPersonalMemoryMutation('alice', async context => {
      if (mode === 'account') { state.uid = 'bob'; state.listener(); state.uid = 'alice'; }
      else { state.ready = false; state.listener(); state.ready = true; }
      if (mode !== 'late') context.assertCurrent();
    }, deps)).rejects.toThrow(PersonalMemoryMutationError); expect(stop).toHaveBeenCalledTimes(1);
  }
});
