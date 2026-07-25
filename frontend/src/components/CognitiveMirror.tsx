import React, { useState } from 'react';
import { BrainCircuit, Send, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export const CognitiveMirror: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const [messages, setMessages] = useState<{role: 'user' | 'system', text: string}[]>([
    { role: 'system', text: 'Eu sou o teu Espelho Cognitivo local. Faz uma pergunta ou cola uma memória e eu ajudo a refletir sem fingir acesso a dados que ainda não foram carregados aqui.' }
  ]);
  const [input, setInput] = useState('');

  const handleSend = () => {
    if (!input.trim()) return;
    const userText = input.trim();
    setMessages(prev => [...prev, { role: 'user', text: input }]);
    setInput('');
    const response = userText.includes('?')
      ? 'Posso ajudar a decompor essa pergunta em hipótese, evidência e próxima ação. Ainda não vou afirmar padrões históricos sem memórias selecionadas.'
      : 'Recebi esta ideia como reflexão local. Para detectar contradições reais, seleciona ou cola as memórias que queres comparar.';
    setMessages(prev => [...prev, { role: 'system', text: response }]);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 50, scale: 0.95 }}
          className="fixed bottom-32 right-12 w-96 max-w-[calc(100vw-2rem)] h-[500px] glass-card flex flex-col z-50 overflow-hidden border-indigo-500/20"
        >
          {/* Header */}
          <div className="p-4 border-b border-white/5 flex justify-between items-center bg-black/40 backdrop-blur-md">
            <div className="flex items-center gap-2 text-indigo-400 font-bold uppercase tracking-widest text-xs">
              <BrainCircuit className="w-4 h-4" /> Espelho Cognitivo
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 p-4 overflow-y-auto flex flex-col gap-4 custom-scrollbar bg-black/20">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] p-3 rounded-2xl text-sm font-light leading-relaxed ${
                  m.role === 'user' 
                    ? 'bg-indigo-600/30 text-indigo-100 rounded-tr-sm border border-indigo-500/30' 
                    : 'bg-white/5 text-gray-300 rounded-tl-sm border border-white/5'
                }`}>
                  {m.text}
                </div>
              </div>
            ))}
          </div>

          {/* Input */}
          <div className="p-4 border-t border-white/5 bg-black/40 backdrop-blur-md flex gap-2">
            <input 
              type="text" 
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="Reflete com a tua IA..."
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500/50 transition-colors"
            />
            <button 
              onClick={handleSend}
              className="p-2 rounded-xl bg-indigo-600/50 text-indigo-100 hover:bg-indigo-500 transition-colors disabled:opacity-50"
              disabled={!input.trim()}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
