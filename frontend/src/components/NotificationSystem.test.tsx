import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ auth: { currentUser: { uid: 'alice' } as { uid: string } | null }, changed: undefined as undefined | ((user: { uid: string } | null) => void),
  watch: vi.fn(), mark: vi.fn<(notice: unknown, guard: () => boolean) => Promise<void>>().mockResolvedValue(undefined), stopAuth: vi.fn() }));
vi.mock('../firebase', () => ({ auth: fixture.auth }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn((_auth, changed) => { fixture.changed = changed; return fixture.stopAuth; }) }));
vi.mock('../services/capsuleNoticeService', () => ({ watchCapsuleImportNotices: fixture.watch, markCapsuleNoticeRead: fixture.mark }));
import { NotificationSystem } from './NotificationSystem';
import { useNotificationStore } from '../store/notificationStore';
const notice = (id = 'notice') => ({ id, ownerUid: 'alice', titleHint: 'SYNTHETIC_PRIVATE_NOTICE_773', itemCount: 2 });
beforeEach(() => { vi.clearAllMocks(); fixture.auth.currentUser = { uid: 'alice' }; useNotificationStore.getState().clearAll(); fixture.watch.mockReturnValue(vi.fn()); });
afterEach(cleanup);
function change(uid: string | null) { fixture.auth.currentUser = uid ? { uid } : null; fixture.changed?.(fixture.auth.currentUser); }
it('passes the captured source and operation guard to acknowledgement after queueing the toast', () => {
  render(<NotificationSystem />); act(() => change('alice')); const callback = fixture.watch.mock.calls[0][1]; const value = notice(); act(() => callback(value));
  expect(screen.getByText(/SYNTHETIC_PRIVATE_NOTICE_773/)).toBeTruthy(); expect(fixture.mark).toHaveBeenCalledWith(value, expect.any(Function));
  expect(fixture.mark.mock.calls[0][1]()).toBe(true);
});
it('account changes clear old toasts and retire old callbacks even after the same UID returns', () => {
  render(<NotificationSystem />); act(() => change('alice')); const previous = fixture.watch.mock.calls[0][1]; act(() => previous(notice()));
  const guard = fixture.mark.mock.calls[0][1]; act(() => change('bob')); expect(screen.queryByText(/SYNTHETIC_PRIVATE_NOTICE_773/)).toBeNull(); expect(guard()).toBe(false);
  act(() => change('alice')); act(() => previous(notice('late'))); expect(fixture.mark).toHaveBeenCalledTimes(1); expect(useNotificationStore.getState().notifications).toHaveLength(0);
});
it('foreign and unmounted callbacks cannot queue data or acknowledge notices', () => {
  const view = render(<NotificationSystem />); act(() => change('alice')); const callback = fixture.watch.mock.calls[0][1];
  act(() => callback({ ...notice(), ownerUid: 'bob' })); expect(fixture.mark).not.toHaveBeenCalled(); view.unmount(); act(() => callback(notice()));
  expect(fixture.mark).not.toHaveBeenCalled(); expect(useNotificationStore.getState().notifications).toHaveLength(0); expect(fixture.stopAuth).toHaveBeenCalled();
});
it('remounting in another account hides an already queued capsule toast before the first Auth callback', () => {
  useNotificationStore.getState().addNotification({ ownerUid: 'alice', type: 'received', title: 'SYNTHETIC_PRIVATE_NOTICE_773', isPulsing: true });
  fixture.auth.currentUser = { uid: 'bob' }; render(<NotificationSystem />);
  expect(screen.queryByText('SYNTHETIC_PRIVATE_NOTICE_773')).toBeNull(); expect(fixture.mark).not.toHaveBeenCalled();
});
