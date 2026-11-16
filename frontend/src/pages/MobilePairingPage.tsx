import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { Camera, CheckCircle2, DownloadCloud, KeyRound, Lock, Smartphone, UploadCloud, XCircle } from 'lucide-react';
import { auth } from '../firebase';
import { LoginPage } from './LoginPage';
import { acceptMobilePairingInvite,hasPendingMobilePairing,cancelRetainedMobilePairing } from '../services/mobilePairing';
import { importQueuedMobileSyncEnvelopes, queueMobileMemoryDelta } from '../services/mobileSync';
import { useSessions } from '../hooks/useSessions';
import { useSyncFeedback } from '../hooks/useSyncFeedback';
import { SyncRecoveryActions } from '../components/SyncRecoveryActions';
import { syncOutboxMessage } from '../services/mobileSyncMessages';
import {
  isNativeSecureStorage,
  inspectMobileSyncCredential,
  protectLegacyMobileSyncCredential,
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
  const [legacyDigest,setLegacyDigest]=useState<string|null>(null),[hasPairingRecovery,setHasPairingRecovery]=useState(false);
  const operation=useRef<object|null>(null);
  const syncFeedback = useSyncFeedback();
  const captureFeedback=syncFeedback.capture;
  useEffect(() => {operation.current=null;setBusy(false);setStatus(null);setError(null);},[syncFeedback.epoch]);

  const payloadFromUrl = useMemo(() => new URLSearchParams(window.location.search).get('payload') || '', []);
  const inviteUri = manualInvite.trim() || (payloadFromUrl ? makePairingUri(payloadFromUrl) : '');
  const { allSessions } = useSessions(user, '', { dateRange: 'all', tags: [] });

  useEffect(() => onAuthStateChanged(auth, value=>{setCredential(null);setLegacyDigest(null);setUser(value);}), []);

  useEffect(() => {
    let current = true;
    setCredential(null);
    setLegacyDigest(null);setHasPairingRecovery(user?hasPendingMobilePairing(user.uid,'mobile'):false);
    if (!user) {
      return;
    }

    const feedback=captureFeedback(user.uid),guard=()=>{if(!current||!feedback())throw Error('Vista retirada.');};if(!feedback())return;
    inspectMobileSyncCredential(user.uid,guard)
      .then(value => {if(current&&feedback()){setCredential(value?.credential??null);setLegacyDigest(value?.legacy?value.sourceDigest:null);}})
      .catch(() => {if(current&&feedback())setCredential(null);});
    return () => {current=false;};
  }, [user,syncFeedback.epoch,captureFeedback]);

  const handleAcceptInvite = async (resume=false) => {
    if (!user || !resume&&!inviteUri||operation.current) return;
    const current=syncFeedback.capture(user.uid);if(!current()){setError('Desbloqueia o cofre antes de emparelhar.');return;}const guard=()=>{if(!current())throw Error('Vista retirada.');},token={};operation.current=token;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const accepted = await acceptMobilePairingInvite(resume?'':inviteUri, deviceName || 'Mobile',guard);guard();
      setCredential(accepted);setLegacyDigest(null);
      setStatus('Resposta confirmada e chave guardada com cifra do cofre. A confiança tem de estar confirmada no desktop antes da sincronização.');
    } catch {
      if(current())setError('O emparelhamento ainda não foi confirmado. A chave e o pedido cifrados foram conservados; retoma ou cancela o pedido.');
    } finally {
      if(operation.current===token){operation.current=null;if(current()){setBusy(false);setHasPairingRecovery(hasPendingMobilePairing(user.uid,'mobile'));}}
    }
  };

  const handleScanQr = async () => {
    if(!user||operation.current)return;const current=syncFeedback.captureAccount(user.uid),token={};if(!current())return;operation.current=token;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const scannedValue = await scanMobilePairingQr();
      if(!current())return;
      setManualInvite(scannedValue);
      setStatus('QR lido. Confirma o pareamento para guardar a chave de sync neste dispositivo.');
    } catch {
      if(current())setError('Não foi possível ler o QR.');
    } finally {
      if(operation.current===token){operation.current=null;if(current())setBusy(false);}
    }
  };
  const handlePairingMaintenance=async(mode:'cancel'|'protect')=>{
    if(!user||operation.current)return;const current=syncFeedback.capture(user.uid);if(!current()){setError('Desbloqueia o cofre antes de continuar.');return;}
    const guard=()=>{if(!current())throw Error('Vista retirada.');},token={};operation.current=token;setBusy(true);setError(null);setStatus(null);
    try{if(mode==='cancel'){await cancelRetainedMobilePairing(user.uid,'mobile',guard);guard();setStatus('Cancelamento confirmado. As chaves e o pedido anterior foram conservados.');}
      else{if(!legacyDigest)return;await protectLegacyMobileSyncCredential(user.uid,legacyDigest,guard);guard();setLegacyDigest(null);setStatus('Credencial protegida pelo cofre. O original anterior foi conservado num arquivo cifrado.');}}
    catch{if(current())setError(mode==='cancel'?'O cancelamento ainda não foi confirmado. Se o desktop já confiou neste dispositivo, retoma a credencial ou revoga-o na lista de dispositivos. As chaves foram conservadas.':'Não foi possível confirmar a operação. A credencial, a chave e os pedidos anteriores foram conservados.');}
    finally{if(operation.current===token){operation.current=null;if(current())setBusy(false);}}
  };

  const handleImportSync = async () => {
    if (!user || !credential || credential.ownerUid !== user.uid) return;
    const feedbackCurrent = syncFeedback.capture(user.uid);
    if (!feedbackCurrent()) {setError('Desbloqueia o cofre antes de importar memórias.');return;}
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await importQueuedMobileSyncEnvelopes(
        user.uid,
        credential.deviceId,
        credential.privateKeyJwk
      );
      if (!feedbackCurrent()) return;
      setStatus(`${result.importedMemories} memórias importadas de ${result.pulledEnvelopes} envelope(s). ${result.conflicts} conflito(s).`);
    } catch (syncError) {
      if (feedbackCurrent()) setError(syncError instanceof Error ? syncError.message : 'Não foi possível importar envelopes cifrados.');
    } finally {
      if (feedbackCurrent()) setBusy(false);
    }
  };

  const handleSendMobileDelta = async () => {
    if (!user || !credential || credential.ownerUid !== user.uid) return;
    const feedbackCurrent=syncFeedback.capture(user.uid);
    if(!feedbackCurrent()){setError('Desbloqueia o cofre antes de enviar memórias.');return;}
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result=await queueMobileMemoryDelta(user.uid,credential,allSessions);
      if(!feedbackCurrent())return;setStatus(syncOutboxMessage(result));
    } catch (syncError) {
      if(feedbackCurrent())setError(syncError instanceof Error ? syncError.message : 'Não foi possível enviar delta cifrado.');
    } finally {
      if(feedbackCurrent())setBusy(false);
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
            onClick={()=>void handleAcceptInvite()}
            disabled={busy || !inviteUri}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-xs font-bold uppercase tracking-widest text-cyan-100 transition hover:bg-cyan-400/20 disabled:opacity-40"
          >
            <Lock className="h-4 w-4" />
            Aceitar convite
          </button>
          {hasPairingRecovery&&<div className="space-y-2"><button type="button" disabled={busy} onClick={()=>void handleAcceptInvite(true)} className="min-h-11 w-full rounded-xl border border-white/20 px-4 py-3">Retomar último pedido cifrado</button><button type="button" disabled={busy} onClick={()=>void handlePairingMaintenance('cancel')} className="min-h-11 w-full rounded-xl border border-white/20 px-4 py-3">Cancelar pedido conservado</button></div>}
        </section>

        <section className="mt-4 space-y-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-slate-200">Envelopes cifrados</h2>
              <p className="mt-1 text-xs text-slate-400">
                {credential ? `Credencial ${credential.deviceId.slice(0, 8)} guardada. O servidor verifica confiança e revogação em cada sincronização.` : 'Desbloqueia o cofre para abrir a credencial guardada.'}
              </p>
            </div>
            <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${
              isNativeSecureStorage() ? 'bg-green-400/10 text-green-200' : 'bg-amber-400/10 text-amber-200'
            }`}>
              {isNativeSecureStorage() ? 'nativo' : 'web dev'}
            </span>
          </div>
          {legacyDigest&&credential&&<div className="rounded-xl border border-amber-400/30 p-3 text-sm"><p>A credencial antiga declara esta conta: {credential.deviceName} ({credential.deviceId}). Confirma a conta para a proteger com a cifra do cofre. O original será conservado num arquivo cifrado.</p><button type="button" disabled={busy} onClick={()=>void handlePairingMaintenance('protect')} className="mt-2 min-h-11 rounded-lg border border-white/20 px-3">Confirmar conta e proteger credencial antiga</button></div>}

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

        {credential?.ownerUid === user.uid && (
          <SyncRecoveryActions uid={user.uid} deviceId={credential.deviceId} outgoing="mobile-to-desktop" />
        )}

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
