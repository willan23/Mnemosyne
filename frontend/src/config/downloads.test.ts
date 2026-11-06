import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), native: vi.fn(() => false) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: mocks.native } }));
beforeEach(() => { vi.resetModules(); mocks.invoke.mockReset(); mocks.native.mockReturnValue(false); });
afterEach(() => { Reflect.deleteProperty(window, '__TAURI_INTERNALS__'); vi.restoreAllMocks(); });

it('uses hosted downloads for native WebViews and preserves the origin of an ordinary browser or preview', async () => {
  const { publicDownloadOrigin } = await import('./downloads');
  expect(publicDownloadOrigin({ protocol: 'http:', origin: 'http://tauri.localhost' }, true)).toBe('https://mnemosyne-one.web.app');
  expect(publicDownloadOrigin({ protocol: 'http:', origin: 'http://localhost' }, true)).toBe('https://mnemosyne-one.web.app');
  expect(publicDownloadOrigin({ protocol: 'https:', origin: 'https://preview.example.invalid' }, false)).toBe('https://preview.example.invalid');
  expect(publicDownloadOrigin({ protocol: 'http:', origin: 'http://localhost:4173' }, false)).toBe('http://localhost:4173');
  expect(publicDownloadOrigin(undefined, false)).toBe('https://mnemosyne-one.web.app');
});
it('dispatches a Tauri download through the existing native command with the hosted URL', async () => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
  mocks.invoke.mockResolvedValue(undefined); const open = vi.spyOn(window, 'open').mockReturnValue(null);
  const { openExternalDownload, DESKTOP_SETUP_DOWNLOAD_URL } = await import('./downloads');
  expect(DESKTOP_SETUP_DOWNLOAD_URL).toBe('https://mnemosyne-one.web.app/downloads/mnemosyne-desktop-setup.exe');
  expect(await openExternalDownload(DESKTOP_SETUP_DOWNLOAD_URL)).toBe(true);
  expect(mocks.invoke).toHaveBeenCalledWith('open_external_url', { url: DESKTOP_SETUP_DOWNLOAD_URL });
  expect(open).not.toHaveBeenCalled();
});
it('uses the hosted origin for Capacitor without claiming an Android intent was tested', async () => {
  mocks.native.mockReturnValue(true); const { DESKTOP_SETUP_DOWNLOAD_URL, MOBILE_APP_DOWNLOAD_URL } = await import('./downloads');
  expect(new URL(DESKTOP_SETUP_DOWNLOAD_URL).origin).toBe('https://mnemosyne-one.web.app');
  expect(new URL(MOBILE_APP_DOWNLOAD_URL).origin).toBe('https://mnemosyne-one.web.app');
});
it('keeps an ordinary web open explicit and isolated from the opener', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null); const { openExternalDownload } = await import('./downloads');
  expect(await openExternalDownload('https://example.invalid/installer.exe')).toBe(true);
  expect(open).toHaveBeenCalledWith('https://example.invalid/installer.exe', '_blank', 'noopener,noreferrer');
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it('refuses executable schemes and URL credentials before invoking a browser or native command', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null), { openExternalDownload } = await import('./downloads');
  for (const url of ['javascript:void(0)', 'file:///synthetic.exe', 'https://fixture@example.invalid/installer.exe']) expect(await openExternalDownload(url)).toBe(false);
  expect(open).not.toHaveBeenCalled(); expect(mocks.invoke).not.toHaveBeenCalled();
});
it('contains native opening failures without falling back or logging the native error', async () => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
  mocks.invoke.mockRejectedValue(new Error('SYNTHETIC_PRIVATE_ERROR')); const open = vi.spyOn(window, 'open').mockReturnValue(null), error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { openExternalDownload } = await import('./downloads'); expect(await openExternalDownload('https://example.invalid/installer.exe')).toBe(false);
  expect(open).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
});
