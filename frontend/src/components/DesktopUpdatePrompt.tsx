import { useEffect } from 'react'
import toast from 'react-hot-toast'
import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater'

const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000
const promptedVersions = new Set<string>()

const isTauriRuntime = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as Window & { __TAURI_INTERNALS__?: unknown })

const formatProgress = (downloadedBytes: number, totalBytes?: number) => {
  if (!totalBytes) {
    const downloadedMb = Math.max(1, Math.round(downloadedBytes / 1024 / 1024))
    return `${downloadedMb} MB`
  }

  return `${Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))}%`
}

const installUpdate = async (update: Update, toastId: string) => {
  try {
    const { relaunch } = await import('@tauri-apps/plugin-process')
    let downloadedBytes = 0
    let totalBytes: number | undefined

    toast.loading('Baixando atualização...', { id: toastId })

    await update.downloadAndInstall((event: DownloadEvent) => {
      if (event.event === 'Started') {
        totalBytes = event.data.contentLength
        downloadedBytes = 0
      }

      if (event.event === 'Progress') {
        downloadedBytes += event.data.chunkLength
        toast.loading(`Baixando atualização ${formatProgress(downloadedBytes, totalBytes)}`, { id: toastId })
      }

      if (event.event === 'Finished') {
        toast.loading('Instalando atualização...', { id: toastId })
      }
    })

    toast.success('Atualização instalada. Reiniciando...', { id: toastId })
    await relaunch()
  } catch (error) {
    console.error('Desktop update failed', error)
    promptedVersions.delete(update.version)
    toast.error('Não foi possível instalar a atualização agora.', { id: toastId })
  }
}

const showUpdateToast = (update: Update) => {
  if (promptedVersions.has(update.version)) {
    return
  }

  promptedVersions.add(update.version)

  toast.custom(
    (toastInstance) => (
      <div className="w-[min(92vw,360px)] rounded-lg border border-white/10 bg-[#111827]/95 p-4 text-sm text-white shadow-2xl backdrop-blur">
        <div className="font-semibold">Nova versão disponível</div>
        <div className="mt-1 text-white/75">
          Mnemosyne {update.version} está pronto para instalar no desktop.
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-white/10 px-3 py-2 text-white/75 transition hover:bg-white/10 hover:text-white"
            onClick={() => toast.dismiss(toastInstance.id)}
          >
            Depois
          </button>
          <button
            type="button"
            className="rounded-md bg-cyan-500 px-3 py-2 font-medium text-slate-950 transition hover:bg-cyan-400"
            onClick={() => void installUpdate(update, toastInstance.id)}
          >
            Atualizar agora
          </button>
        </div>
      </div>
    ),
    { duration: Infinity, id: `desktop-update-${update.version}` },
  )
}

export function DesktopUpdatePrompt() {
  useDesktopUpdater()
  return null
}

function useDesktopUpdater() {
  useEffect(() => {
    if (!isTauriRuntime()) {
      return
    }

    void checkForDesktopUpdate()
    const intervalId = window.setInterval(() => void checkForDesktopUpdate(), CHECK_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [])
}

let checkInFlight = false

async function checkForDesktopUpdate() {
  if (checkInFlight) {
    return
  }

  checkInFlight = true

  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check({ timeout: 15000 })

    if (update) {
      showUpdateToast(update)
    }
  } catch (error) {
    console.info('Desktop update check unavailable', error)
  } finally {
    checkInFlight = false
  }
}
