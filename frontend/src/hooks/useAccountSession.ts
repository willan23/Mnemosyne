import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../firebase';
import { initializeAccount } from '../services/accountBootstrap';

/** Auth is exposed to the workspace only after its server-owned profile is ready. */
export function useAccountSession(onIdentityChange: () => void) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const identity = useRef<string | null>(null);
  const changed = useRef(onIdentityChange);
  useEffect(() => { changed.current = onIdentityChange; });
  useEffect(() => {
    let active = true, version = 0;
    const stop = onAuthStateChanged(auth, next => {
      if (!active) return;
      const captured = ++version;
      if (identity.current !== (next?.uid ?? null)) { identity.current = next?.uid ?? null; changed.current(); }
      setUser(null); setReady(false); setFailed(false);
      if (!next) { setReady(true); return; }
      const current = () => active && version === captured && auth.currentUser?.uid === next.uid;
      void initializeAccount(next.uid).then(() => {
        if (current()) { setUser(next); setReady(true); }
      }).catch(() => { if (current()) setFailed(true); });
    }, () => {
      if (!active) return;
      ++version; identity.current = null; changed.current(); setUser(null); setReady(false); setFailed(true);
    });
    return () => { active = false; ++version; stop(); };
  }, [attempt]);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  return { user, ready, failed, retry };
}
