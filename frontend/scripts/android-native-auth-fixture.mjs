const listeners = new Set();
export const auth = {
  currentUser: null,
  onAuthStateChanged(next) {
    const callback = typeof next === 'function' ? next : user => next.next(user);
    listeners.add(callback);
    queueMicrotask(() => { if (listeners.has(callback)) callback(auth.currentUser); });
    return () => listeners.delete(callback);
  },
};
export const db = {};
export const storage = {};
export const functions = {};
export default Object.freeze({ name: 'native-fixture-no-network' });
export function setFixtureUid(uid) {
  auth.currentUser = uid ? { uid } : null;
  for (const callback of listeners) callback(auth.currentUser);
}
