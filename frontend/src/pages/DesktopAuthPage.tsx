import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Brain, CheckCircle2, Loader2 } from 'lucide-react';
import app, { auth } from '../firebase';
import { AuthPage } from '../components/landing/AuthPage';
import { LandingBackground } from '../components/landing/LandingBackground';
import { MnemonicBackupModal } from '../components/MnemonicBackupModal';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Web bridge for Mnemosyne Desktop login.
 * Opened in the system browser from the Tauri app; seals a short-lived custom token.
 */
export default function DesktopAuthPage() {
  const [params] = useSearchParams();
  const bridgeId = useMemo(() => (params.get('bridge') || '').trim().toLowerCase(), [params]);
  const bridgeValid = UUID_RE.test(bridgeId);

  const [phase, setPhase] = useState<'auth' | 'sealing' | 'done' | 'error'>(
    bridgeValid ? 'auth' : 'error',
  );
  const [error, setError] = useState<string | null>(
    bridgeValid ? null : 'Link de login desktop inválido ou incompleto.',
  );
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [backupMnemonic, setBackupMnemonic] = useState<string[] | null>(null);

  useEffect(() => {
    if (!bridgeValid) return;

    let cancelled = false;
    let sealing = false;

    const seal = async (email: string | null) => {
      if (sealing || cancelled) return;
      sealing = true;
      setPhase('sealing');
      setSignedInEmail(email);
      try {
        const functions = getFunctions(app, 'europe-west1');
        const sealBridge = httpsCallable(functions, 'sealDesktopAuthBridge');
        await sealBridge({ bridgeId });
        if (!cancelled) setPhase('done');
      } catch (err) {
        if (!cancelled) {
          setPhase('error');
          setError(err instanceof Error ? err.message : 'Não foi possível confirmar o login desktop.');
        }
      }
    };

    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        void seal(user.email);
      } else if (!cancelled) {
        setPhase('auth');
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [bridgeId, bridgeValid]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#03030d] text-white">
      <div className="fixed inset-0 z-0 pointer-events-none">
        <LandingBackground />
      </div>

      {phase === 'auth' && bridgeValid ? (
        <AuthPage
          initialMode="login"
          onBack={() => {
            void signOut(auth);
          }}
          onMnemonicComplete={() => undefined}
          onGeneratedMnemonic={(words) => setBackupMnemonic(words)}
        />
      ) : (
        <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4 py-12">
          <div className="mnem-glass-heavy w-full max-w-md p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-indigo-500/25 bg-indigo-500/10">
              <Brain className="h-5 w-5 text-indigo-300" />
            </div>

            {phase === 'sealing' && (
              <>
                <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-cyan-300" />
                <h1 className="text-lg font-semibold">A confirmar no desktop…</h1>
                <p className="mt-2 text-sm text-white/55">
                  Quase. Mantém esta janela aberta uns segundos.
                </p>
              </>
            )}

            {phase === 'done' && (
              <>
                <CheckCircle2 className="mx-auto mb-3 h-7 w-7 text-emerald-300" />
                <h1 className="text-lg font-semibold">Desktop autenticado</h1>
                <p className="mt-2 text-sm text-white/55">
                  {signedInEmail
                    ? `Sessão de ${signedInEmail} enviada para a app.`
                    : 'Sessão enviada para a app Mnemosyne.'}
                  {' '}Podes fechar esta janela e voltar ao desktop.
                </p>
              </>
            )}

            {phase === 'error' && (
              <>
                <h1 className="text-lg font-semibold">Login desktop falhou</h1>
                <p className="mt-2 text-sm text-rose-300/90">{error}</p>
                <Link
                  to="/login"
                  className="mt-5 inline-flex rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
                >
                  Ir para login web
                </Link>
              </>
            )}
          </div>
        </div>
      )}

      <MnemonicBackupModal
        mnemonic={backupMnemonic}
        onClose={() => setBackupMnemonic(null)}
      />
    </div>
  );
}
