
import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const PrivacyPage: React.FC = () => {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-indigo-100 p-8">
            <div className="max-w-4xl mx-auto">
                <button
                    onClick={() => navigate('/')}
                    className="flex items-center gap-2 text-indigo-400 hover:text-indigo-300 mb-8 transition-colors"
                >
                    <ArrowLeft className="w-5 h-5" />
                    Voltar
                </button>

                <div className="glass-card p-8 md:p-12 space-y-8">
                    <header className="border-b border-white/10 pb-8">
                        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-400 mb-2">
                            Política de Privacidade
                        </h1>
                        <p className="text-gray-400">Última atualização: 03 de Janeiro de 2026</p>
                    </header>

                    <section className="space-y-4">
                        <p className="leading-relaxed text-gray-300">
                            A sua privacidade é importante para nós. É política do <strong>Mnemosyne</strong> respeitar a sua privacidade em relação a qualquer informação que possamos coletar no aplicativo Mnemosyne e no site associado.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-xl font-bold text-indigo-300">1. Informações que Coletamos</h2>

                        <div className="space-y-4 pl-4 border-l-2 border-indigo-500/20">
                            <div>
                                <h3 className="font-bold text-lg text-white mb-2">1.1. Dados Pessoais</h3>
                                <p className="text-gray-400 leading-relaxed">
                                    Solicitamos informações pessoais apenas quando realmente precisamos delas para lhe fornecer um serviço. Coletamos:
                                </p>
                                <ul className="list-disc list-inside mt-2 space-y-1 text-gray-400">
                                    <li><strong>Identificação:</strong> Nome e E-mail (via Login Social ou Cadastro Direto).</li>
                                    <li><strong>Conteúdo:</strong> Memórias, textos, fotos e tags que você cria voluntariamente.</li>
                                    <li><strong>Pagamento:</strong> Dados de transação processados de forma segura pelo Stripe.</li>
                                </ul>
                            </div>

                            <div>
                                <h3 className="font-bold text-lg text-white mb-2">1.2. Dados de Uso e IA</h3>
                                <p className="text-gray-400 leading-relaxed">
                                    O Mnemosyne utiliza Inteligência Artificial (Google Gemini) para processar suas memórias.
                                    Os seus dados são enviados para a API de IA <strong>apenas para processamento</strong> e retorno das análises.
                                    Não utilizamos seus dados para treinar modelos de IA públicos.
                                </p>
                            </div>
                        </div>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-xl font-bold text-indigo-300">2. Como Usamos as Informações</h2>
                        <ul className="list-disc list-inside space-y-2 text-gray-400">
                            <li>Fornecer e manter o serviço (ex: salvar suas memórias, autenticar seu acesso).</li>
                            <li>Processar pagamentos de assinaturas (Free, Pro, Sovereign).</li>
                            <li>Melhorar a experiência do usuário através da análise do Gráfico de Conhecimento.</li>
                            <li>Enviar notificações importantes sobre sua conta ou serviço.</li>
                        </ul>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-xl font-bold text-indigo-300">3. Compartilhamento de Dados</h2>
                        <p className="text-gray-400 leading-relaxed">
                            Não compartilhamos informações de identificação pessoal publicamente ou com terceiros, exceto quando exigido por lei ou para prestadores de serviço essenciais, como:
                        </p>
                        <ul className="list-disc list-inside mt-2 space-y-1 text-gray-400">
                            <li><strong>Firebase (Google):</strong> Hospedagem e banco de dados.</li>
                            <li><strong>Stripe:</strong> Processamento de pagamentos.</li>
                            <li><strong>Google Vertex AI / Gemini:</strong> Recursos de inteligência artificial.</li>
                        </ul>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-xl font-bold text-indigo-300">4. Retenção e Exclusão de Dados</h2>
                        <p className="text-gray-400 leading-relaxed">
                            Armazenamos suas informações apenas pelo tempo necessário para fornecer o serviço solicitado.
                            Você possui o <strong>Direito de Esquecimento</strong>: pode solicitar a exclusão total da sua conta nas configurações do app, removendo permanentemente todos os seus dados.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-xl font-bold text-indigo-300">5. Segurança</h2>
                        <p className="text-gray-400 leading-relaxed">
                            Adotamos medidas de segurança comercialmente aceitáveis para proteger seus dados contra perdas, roubos, acesso não autorizado, divulgação, cópia, uso ou modificação.
                        </p>
                    </section>

                    <footer className="pt-8 border-t border-white/10 text-center">
                        <p className="text-gray-500">
                            <strong>Mnemosyne Team</strong><br />
                            Contato: <a href="mailto:suporte@mnemosyne.app" className="text-indigo-400 hover:underline">suporte@mnemosyne.app</a>
                        </p>
                    </footer>
                </div>
            </div>
        </div>
    );
};
