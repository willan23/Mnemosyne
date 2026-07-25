import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import {
  Cpu,
  Globe,
  Copy,
  Check,
  RefreshCw,
  Plus,
  Server,
  Code,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import {
  BUILTIN_MNEMOSYNE_MCP_TOOLS,
  generateClaudeDesktopConfig,
  generateCursorConfig,
  generateOpenApiSpec,
  getMcpServers,
  saveMcpServers,
  testMcpConnection,
  type McpServerConfig,
} from '../services/mcpBridge';

export const McpIntegrationPanel: React.FC = () => {
  const [servers, setServers] = useState<McpServerConfig[]>(getMcpServers);
  const [selectedTab, setSelectedTab] = useState<'claude' | 'cursor' | 'openapi' | 'tools'>('claude');
  const [copiedTab, setCopiedTab] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [newServerName, setNewServerName] = useState('');
  const [newServerUrl, setNewServerUrl] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    saveMcpServers(servers);
  }, [servers]);

  const handleTestConnection = async (server: McpServerConfig) => {
    setTestingId(server.id);
    toast.loading(`A testar ligação com ${server.name}…`, { id: `mcp-test-${server.id}` });

    const res = await testMcpConnection(server.url, server.apiKey);

    setServers((prev) =>
      prev.map((s) =>
        s.id === server.id
          ? {
              ...s,
              status: res.success ? 'connected' : 'error',
              lastPingMs: res.latencyMs,
              errorMessage: res.error,
              tools: res.tools.length > 0 ? res.tools : s.tools,
            }
          : s,
      ),
    );

    setTestingId(null);
    if (res.success) {
      toast.success(`Ligação OK! Latência: ${res.latencyMs} ms`, { id: `mcp-test-${server.id}` });
    } else {
      toast.error(`Falha: ${res.error || 'Não foi possível ligar'}`, { id: `mcp-test-${server.id}` });
    }
  };

  const handleCopyConfig = (type: 'claude' | 'cursor' | 'openapi') => {
    let textToCopy = '';
    if (type === 'claude') textToCopy = generateClaudeDesktopConfig();
    else if (type === 'cursor') textToCopy = generateCursorConfig();
    else if (type === 'openapi') textToCopy = generateOpenApiSpec();

    navigator.clipboard.writeText(textToCopy);
    setCopiedTab(type);
    toast.success('Configuração copiada para a área de transferência!');
    setTimeout(() => setCopiedTab(null), 2500);
  };

  const handleAddServer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newServerName.trim() || !newServerUrl.trim()) {
      toast.error('Preenche o nome e a URL do servidor MCP.');
      return;
    }

    const newServer: McpServerConfig = {
      id: `mcp-custom-${Date.now()}`,
      name: newServerName.trim(),
      url: newServerUrl.trim(),
      type: 'sse',
      enabled: true,
      status: 'disconnected',
      tools: BUILTIN_MNEMOSYNE_MCP_TOOLS,
    };

    const updated = [...servers, newServer];
    setServers(updated);
    setNewServerName('');
    setNewServerUrl('');
    setShowAddForm(false);
    toast.success('Novo Servidor MCP adicionado!');
    void handleTestConnection(newServer);
  };

  const toggleServerEnabled = (id: string) => {
    setServers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)),
    );
  };

  return (
    <div className="space-y-6 text-white">
      {/* Banner de Destaque MCP & API */}
      <div className="relative overflow-hidden rounded-2xl border border-cyan-500/30 bg-gradient-to-br from-cyan-950/40 via-slate-900/80 to-purple-950/40 p-5 shadow-2xl backdrop-blur-xl">
        <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-cyan-400/30 bg-cyan-500/20 p-2.5 text-cyan-300 shadow-inner">
              <Cpu className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-wide">
                  Model Context Protocol (MCP) & API Gateway
                </h3>
                <span className="rounded-full border border-cyan-400/40 bg-cyan-500/20 px-2 py-0.5 text-[10px] font-semibold text-cyan-200">
                  v1.0.7 Apex
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">
                Ligue o Mnemosyne diretamente ao <strong>Claude Desktop</strong>, <strong>Cursor AI</strong>, <strong>Antigravity</strong>, <strong>Ollama Local</strong> ou agentes externos com 1 clique.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Lista de Servidores MCP Ligados */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-300">
            <Server className="h-4 w-4 text-cyan-400" />
            Servidores MCP & Endpoints de API Ativos
          </h4>
          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-500/30 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/30 hover:text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar Servidor MCP
          </button>
        </div>

        {/* Formulário para adicionar servidor MCP */}
        {showAddForm && (
          <form
            onSubmit={handleAddServer}
            className="rounded-2xl border border-cyan-400/20 bg-slate-900/90 p-4 space-y-3 backdrop-blur"
          >
            <p className="text-xs font-semibold text-cyan-200">Adicionar Servidor MCP Customizado</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Nome (ex: Ollama MCP Local)"
                value={newServerName}
                onChange={(e) => setNewServerName(e.target.value)}
                className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
              />
              <input
                type="text"
                placeholder="URL (ex: http://localhost:11434/api/mcp)"
                value={newServerUrl}
                onChange={(e) => setNewServerUrl(e.target.value)}
                className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="rounded-xl border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rounded-xl bg-cyan-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-cyan-400"
              >
                Guardar e Testar
              </button>
            </div>
          </form>
        )}

        {/* Cards dos Servidores */}
        <div className="grid grid-cols-1 gap-3">
          {servers.map((server) => (
            <div
              key={server.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/60 p-4 transition hover:border-cyan-500/30"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`rounded-xl p-2.5 border ${
                    server.status === 'connected'
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                      : server.status === 'error'
                      ? 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                      : 'border-slate-700 bg-slate-800 text-slate-400'
                  }`}
                >
                  <Globe className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs text-white truncate">{server.name}</span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        server.status === 'connected'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : server.status === 'error'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}
                    >
                      {server.status === 'connected' ? (
                        <>
                          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                          Ligado ({server.lastPingMs || 18} ms)
                        </>
                      ) : server.status === 'error' ? (
                        <>
                          <AlertCircle className="h-3 w-3 text-rose-400" />
                          Erro
                        </>
                      ) : (
                        'Desligado'
                      )}
                    </span>
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-400 truncate">{server.url}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-center">
                <button
                  type="button"
                  disabled={testingId === server.id}
                  onClick={() => void handleTestConnection(server)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 transition hover:bg-slate-700 hover:text-white disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${testingId === server.id ? 'animate-spin' : ''}`} />
                  Testar Ligação
                </button>

                <button
                  type="button"
                  onClick={() => toggleServerEnabled(server.id)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-medium transition border ${
                    server.enabled
                      ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20'
                      : 'border-white/10 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  {server.enabled ? 'Ativo' : 'Ativar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Snippet Generator em 1 Clique para Claude, Cursor, OpenAPI */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 space-y-4 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-300 flex items-center gap-2">
              <Code className="h-4 w-4 text-purple-400" />
              Gerador de Configuração MCP Pronta a Usar
            </h4>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Copia a configuração para integrar o Mnemosyne diretamente com o teu assistente de IA preferido.
            </p>
          </div>

          <div className="flex rounded-xl border border-white/10 bg-slate-950 p-1">
            <button
              type="button"
              onClick={() => setSelectedTab('claude')}
              className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                selectedTab === 'claude' ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/30' : 'text-slate-400 hover:text-white'
              }`}
            >
              Claude Desktop
            </button>
            <button
              type="button"
              onClick={() => setSelectedTab('cursor')}
              className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                selectedTab === 'cursor' ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/30' : 'text-slate-400 hover:text-white'
              }`}
            >
              Cursor AI
            </button>
            <button
              type="button"
              onClick={() => setSelectedTab('openapi')}
              className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                selectedTab === 'openapi' ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/30' : 'text-slate-400 hover:text-white'
              }`}
            >
              OpenAPI (Swagger)
            </button>
            <button
              type="button"
              onClick={() => setSelectedTab('tools')}
              className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                selectedTab === 'tools' ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/30' : 'text-slate-400 hover:text-white'
              }`}
            >
              Ferramentas ({BUILTIN_MNEMOSYNE_MCP_TOOLS.length})
            </button>
          </div>
        </div>

        {/* Conteúdo do Código / Ferramentas */}
        {selectedTab !== 'tools' ? (
          <div className="space-y-3">
            <div className="relative rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs text-cyan-100 overflow-x-auto">
              <button
                type="button"
                onClick={() => handleCopyConfig(selectedTab)}
                className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-500/30"
              >
                {copiedTab === selectedTab ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    Copiado!
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copiar Configuração
                  </>
                )}
              </button>

              <pre className="mt-6 leading-relaxed">
                {selectedTab === 'claude' && generateClaudeDesktopConfig()}
                {selectedTab === 'cursor' && generateCursorConfig()}
                {selectedTab === 'openapi' && generateOpenApiSpec()}
              </pre>
            </div>

            <p className="text-[11px] leading-relaxed text-slate-400">
              💡 <strong>Dica de Instalação:</strong> Cole o código acima no arquivo{' '}
              <code className="text-cyan-300 font-mono">
                {selectedTab === 'claude'
                  ? 'claude_desktop_config.json'
                  : selectedTab === 'cursor'
                  ? '.cursor/mcp.json'
                  : 'openapi.json'}
              </code>{' '}
              da sua aplicação para dar acesso instantâneo ao seu Grafo Cognitivo 3D.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            {BUILTIN_MNEMOSYNE_MCP_TOOLS.map((tool) => (
              <div
                key={tool.name}
                className="rounded-xl border border-white/10 bg-slate-950/70 p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-cyan-300">{tool.name}</span>
                  <span className="rounded bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-200 border border-cyan-500/20">
                    MCP Tool
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-normal">{tool.description}</p>
                <div className="text-[10px] font-mono text-slate-500">
                  Paramêtros: {Object.keys(tool.inputSchema.properties).join(', ')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
