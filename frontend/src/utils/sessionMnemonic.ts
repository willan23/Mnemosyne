/**
 * Gestão segura da mnemónica de sessão.
 * Nunca grava em localStorage. Só sessionStorage + idle timeout.
 */

import { FAIR_USE } from '../config/fairUse';

const MNEMONIC_SESSION_KEY = 'mnemosyne.session.mnemonic';
const ACTIVITY_KEY = 'mnemosyne.session.activity';

export function readSessionMnemonic(): string[] | null {
  try {
    const raw = sessionStorage.getItem(MNEMONIC_SESSION_KEY);
    if (!raw) return null;
    const words = JSON.parse(raw) as unknown;
    if (!Array.isArray(words) || words.length !== 12 || !words.every((w) => typeof w === 'string')) {
      return null;
    }
    if (isSessionExpired()) {
      clearSessionMnemonic();
      return null;
    }
    return words;
  } catch {
    return null;
  }
}

export function saveSessionMnemonic(words: string[]): void {
  sessionStorage.setItem(MNEMONIC_SESSION_KEY, JSON.stringify(words));
  touchSessionActivity();
}

export function clearSessionMnemonic(): void {
  try {
    sessionStorage.removeItem(MNEMONIC_SESSION_KEY);
    sessionStorage.removeItem(ACTIVITY_KEY);
  } catch {
    // ignore
  }
}

export function touchSessionActivity(): void {
  try {
    sessionStorage.setItem(ACTIVITY_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

export function isSessionExpired(): boolean {
  try {
    const raw = sessionStorage.getItem(ACTIVITY_KEY);
    if (!raw) return false;
    const last = Number(raw);
    if (!Number.isFinite(last)) return true;
    return Date.now() - last > FAIR_USE.mnemonicIdleMs;
  } catch {
    return true;
  }
}

export function msUntilSessionExpiry(): number {
  try {
    const raw = sessionStorage.getItem(ACTIVITY_KEY);
    if (!raw) return FAIR_USE.mnemonicIdleMs;
    const last = Number(raw);
    if (!Number.isFinite(last)) return 0;
    return Math.max(0, FAIR_USE.mnemonicIdleMs - (Date.now() - last));
  } catch {
    return 0;
  }
}

/** Escuta atividade do utilizador e limpa a mnemónica após idle. */
export function startMnemonicIdleGuard(onExpire: () => void): () => void {
  const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
  let warnShown = false;

  const onActivity = () => {
    if (!sessionStorage.getItem(MNEMONIC_SESSION_KEY)) return;
    touchSessionActivity();
    warnShown = false;
  };

  const tick = () => {
    if (!sessionStorage.getItem(MNEMONIC_SESSION_KEY)) return;
    const remaining = msUntilSessionExpiry();
    if (remaining <= 0) {
      clearSessionMnemonic();
      onExpire();
      return;
    }
    if (!warnShown && remaining <= FAIR_USE.mnemonicIdleWarnMs) {
      warnShown = true;
      // Soft signal via custom event for UI toast
      window.dispatchEvent(
        new CustomEvent('mnemosyne:session-idle-warn', {
          detail: { remainingMs: remaining },
        })
      );
    }
  };

  events.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));
  const interval = window.setInterval(tick, 30_000);
  touchSessionActivity();

  return () => {
    events.forEach((ev) => window.removeEventListener(ev, onActivity));
    window.clearInterval(interval);
  };
}

/** Remove chaves legadas inseguras de localStorage. */
export function scrubLegacyKeyMaterial(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const legacy = [
    'mnemosyne_mnemonic',
    'mnemosyne_private_jwk',
    'mnemosyne_public_jwk',
    'mnemosyne.mnemonic',
    'mnemosyne.session.mnemonic',
    'mnemosyne.search.recent.v1',
  ];
  for (const key of legacy) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}
