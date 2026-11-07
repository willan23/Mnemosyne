import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { hasPendingClipCapture, observeClipCaptures, persistClippedMemory } from '../services/clipCaptureService';
import {
  PENDING_CLIP_KEY,
  readPendingClip,
  clearPendingClip,
  ingestClipFromLocation,
  clipIngressFailed,
  writePendingClip,
} from '../utils/clipCapture';
import { auth } from '../firebase';
import { CLIP_CAPTURE_ENABLED } from '../config/releaseGates';

interface UseClipCaptureOptions {
  isAuthenticated: boolean;
  mnemonicReady: boolean;
  uid: string | undefined;
  subscriptionReady: boolean;
  canCreateMemory: boolean;
  onMemoryCreated?: (memoryId: string) => void;
}

/**
 * Ingere um clip do fragmento / sessionStorage, pede unlock se preciso,
 * cifra e grava com a tag `clipped`.
 */
export function useClipCapture({
  isAuthenticated,
  mnemonicReady,
  uid,
  subscriptionReady,
  canCreateMemory,
  onMemoryCreated,
}: UseClipCaptureOptions): void {
  const location = useLocation();
  const navigate = useNavigate();
  const persistingRef = useRef(false);
  const queuedToastRef = useRef(false);
  const heldToastRef = useRef<string | null>(null);
  const [checkpointRevision, setCheckpointRevision] = useState(0);
  useEffect(() => observeClipCaptures(() => { if (!persistingRef.current) setCheckpointRevision(value => value + 1); }), []);

  useEffect(() => {
    ingestClipFromLocation();
    if (clipIngressFailed()) toast.error('Não foi possível receber o clip. Verifica a fila e o armazenamento local antes de tentar novamente.');
    const next = window.location;
    if (`${location.pathname}${location.search}${location.hash || ''}` !== `${next.pathname}${next.search}${next.hash}`) {
      navigate({ pathname: next.pathname, search: next.search, hash: next.hash }, { replace: true });
    }
  }, [location.pathname, location.search, location.hash, navigate]);

  useEffect(() => {
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(PENDING_CLIP_KEY);
    } catch {
      pending = null;
    }
    if (!pending || queuedToastRef.current) return;
    if (isAuthenticated && mnemonicReady) return;
    queuedToastRef.current = true;
    toast('Clip na fila — inicia sessão e desbloqueia o vault para cifrar e guardar.', {
      icon: '📎',
      duration: 5000,
    });
  }, [isAuthenticated, mnemonicReady]);

  useEffect(() => {
    if (!isAuthenticated || !mnemonicReady || !uid || !subscriptionReady) return;
    if (persistingRef.current) return;

    const clip = readPendingClip(uid);
    if (!clip) return;
    if (!writePendingClip(clip, uid)) {
      toast.error('Não foi possível preparar a captura nesta sessão. O clip não foi enviado.');
      return;
    }
    if (hasPendingClipCapture(uid)) return;
    if (!CLIP_CAPTURE_ENABLED) {
      if (heldToastRef.current !== uid) toast.error('A captura de clips está temporariamente indisponível. O clip fica na fila.');
      heldToastRef.current = uid;
      return;
    }

    if (!canCreateMemory) {
      toast.error('Limite de memórias atingido. O clip fica na fila.');
      return;
    }

    persistingRef.current = true;
    let active = true;
    const current = () => active && auth.currentUser?.uid === uid;
    const toastId = 'clip-persist';
    toast.loading('A cifrar o clip…', { id: toastId });

    void persistClippedMemory(uid, clip, () => {
      if (JSON.stringify(readPendingClip(uid)) === JSON.stringify(clip)) clearPendingClip();
    })
      .then((memoryId) => {
        if (!current()) return;
        toast.success('Clip guardado no teu universo.', { id: toastId, icon: '✨' });
        onMemoryCreated?.(memoryId);
      })
      .catch(() => {
        if (!current()) return;
        toast.error('Não foi possível confirmar a captura. A operação cifrada ou o clip de entrada foram conservados para recuperação.', { id: toastId });
      })
      .finally(() => {
        persistingRef.current = false;
        // A failed preparation with no checkpoint waits for an explicit new input/unlock; never loop on a transport failure.
      });
    return () => { active = false; toast.dismiss(toastId); };
  }, [isAuthenticated, mnemonicReady, uid, subscriptionReady, canCreateMemory, onMemoryCreated, checkpointRevision]);
}
