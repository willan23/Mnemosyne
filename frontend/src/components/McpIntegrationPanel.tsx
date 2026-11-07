import React, { useState } from 'react';
import { Check, Copy, Loader2, RefreshCw } from 'lucide-react';
import { PUBLIC_MCP_URL } from '../services/apiKeys';
import { testMcpConnection, type McpToolSchema } from '../services/mcpBridge';

export const McpIntegrationPanel: React.FC = () => {
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    latencyMs: number;
    tools: McpToolSchema[];
    error?: string;
  } | null>(null);

  const testConnection = async () => {
    const token = apiKey.trim();
    setApiKey('');
    setTesting(true);
    try {
      setResult(await testMcpConnection(PUBLIC_MCP_URL, token));
    } finally {
      setTesting(false);
    }
  };

  const copyEndpoint = async () => {
    await navigator.clipboard.writeText(PUBLIC_MCP_URL);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  };

  return (
    <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-white">
      <div>
        <h3 className="text-sm font-semibold">API e MCP em leitura</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          O endpoint público devolve envelopes cifrados e metadados para leitura e pesquisa. Escritas por agentes estão suspensas até existir pré-visualização e confirmação no cliente. A integração com clientes externos ainda precisa de validação própria.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-cyan-200">
          {PUBLIC_MCP_URL}
        </code>
        <button type="button" onClick={() => void copyEndpoint()} className="rounded-lg border border-white/10 p-2 text-slate-300 hover:bg-white/10" aria-label="Copiar endpoint MCP">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>

      <label className="block text-xs text-slate-300">
        API key para testar acesso às ferramentas
        <input
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="Chave criada no painel API keys"
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-slate-500"
        />
      </label>
      <p className="text-xs text-slate-500">A chave não é guardada; o campo é limpo ao iniciar o teste.</p>

      <button
        type="button"
        disabled={testing || !apiKey.trim()}
        onClick={() => void testConnection()}
        className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-xs font-medium text-cyan-100 disabled:opacity-40"
      >
        {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        Testar ligação autenticada
      </button>

      {result && (
        <div className={`rounded-lg border px-3 py-2 text-xs ${result.success ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100' : 'border-rose-400/25 bg-rose-400/10 text-rose-100'}`} role="status">
          {result.success
            ? `Ligação verificada em ${result.latencyMs} ms. Ferramentas disponíveis: ${result.tools.map((tool) => tool.name).join(', ')}.`
            : result.error || 'Não foi possível verificar a ligação.'}
        </div>
      )}
    </section>
  );
};
