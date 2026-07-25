import React from 'react';
import { ArrowLeft, Mail } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const deletionMailto =
    'mailto:suporte@mnemosyne.app?subject=Pedido%20de%20eliminacao%20de%20conta%20Mnemosyne&body=Quero%20eliminar%20a%20minha%20conta%20Mnemosyne.%0A%0AEmail%20da%20conta%3A%20%0APackage%20Android%3A%20com.mnemosyne.mobile%0AConfirmo%20que%20pretendo%20eliminar%20a%20conta%20e%20os%20dados%20associados.%0A';

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
                    <h1 className="text-3xl font-bold text-white md:text-4xl">Eliminacao de conta e dados</h1>
                    <p className="mt-3 text-sm text-slate-400">Ultima atualizacao: 13 de maio de 2026</p>

                    <div className="mt-8 space-y-6 text-sm leading-7 text-slate-300 md:text-base">
                        <p>
                            Esta pagina permite iniciar um pedido de eliminacao da conta Mnemosyne e dos dados associados
                            para a app Android <strong>com.mnemosyne.mobile</strong>.
                        </p>

                        <div className="rounded-xl border border-indigo-400/20 bg-indigo-400/10 p-5">
                            <h2 className="mb-3 text-lg font-semibold text-white">Como pedir a eliminacao</h2>
                            <ol className="list-decimal space-y-2 pl-6">
                                <li>Clique no botao abaixo para abrir um email de pedido.</li>
                                <li>Inclua o email usado na conta Mnemosyne.</li>
                                <li>Confirme que pretende eliminar a conta e os dados associados.</li>
                            </ol>
                            <a
                                href={deletionMailto}
                                className="mt-5 inline-flex items-center gap-2 rounded-full bg-indigo-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400"
                            >
                                <Mail className="h-4 w-4" />
                                Pedir eliminacao por email
                            </a>
                        </div>

                        <section>
                            <h2 className="mb-2 text-lg font-semibold text-indigo-300">Dados eliminados</h2>
                            <p>
                                Quando o pedido for validado, eliminaremos a conta de autenticacao e os dados associados
                                que controlamos, incluindo memorias, notas, etiquetas, metadados de sincronizacao,
                                chaves publicas associadas a Comms e dados de perfil ligados a essa conta.
                            </p>
                        </section>

                        <section>
                            <h2 className="mb-2 text-lg font-semibold text-indigo-300">Dados que podem ser retidos</h2>
                            <p>
                                Podemos reter informacao limitada quando necessario para seguranca, prevencao de abuso,
                                cumprimento legal, registos financeiros ou resolucao de disputas. Dados mantidos por estes
                                motivos sao limitados ao necessario e retidos pelo periodo aplicavel.
                            </p>
                        </section>

                        <section>
                            <h2 className="mb-2 text-lg font-semibold text-indigo-300">Prazo</h2>
                            <p>
                                O pedido sera processado num prazo razoavel apos confirmarmos a identidade da conta.
                                Poderemos pedir informacao adicional se nao for possivel identificar a conta com seguranca.
                            </p>
                        </section>

                        <p>
                            Tambem pode contactar diretamente{' '}
                            <a className="text-indigo-300 underline" href="mailto:suporte@mnemosyne.app">
                                suporte@mnemosyne.app
                            </a>
                            .
                        </p>
                    </div>
                </article>
            </div>
        </div>
    );
};
