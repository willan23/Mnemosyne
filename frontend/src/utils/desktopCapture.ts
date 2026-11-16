import { isTauriRuntime } from './tauriFolderImporter';

/** Atalho global do desktop (Tauri). Configurável mais tarde via re-register JS. */
export const CAPTURE_HOTKEY = 'CommandOrControl+Shift+M';
export const CAPTURE_TAURI_EVENT = 'mnemosyne-capture';
export const OPEN_CAPTURE_EVENT = 'mnemosyne:open-capture';
export const CAPTURE_ACTIVE_EVENT = 'mnemosyne:capture-active';
export const CAPTURE_IDLE_EVENT = 'mnemosyne:capture-idle';

export function formatCaptureHotkeyLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl+Shift+M';
  const platform = navigator.platform || '';
  const ua = navigator.userAgent || '';
  const isMac = /Mac|iPhone|iPad|iPod/.test(platform) || /Mac OS X/.test(ua);
  return isMac ? '⌘⇧M' : 'Ctrl+Shift+M';
}

export function dispatchOpenCapture(): void {
  window.dispatchEvent(new CustomEvent(OPEN_CAPTURE_EVENT));
}

export function notifyCaptureActive(active: boolean): void {
  window.dispatchEvent(new CustomEvent(active ? CAPTURE_ACTIVE_EVENT : CAPTURE_IDLE_EVENT));
}

export function isCaptureHotkeyEvent(event: KeyboardEvent): boolean {
  if (event.repeat) return false;
  if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return false;
  return event.key === 'M' || event.key === 'm';
}

/** Ouve o evento emitido pelo plugin global-shortcut no Rust. */
export async function listenDesktopCaptureHotkey(onCapture: () => void): Promise<() => void> {
  if (!isTauriRuntime()) return () => undefined;
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen(CAPTURE_TAURI_EVENT, () => {
      onCapture();
    });
  } catch {
    return () => undefined;
  }
}
