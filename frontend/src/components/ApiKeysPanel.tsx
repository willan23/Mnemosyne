import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Copy, Loader2, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { auth } from '../firebase';
import { AgentAccessPanel } from './AgentAccessPanel';
import { AgentGrantsPanel } from './AgentGrantsPanel';
import { AgentMutationsPanel } from './AgentMutationsPanel';
import {
  API_SCOPE_LABELS,
  MAX_ACTIVE_API_KEYS,
  PUBLIC_MEMORIES_URL,
  apiKeyErrorMessage,
  buildMcpConfigJson,
  buildRestSnippet,
  createApiKey,
  formatApiKeyLastUsed,
  formatApiKeyPrefix,
  formatApiKeyScopes,
  formatApiKeyStatus,
  listApiKeys,
  revokeApiKey,
  type ApiKeyListItem,
  type ApiScope,
  type CreatedApiKey,
} from '../services/apiKeys';

type ConfirmFn = (opts: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}) => Promise<boolean>;

interface ApiKeysPanelProps {
  askConfirm: ConfirmFn;
}

const SELECTABLE_SCOPES: ApiScope[] = ['memories:read', 'memories:search'];

const CopyBlock: React.FC<{ label: string; value: string; mono?: boolean }> = ({
  label,
  value,
  mono = true,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success('Copiado.');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Não foi possível copiar.');
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-300" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <pre
        className={`overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-3 text-[11px] leading-relaxed text-slate-200 ${
          mono ? 'font-mono' : ''
        }`}
      >
        {value}
      </pre>
    </div>
  );
};

export const ApiKeysPanel: React.FC<ApiKeysPanelProps> = ({ askConfirm }) => {
  const [keys, setKeys] = useState<ApiKeyListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiScope[]>([...SELECTABLE_SCOPES]);
  const [revealed, setRevealed] = useState<CreatedApiKey | null>(null);

  const activeCount = useMemo(() => keys.filter((key) => !key.revoked).length, [keys]);
  const atLimit = activeCount >= MAX_ACTIVE_API_KEYS;
  const canCreate = name.trim().length > 0 && scopes.length > 0 && !atLimit && !creating;

  const refresh = useCallback(async () => {
    if (!auth.currentUser) {
      setKeys([]);
      setError('Inicia sessão para gerir API keys.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setKeys(await listApiKeys());
    } catch (err: unknown) {
      setError(apiKeyErrorMessage(err, 'Não foi possível listar as API keys.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleScope = (scope: ApiScope) => {
    setScopes((current) =>
      current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
    );
  };

  const handleCreate = async () => {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createApiKey(name, scopes);
      setRevealed(created);
      setName('');
      setScopes([...SELECTABLE_SCOPES]);
      toast.success('API key criada. Copia o secret agora — não volta a ser visível.');
      await refresh();
    } catch (err: unknown) {
      const message = apiKeyErrorMessage(err, 'Não foi possível criar a API key.');
      setError(message);
      toast.error(message);
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (key: ApiKeyListItem) => {
    const confirmed = await askConfirm({
      title: 'Revogar API key',
      message: `A chave «${key.name || formatApiKeyPrefix(key.keyPrefix)}» deixa de autenticar REST e MCP. Esta ação não se desfaz.`,
      confirmLabel: 'Revogar',
      danger: true,
    });
    if (!confirmed) return;
    setRevokingId(key.id);
    setError(null);
    try {
      await revokeApiKey(key.id);
      toast.success('API key revogada.');
      await refresh();
    } catch (err: unknown) {
      const message = apiKeyErrorMessage(err, 'Não foi possível revogar a API key.');
      setError(message);
      toast.error(message);
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
      <div>
        <p className="text-sm font-medium text-white">API keys</p>
        <p className="mt-1 text-sm leading-relaxed text-slate-400">
          Autenticação Bearer para a API pública e MCP. Máximo de {MAX_ACTIVE_API_KEYS} chaves ativas
          ({activeCount}/{MAX_ACTIVE_API_KEYS}).
        </p>
      </div>

      <p className="rounded-lg border border-white/8 bg-black/25 px-3 py-2 text-xs leading-relaxed text-slate-400">
        A API e o MCP estão em modo de leitura e pesquisa neste lançamento. Escritas por agentes aguardam pré-visualização e confirmação no cliente. Chaves antigas com scope de escrita também não conseguem criar memórias.
      </p>
      {auth.currentUser && <AgentAccessPanel key={auth.currentUser.uid} uid={auth.currentUser.uid} />}
      {auth.currentUser && <AgentGrantsPanel key={`grants:${auth.currentUser.uid}`} uid={auth.currentUser.uid} />}
      {auth.currentUser && <AgentMutationsPanel key={`changes:${auth.currentUser.uid}`} uid={auth.currentUser.uid} />}

      <div className="space-y-3 rounded-lg border border-white/8 bg-black/20 p-3">
        <p className="text-sm font-medium text-slate-200">Nova chave</p>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-400">Nome</span>
          <input
            type="text"
            maxLength={64}
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 64))}
            placeholder="ex. Claude, script local"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-white/25"
          />
        </label>
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-slate-400">Scopes</legend>
          <div className="flex flex-wrap gap-2">
            {SELECTABLE_SCOPES.map((scope) => {
              const checked = scopes.includes(scope);
              return (
                <label
                  key={scope}
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                    checked
                      ? 'border-white/20 bg-white/[0.08] text-white'
                      : 'border-white/10 bg-white/[0.03] text-slate-400'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleScope(scope)}
                    className="accent-slate-200"
                  />
                  <span className="font-medium">{API_SCOPE_LABELS[scope]}</span>
                  <span className="font-mono text-[10px] opacity-70">{scope}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        {scopes.length === 0 && (
          <p className="text-xs text-rose-300">Escolhe pelo menos um scope.</p>
        )}
        {atLimit && (
          <p className="text-xs text-slate-400">
            Limite de {MAX_ACTIVE_API_KEYS} chaves ativas. Revoga uma para criar outra.
          </p>
        )}
        <button
          type="button"
          disabled={!canCreate}
          onClick={() => void handleCreate()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          {creating ? 'A criar…' : 'Criar chave'}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="mt-1 text-[11px] font-semibold underline-offset-2 hover:underline"
            >
              Tentar outra vez
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-200">Chaves</p>
        {loading ? (
          <div className="flex items-center gap-2 rounded-lg border border-white/8 bg-black/20 px-3 py-4 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            A carregar…
          </div>
        ) : keys.length === 0 ? (
          <p className="rounded-lg border border-white/8 bg-black/20 px-3 py-4 text-xs text-slate-500">
            Ainda não tens API keys.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-white/[0.08]">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead>
                <tr className="border-b border-white/8 text-xs text-slate-500">
                  <th className="px-3 py-2 font-medium">Nome</th>
                  <th className="px-3 py-2 font-medium">Prefixo</th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                  <th className="px-3 py-2 font-medium">Último uso</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id} className="border-b border-white/[0.05] last:border-0">
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-white">{key.name || 'Sem nome'}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">{formatApiKeyScopes(key.scopes)}</p>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-300">
                      {formatApiKeyPrefix(key.keyPrefix)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`rounded-md border px-1.5 py-0.5 text-[11px] ${
                          key.revoked
                            ? 'border-white/10 text-slate-500'
                            : 'border-white/15 text-slate-200'
                        }`}
                      >
                        {formatApiKeyStatus(key.revoked)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">
                      {formatApiKeyLastUsed(key.lastUsedAt)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {!key.revoked && (
                        <button
                          type="button"
                          disabled={revokingId === key.id}
                          onClick={() => void handleRevoke(key)}
                          className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-200 hover:bg-rose-500/20 disabled:opacity-40"
                        >
                          {revokingId === key.id ? 'A revogar…' : 'Revogar'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-lg border border-white/8 bg-black/20 p-3">
        <p className="text-sm font-medium text-slate-200">Snippets</p>
        <CopyBlock label={`REST · ${PUBLIC_MEMORIES_URL}`} value={buildRestSnippet()} />
        <CopyBlock label="Endpoint e header MCP · integração manual" value={buildMcpConfigJson()} />
      </div>

      {revealed && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/70"
            aria-label="Fechar secret"
            onClick={() => setRevealed(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="api-key-secret-title"
            className="relative w-full max-w-lg space-y-4 rounded-2xl border border-white/15 bg-[#0b1224] p-5 shadow-2xl"
          >
            <h3 id="api-key-secret-title" className="text-base font-semibold text-white">
              Secret da API key
            </h3>
            <p className="text-sm leading-relaxed text-slate-300">
              Este secret aparece <strong>uma vez</strong>. Copia-o agora — o Mnemosyne não o volta a
              mostrar. Fica só o prefixo na lista.
            </p>
            <CopyBlock label="Secret" value={revealed.secret} />
            <CopyBlock label="REST" value={buildRestSnippet(revealed.secret)} />
            <CopyBlock label="Endpoint e header MCP · integração manual" value={buildMcpConfigJson(revealed.secret)} />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setRevealed(null)}
                className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100"
              >
                Já copiei
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
