// Dashboard.tsx - Componente principal do MVP

import React, { useState, useEffect } from 'react';
// import { ConstellationGraph } from './ConstellationGraph'; // Componente simulado para o GC

// --- Tipos de Dados (Baseados no Grafo de Conhecimento) ---
interface Node {
  id: string;
  type: 'PESSOA' | 'LOCAL' | 'EVENTO' | 'CONCEITO' | 'ARTEFACTO';
  label: string;
}

interface LegacyStatus {
  totalSessions: number;
  completedSessions: number;
  legacyPercentage: number;
  nextQuestion: string;
  connectedFamily: number;
  graphData: {
    nodes: Node[];
    edges: any[]; // Simplificado para o PoC
  };
}

// --- Dados Mock (Simulação do Backend) ---
const mockLegacyData: LegacyStatus = {
  totalSessions: 50,
  completedSessions: 12,
  legacyPercentage: 24, // 12/50 * 100
  nextQuestion: "Qual foi a sua maior lição sobre a paternidade/maternidade?",
  connectedFamily: 3,
  graphData: {
    nodes: [
      { id: 'p1', type: 'PESSOA', label: 'Maria (Avó)' },
      { id: 'e1', type: 'EVENTO', label: 'Crise 2008' },
      { id: 'c1', type: 'CONCEITO', label: 'Perseverança' },
      { id: 'p2', type: 'PESSOA', label: 'João (Filho)' },
      { id: 'l1', type: 'LOCAL', label: 'Casa da Infância' },
    ],
    edges: [
      // Arestas simuladas
    ]
  }
};

// --- Componente Simulado do Grafo (Constelação) ---
const ConstellationGraph: React.FC<{ nodes: Node[] }> = ({ nodes }) => {
  return (
    <div className="h-96 w-full bg-gray-900 rounded-xl p-4 relative overflow-hidden">
      <h3 className="text-xl font-light text-white mb-4">O Seu Legado: Constelação de Memórias</h3>
      {nodes.map((node, index) => (
        <div
          key={node.id}
          className={`absolute p-2 rounded-full text-xs font-semibold shadow-lg transition-all duration-500 
                      ${node.type === 'PESSOA' ? 'bg-blue-500' : node.type === 'EVENTO' ? 'bg-yellow-500' : 'bg-gray-500'} text-white`}
          style={{
            top: `${(index * 15 + 10) % 80}%`, // Posição simulada
            left: `${(index * 20 + 5) % 90}%`, // Posição simulada
            transform: 'translate(-50%, -50%)',
          }}
        >
          {node.label}
        </div>
      ))}
      <p className="absolute bottom-4 right-4 text-gray-500 text-sm">Clique nas estrelas para explorar as histórias.</p>
    </div>
  );
};

// --- Componente Principal do Dashboard ---
const Dashboard: React.FC = () => {
  const [status, setStatus] = useState<LegacyStatus>(mockLegacyData);

  // Simulação de carregamento de dados
  useEffect(() => {
    // Aqui seria a chamada à API para buscar o status do legado
    // fetch('/api/legacy/status').then(res => res.json()).then(setStatus);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-8 font-sans">
      <header className="mb-10">
        <h1 className="text-4xl font-bold text-gray-800">Mnemosyne (Echoes) Dashboard</h1>
        <p className="text-gray-500">O seu biógrafo pessoal de conhecimento zero.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Coluna 1: Progresso e Próximo Passo */}
        <div className="lg:col-span-1 space-y-8">
          {/* Cartão de Progresso */}
          <div className="bg-white p-6 rounded-xl shadow-lg border-t-4 border-blue-600">
            <h2 className="text-xl font-semibold text-gray-700 mb-4">Progresso do Legado</h2>
            <div className="text-6xl font-extrabold text-blue-600 mb-2">{status.legacyPercentage}%</div>
            <p className="text-sm text-gray-500">
              {status.completedSessions} de {status.totalSessions} sessões de entrevista concluídas.
            </p>
            <div className="w-full bg-gray-200 rounded-full h-2.5 mt-4">
              <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${status.legacyPercentage}%` }}></div>
            </div>
          </div>

          {/* Cartão do Próximo Passo (Ação Proativa) */}
          <div className="bg-white p-6 rounded-xl shadow-lg border-t-4 border-green-600">
            <h2 className="text-xl font-semibold text-gray-700 mb-4">Próximo Passo: Iniciar Conversa</h2>
            <p className="text-lg font-medium text-gray-800 mb-4">
              {status.nextQuestion}
            </p>
            <button className="w-full bg-green-600 text-white py-3 rounded-lg font-bold hover:bg-green-700 transition duration-200">
              Iniciar Entrevista (5 min)
            </button>
          </div>

          {/* Cartão de Viralidade */}
          <div className="bg-white p-6 rounded-xl shadow-lg">
            <h2 className="text-xl font-semibold text-gray-700 mb-4">Conexão Familiar</h2>
            <p className="text-3xl font-bold text-gray-800">{status.connectedFamily} Familiares Conectados</p>
            <p className="text-sm text-gray-500 mt-2">Use o Link de Pré-visualização para convidar mais pessoas.</p>
          </div>
        </div>

        {/* Coluna 2/3: Visualização do Grafo de Conhecimento */}
        <div className="lg:col-span-2">
          <ConstellationGraph nodes={status.graphData.nodes} />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;

// Para fins de simulação, vamos apenas escrever o conteúdo do ficheiro.
// Em um ambiente real, este código seria parte de um projeto React/Vite.
// O componente ConstellationGraph seria implementado com uma biblioteca de visualização de grafos (ex: D3.js ou vis-network).
