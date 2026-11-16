import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';

/** A fresh key retires old UI work even when A -> B -> A is batched into one render. */
export function useAgentAccountView(uid: string): string | null {
  const [account, setAccount] = useState(() => ({ uid: auth.currentUser?.uid ?? null, epoch: 0 }));
  useEffect(() => {
    let active = true;
    const stop = onAuthStateChanged(auth, user => {
      if (active) setAccount(previous => previous.uid === (user?.uid ?? null) ? previous : { uid: user?.uid ?? null, epoch: previous.epoch + 1 });
    });
    return () => { active = false; stop(); };
  }, []);
  return account.uid === uid && auth.currentUser?.uid === uid ? `${uid}:${account.epoch}` : null;
}
