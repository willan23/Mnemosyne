import React from 'react';
import { ArrowLeft, Mail } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AccountDeletionRecovery } from '../components/AccountDeletionRecovery';

const deletionMailto =
    'mailto:suporte@mnemosyne-one.com?subject=Pedido%20de%20elimina%C3%A7%C3%A3o%20de%20conta%20Mnemosyne&body=Quero%20eliminar%20a%20minha%20conta%20Mnemosyne.%0A%0AEmail%20da%20conta%3A%20%0APackage%20Android%3A%20com.mnemosyne.mobile%0AConfirmo%20que%20pretendo%20eliminar%20a%20conta%20e%20os%20dados%20associados.%0A';

export const AccountDeletionPage: React.FC = () => {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-[#050816] px-5 py-8 text-slate-100 md:px-8">
            <div className="mx-auto max-w-3xl">
                <button
                    onClick={() => navigate('/')}
                    className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-indigo-200 transition-colors hover:bg-white/10 hover:text-white"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Voltar
                </button>

                <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/30 md:p-10">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-indigo-300">
                        Mnemosyne
                    </p>
                    <h1 className="text-3xl font-bold text-white md:text-4xl">Eliminação de conta e dados</h1>
                    <p className="mt-3 text-sm text-slate-400">Última atualização: 2 de outubro de 2026</p>

                    <div className="mt-8 space-y-6 text-sm leading-7 text-slate-300 md:text-base">
                        <AccountDeletionRecovery />
                        <p>
                            Esta página permite iniciar um pedido de eliminação da conta Mnemosyne e dos dados associados
                            para a app Android <strong>com.mnemosyne.mobile</strong>.
                        </p>

                        <div className="rounded-xl border border-indigo-400/20 bg-indigo-400/10 p-5">
                            <h2 className="mb-3 text-lg font-semibold text-white">Como pedir a eliminação</h2>
                            <ol className="list-decimal space-y-2 pl-6">
                                <li>Clique no botão abaixo para abrir um email de pedido.</li>
                                <li>Inclua o email usado na conta Mnemosyne.</li>
                                <li>Confirme que pretende eliminar a conta e os dados associados.</li>
                            </ol>
                            <a
                                href={deletionMailto}
                                className="mt-5 inline-flex items-center gap-2 rounded-full bg-indigo-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400"
                            >
                                <Mail className="h-4 w-4" />
                                Pedir eliminação por email
                            </a>
                        </div>

                        <section>
                            <h2 className="mb-2 text-lg font-semibold text-indigo-300">Dados eliminados</h2>
                            <p>
                                Quando o pedido for validado, eliminaremos a conta de autenticação e os dados associados
                                que controlamos, incluindo memórias, notas, etiquetas, metadados de sincronização,
                                chaves públicas associadas a Comms e dados de perfil ligados a essa conta.
                                As equipas de que é dono e os dados nelas guardados também são eliminados. Outros membros podem ter conservado cópias locais já descarregadas.
                            </p>
                        </section>

                        <section>
                            <h2 className="mb-2 text-lg font-semibold text-indigo-300">Dados que podem ser retidos</h2>
                            <p>
                                Podemos reter informação limitada quando necessário para segurança, prevenção de abuso,
                                cumprimento legal, registos financeiros ou resolução de disputas. Dados mantidos por estes
                                motivos são limitados ao necessário e retidos pelo período aplicável.
                                A remoção dos dados ativos não confirma a expiração de cópias de segurança ou de objetos sujeitos a retenção no fornecedor.
                            </p>
                        </section>

                        <section>
                            <h2 className="mb-2 text-lg font-semibold text-indigo-300">Prazo</h2>
                            <p>
                                O pedido será processado num prazo razoável após confirmarmos a identidade da conta.
                                Poderemos pedir informação adicional se não for possível identificar a conta com segurança.
                            </p>
                        </section>

                        <p>
                            Também pode contactar diretamente{' '}
                            <a className="text-indigo-300 underline" href="mailto:suporte@mnemosyne-one.com">
                                suporte@mnemosyne-one.com
                            </a>
                            .
                        </p>
                    </div>
                </article>
            </div>
        </div>
    );
};
