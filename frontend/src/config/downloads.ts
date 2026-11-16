/**
 * Public download URLs for desktop and mobile installers.
 * Hosted on Firebase Hosting under /downloads and the current updater channel.
 */
import desktopChannel from './desktopReleaseChannel.json';
import { Capacitor } from '@capacitor/core';
import { invoke } from '@tauri-apps/api/core';

const isTauriRuntime = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export function publicDownloadOrigin(location: Pick<Location, 'protocol' | 'origin'> | undefined, native: boolean): string {
  return !native && location && (location.protocol === 'http:' || location.protocol === 'https:')
    ? location.origin : 'https://mnemosyne-one.web.app';
}
const publicAppOrigin = publicDownloadOrigin(typeof window === 'undefined' ? undefined : window.location,
  isTauriRuntime() || Capacitor.isNativePlatform());

/** Candidate desktop version; staging verifies its signed channel before publication. */
export const DESKTOP_APP_VERSION = '1.0.9';
export const DESKTOP_MANUAL_MIGRATION_VERSION = desktopChannel.firstVersion;

export const MOBILE_APP_DOWNLOAD_URL =
  import.meta.env.VITE_MOBILE_APP_DOWNLOAD_URL ||
  `${publicAppOrigin}/downloads/mnemosyne-android.apk`;

/** Stable Windows NSIS installer (recommended for end users). */
export const DESKTOP_SETUP_DOWNLOAD_URL =
  import.meta.env.VITE_DESKTOP_SETUP_DOWNLOAD_URL ||
  `${publicAppOrigin}/downloads/mnemosyne-desktop-setup.exe`;

/** Versioned Windows NSIS installer (matches updater feed). */
export const DESKTOP_SETUP_VERSIONED_URL =
  import.meta.env.VITE_DESKTOP_SETUP_VERSIONED_URL ||
  `${publicAppOrigin}/downloads/Mnemosyne_${DESKTOP_APP_VERSION}_x64-setup.exe`;

/** Windows MSI (enterprise / silent-friendly). */
export const DESKTOP_MSI_DOWNLOAD_URL =
  import.meta.env.VITE_DESKTOP_MSI_DOWNLOAD_URL ||
  `${publicAppOrigin}/downloads/mnemosyne-desktop.msi`;

/** Backward-compatible alias used by Settings and older links. */
export const DESKTOP_APP_DOWNLOAD_URL =
  import.meta.env.VITE_DESKTOP_APP_DOWNLOAD_URL || DESKTOP_SETUP_DOWNLOAD_URL;

export const DESKTOP_UPDATER_FEED_URL = `${publicAppOrigin}${desktopChannel.feedPath}`;

/** Requests an external open; success does not prove a completed download. */
export const openExternalDownload = async (url: string): Promise<boolean> => {
  try {
    const target = new URL(url, publicAppOrigin);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) return false;
    if (isTauriRuntime()) await invoke('open_external_url', { url: target.toString() });
    else window.open(target.toString(), '_blank', 'noopener,noreferrer');
    return true;
  } catch {
    return false;
  }
};
