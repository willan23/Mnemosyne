import {onAuthStateChanged, reload, sendEmailVerification, type User} from 'firebase/auth';
import {auth} from '../firebase';

export class AccountEmailContextChanged extends Error {constructor(){super('Account email context changed');}}
export interface AccountEmailVerificationDeps {
  uid: () => string | null;
  observe: (changed: (uid: string | null) => void) => () => void;
  send: (user: User) => Promise<void>;
  reload: (user: User) => Promise<void>;
  refreshToken: (user: User) => Promise<unknown>;
}
const defaults = (): AccountEmailVerificationDeps => ({uid: () => auth.currentUser?.uid ?? null,
  observe: changed => onAuthStateChanged(auth, user => changed(user?.uid ?? null)), send: sendEmailVerification, reload,
  refreshToken: user => user.getIdToken(true)});
async function withAccount<T>(user: User, outer: () => void, work: (guard: () => void) => Promise<T>, deps: AccountEmailVerificationDeps) {
  const uid = user.uid, email = user.email; let retired = false, ended = false;
  const stop = deps.observe(current => {if (current !== uid) retired = true;});
  const guard = () => {outer(); if (retired || ended || !uid || !email || deps.uid() !== uid || user.uid !== uid || user.email !== email) throw new AccountEmailContextChanged();};
  try {guard(); const result = await work(guard); guard(); return result;} finally {ended = true; stop();}
}
export async function sendAccountEmailVerification(user: User, outer: () => void = () => {}, deps = defaults()) {
  return withAccount(user, outer, async guard => {guard(); if (user.emailVerified) return; await deps.send(user); guard();}, deps);
}
export async function refreshAccountEmailVerification(user: User, outer: () => void = () => {}, deps = defaults()) {
  return withAccount(user, outer, async guard => {await deps.reload(user); guard(); await deps.refreshToken(user); guard(); return user.emailVerified === true;}, deps);
}
