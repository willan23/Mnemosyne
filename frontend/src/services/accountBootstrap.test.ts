import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ auth: { currentUser: { uid: 'alice' } as { uid: string } | null }, call: vi.fn(), callable: vi.fn(), functions: vi.fn() }));
vi.mock('../firebase', () => ({ default: {}, auth: state.auth }));
vi.mock('firebase/functions', () => ({ getFunctions: (...args: unknown[]) => state.functions(...args), httpsCallable: (...args: unknown[]) => { state.callable(...args); return state.call; } }));
import { initializeAccount } from './accountBootstrap';
beforeEach(() => { vi.clearAllMocks(); state.auth.currentUser = { uid: 'alice' }; state.call.mockResolvedValue({ data: { ready: true } }); });
it('sends no identity, paid plan, quota or profile data to the server', async () => {
  await initializeAccount('alice'); expect(state.call).toHaveBeenCalledExactlyOnceWith({});
  expect(state.callable).toHaveBeenCalledWith(undefined, 'initializeAccount'); expect(state.functions).toHaveBeenCalledWith({}, 'europe-west1');
});
it('rejects another account before dispatch', async () => {
  await expect(initializeAccount('bob')).rejects.toThrow(); expect(state.call).not.toHaveBeenCalled();
});
it('ignores a response for an account that is no longer active', async () => {
  state.call.mockImplementation(async () => { state.auth.currentUser = { uid: 'bob' }; return { data: { ready: true } }; });
  await expect(initializeAccount('alice')).rejects.toThrow();
});
it.each([null, {}, { ready: false }, { ready: true, tier: 'sovereign' }])('fails closed for an unexpected readiness response', async data => {
  state.call.mockResolvedValue({ data }); await expect(initializeAccount('alice')).rejects.toThrow();
});
