/**
 * Aviso automático de atualização:
 * - Web / Capacitor: compara /version.json com a versão embutida no bundle
 * - Desktop Tauri: usa plugin updater nativo (DesktopUpdatePrompt)
 */
import { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { RefreshCw } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import {
  APP_BUILD_ID,
  APP_VERSION,
  isNewerRelease,
  localReleaseMeta,
  type RemoteAppVersion,
} from '../config/appVersion';
import { DesktopUpdatePrompt } from './DesktopUpdatePrompt';
import { MOBILE_APP_DOWNLOAD_URL, openExternalDownload } from '../config/downloads';

const CHECK_INTERVAL_MS = 3 * 60 * 1000; // 3 min
const STORAGE_DISMISS_KEY = 'mnemosyne.update.dismissedBuildId';
const VERSION_FEED_URL = 'https://mnemosyne-one.web.app/version.json';

const isTauriRuntime = () =>
  typeof window !== 'undefined' &&
  '__TAURI_INTERNALS__' in (window as Window & { __TAURI_INTERNALS__?: unknown });

async function fetchRemoteVersion(): Promise<RemoteAppVersion | null> {
  try {
    const url = `${VERSION_FEED_URL}?t=${Date.now()}`;
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Partial<RemoteAppVersion>;
    if (!data || (typeof data.version !== 'string' && typeof data.buildId !== 'string')) {
      return null;
    }
    return {
      version: data.version || '0.0.0',
      buildId: data.buildId || '',
      builtAt: data.builtAt,
      channel: data.channel,
      notes: data.notes,
    };
  } catch {
    return null;
  }
}

function wasDismissed(buildId: string): boolean {
  try {
    return sessionStorage.getItem(STORAGE_DISMISS_KEY) === buildId;
  } catch {
    return false;
  }
}

function dismissBuild(buildId: string): void {
  try {
    sessionStorage.setItem(STORAGE_DISMISS_KEY, buildId);
  } catch {
    // ignore
  }
}

async function applyWebUpdate(buildId?: string): Promise<void> {
  if (buildId) {
    dismissBuild(buildId);
  }

  if (Capacitor.isNativePlatform()) {
    openExternalDownload(MOBILE_APP_DOWNLOAD_URL);
    return;
  }

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.unregister();
      }
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      for (const key of keys) {
        await caches.delete(key);
      }
    }
  } catch (err) {
    console.error('Failed to purge caches during update:', err);
  }

  const url = new URL(window.location.href);
  url.searchParams.set('_mnem_upd', String(Date.now()));
  window.location.replace(url.toString());
}

function showWebUpdateToast(remote: RemoteAppVersion): void {
  const toastId = `web-update-${remote.buildId || remote.version}`;

  toast.custom(
    (t) => (
      <div className="w-[min(92vw,380px)] rounded-2xl border border-cyan-400/25 bg-[#07101f]/96 p-4 text-sm text-white shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-cyan-400/30 bg-cyan-500/15 p-2">
            <RefreshCw className="h-4 w-4 text-cyan-200" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-white">Nova versão disponível</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              Mnemosyne <span className="font-mono text-cyan-100">{remote.version}</span>
              {remote.buildId ? (
                <span className="text-slate-500"> · build {remote.buildId.slice(0, 8)}</span>
              ) : null}
              {' '}está pronta. Atualiza para receber melhorias e correções.
            </p>
            {remote.notes ? (
              <p className="mt-1.5 line-clamp-2 text-[11px] text-slate-500">{remote.notes}</p>
            ) : null}
            <p className="mt-1 text-[10px] text-slate-600">
              A tua sessão: v{APP_VERSION}
              {APP_BUILD_ID !== 'dev' ? ` · ${APP_BUILD_ID.slice(0, 8)}` : ''}
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/70 transition hover:bg-white/10 hover:text-white"
                onClick={() => {
                  dismissBuild(remote.buildId || remote.version);
                  toast.dismiss(t.id);
                }}
              >
                Depois
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/30 bg-cyan-500/20 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-500/30"
                onClick={() => {
                  toast.dismiss(t.id);
                  void applyWebUpdate(remote.buildId || remote.version);
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {Capacitor.isNativePlatform() ? 'Abrir descarga' : 'Atualizar agora'}
              </button>
            </div>
          </div>
        </div>
      </div>
    ),
    { duration: Infinity, id: toastId },
  );
}

function useWebUpdateChecker() {
  const promptedRef = useRef<string | null>(null);

  useEffect(() => {
    if (isTauriRuntime()) return;
    if (import.meta.env.DEV) return;

    let cancelled = false;

    const check = async () => {
      if (cancelled || document.visibilityState === 'hidden') return;
      const remote = await fetchRemoteVersion();
      if (!remote || cancelled) return;

      const local = localReleaseMeta();
      if (!isNewerRelease(local, remote)) return;

      const key = remote.buildId || remote.version;
      if (promptedRef.current === key || wasDismissed(key)) return;
      promptedRef.current = key;
      showWebUpdateToast(remote);
    };

    void check();
    const intervalId = window.setInterval(() => void check(), CHECK_INTERVAL_MS);

    const onFocus = () => void check();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}

/** Web + desktop: monta os dois caminhos. */
export function AppUpdatePrompt() {
  useWebUpdateChecker();
  return <DesktopUpdatePrompt />;
}

export default AppUpdatePrompt;
