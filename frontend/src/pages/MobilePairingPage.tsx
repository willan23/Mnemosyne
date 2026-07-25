import React, { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { Camera, CheckCircle2, DownloadCloud, KeyRound, Lock, Smartphone, UploadCloud, XCircle } from 'lucide-react';
import { auth } from '../firebase';
import { LoginPage } from './LoginPage';
import { acceptMobilePairingInvite } from '../services/mobilePairing';
import { importQueuedMobileSyncEnvelopes, queueMobileMemoryDelta } from '../services/mobileSync';
import { useSessions } from '../hooks/useSessions';
import {
  isNativeSecureStorage,
  loadMobileSyncCredential,
  saveMobileSyncCredential,
  type MobileSyncCredential,
} from '../services/mobileDeviceKeyStore';
import { scanMobilePairingQr } from '../services/mobileQrScanner';

const makePairingUri = (payload: string): string => `mnemosyne://pair?payload=${payload}`;

export const MobilePairingPage: React.FC = () => {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [manualInvite, setManualInvite] = useState('');
  const [credential, setCredential] = useState<MobileSyncCredential | null>(null);
  const [deviceName, setDeviceName] = useState(() => navigator.userAgent.slice(0, 80));
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const payloadFromUrl = useMemo(() => new URLSearchParams(window.location.search).get('payload') || '', []);
  const inviteUri = manualInvite.trim() || (payloadFromUrl ? makePairingUri(payloadFromUrl) : '');
  const { allSessions } = useSessions(user, '', { dateRange: 'all', tags: [] });

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user) {
      setCredential(null);
      return;
    }

    loadMobileSyncCredential(user.uid)
      .then(setCredential)
      .catch((storageError) => {
        console.warn('Unable to load mobile sync credential:', storageError);
        setCredential(null);
      });
  }, [user]);

  const handleAcceptInvite = async () => {
    if (!user || !inviteUri) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const accepted = await acceptMobilePairingInvite(inviteUri, deviceName || 'Mobile');
      const nextCredential: MobileSyncCredential = {
        ownerUid: user.uid,
        deviceId: accepted.deviceId,
        pairingId: accepted.pairingId,
        deviceName: deviceName || 'Mobile',
        privateKeyJwk: accepted.mobilePrivateKeyJwk,
        savedAt: Date.now(),
      };
      await saveMobileSyncCredential(nextCredential);
      setCredential(nextCredential);
      setStatus('Dispositivo pareado. A chave privada de sync ficou guardada neste dispositivo.');
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : 'Não foi possível aceitar o convite.');
    } finally {
      setBusy(false);
    }
  };

  const handleScanQr = async () => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const scannedValue = await scanMobilePairingQr();
      setManualInvite(scannedValue);
      setStatus('QR lido. Confirma o pareamento para guardar a chave de sync neste dispositivo.');
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Não foi possível ler o QR.');
    } finally {
      setBusy(false);
    }
  };

  const handleImportSync = async () => {
    if (!user || !credential) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await importQueuedMobileSyncEnvelopes(
        user.uid,
        credential.deviceId,
        credential.privateKeyJwk
      );
      setStatus(`${result.importedMemories} memórias importadas de ${result.pulledEnvelopes} envelope(s). ${result.conflicts} conflito(s).`);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Não foi possível importar envelopes cifrados.');
    } finally {
      setBusy(false);
    }
  };

  const mobileToDesktopCursorKey = (deviceId: string): string => `mnemosyne_sync_cursor_mobile_to_desktop_${deviceId}`;

  const handleSendMobileDelta = async () => {
    if (!user || !credential) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const since = Number(localStorage.getItem(mobileToDesktopCursorKey(credential.deviceId)) || '0');
      const nextCursor = allSessions.reduce(
        (max, session) => Math.max(max, session.updatedAt || session.timestamp || 0),
        since
      );
      const envelopeId = await queueMobileMemoryDelta(user.uid, credential, allSessions, since);
      localStorage.setItem(mobileToDesktopCursorKey(credential.deviceId), String(nextCursor));
      setStatus(`Delta cifrado enviado para o desktop. Envelope ${envelopeId.slice(0, 8)}.`);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Não foi possível enviar delta cifrado.');
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return <LoginPage onMnemonicComplete={() => undefined} />;
  }

  return (
    <div className="min-h-screen bg-[#030712] text-slate-100">
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-5 py-8">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10">
            <Smartphone className="h-5 w-5 text-cyan-200" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-wide">Mobile Sync</h1>
            <p className="text-xs text-slate-400">Pareamento e importação cifrada</p>
          </div>
        </div>

        <section className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-center gap-3">
            <KeyRound className="h-4 w-4 text-purple-200" />
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-200">Parear dispositivo</h2>
          </div>

          <label className="block space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Nome deste dispositivo</span>
            <input
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-cyan-400/50"
            />
          </label>

          {!payloadFromUrl && (
            <div className="space-y-3">
              <button
                onClick={handleScanQr}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-xs font-bold uppercase tracking-widest text-cyan-100 transition hover:bg-cyan-400/20 disabled:opacity-40"
              >
                <Camera className="h-4 w-4" />
                Ler QR com câmara
              </button>

              <label className="block space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Convite mnemosyne://pair</span>
                <textarea
                  value={manualInvite}
                  onChange={(event) => setManualInvite(event.target.value)}
                  rows={4}
                  className="w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs outline-none focus:border-cyan-400/50"
                  placeholder="Colar convite copiado do desktop"
                />
              </label>
            </div>
          )}

          <button
            onClick={handleAcceptInvite}
            disabled={busy || !inviteUri}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-xs font-bold uppercase tracking-widest text-cyan-100 transition hover:bg-cyan-400/20 disabled:opacity-40"
          >
            <Lock className="h-4 w-4" />
            Aceitar convite
          </button>
        </section>

        <section className="mt-4 space-y-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-slate-200">Envelopes cifrados</h2>
              <p className="mt-1 text-xs text-slate-400">
                {credential ? `Dispositivo ${credential.deviceId.slice(0, 8)} ativo.` : 'Sem chave de sync guardada.'}
              </p>
            </div>
            <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${
              isNativeSecureStorage() ? 'bg-green-400/10 text-green-200' : 'bg-amber-400/10 text-amber-200'
            }`}>
              {isNativeSecureStorage() ? 'nativo' : 'web dev'}
            </span>
          </div>

          <button
            onClick={handleImportSync}
            disabled={busy || !credential}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-purple-400/20 bg-purple-400/10 px-4 py-3 text-xs font-bold uppercase tracking-widest text-purple-100 transition hover:bg-purple-400/20 disabled:opacity-40"
          >
            <DownloadCloud className="h-4 w-4" />
            Receber sync
          </button>

          <button
            onClick={handleSendMobileDelta}
            disabled={busy || !credential}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-xs font-bold uppercase tracking-widest text-cyan-100 transition hover:bg-cyan-400/20 disabled:opacity-40"
          >
            <UploadCloud className="h-4 w-4" />
            Enviar delta
          </button>
        </section>

        {status && (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-green-400/20 bg-green-400/10 p-4 text-sm text-green-100">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{status}</p>
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-100">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{error}</p>
          </div>
        )}
      </main>
    </div>
  );
};
