import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <section className="space-y-3">
        <h2 className="text-xl font-bold text-indigo-300">{title}</h2>
        <div className="space-y-3 text-sm leading-7 text-slate-300 md:text-base">{children}</div>
    </section>
);

export const PrivacyPage: React.FC = () => {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-[#050816] px-5 py-8 text-slate-100 md:px-8">
            <div className="mx-auto max-w-4xl">
                <button
                    onClick={() => navigate('/')}
                    className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-indigo-200 transition-colors hover:bg-white/10 hover:text-white"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Voltar
                </button>

                <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/30 md:p-10">
                    <header className="border-b border-white/10 pb-7">
                        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-indigo-300">
                            Mnemosyne
                        </p>
                        <h1 className="text-3xl font-bold text-white md:text-4xl">Politica de Privacidade</h1>
                        <p className="mt-3 text-sm text-slate-400">Ultima atualizacao: 17 de julho de 2026</p>
                    </header>

                    <div className="mt-8 space-y-8">
                        <Section title="0. Zero-Knowledge — o que e e o que nao e">
                            <p>
                                O Mnemosyne e desenhado para <strong>privacidade de conteudo</strong>: a frase de 12 palavras (mnemotecnica)
                                e usada no teu dispositivo para derivar chaves criptograficas e desbloquear identidade de Comms.
                                A mnemotecnica <strong>nao e enviada para os nossos servidores</strong> e nao e guardada em localStorage permanente.
                            </p>
                            <p>
                                Isto <strong>nao significa anonimato total</strong>. Se usares login com email/Google ou sincronizacao na cloud,
                                o Firebase/Google pode processar metadados de conta (email, UID, timestamps, chaves publicas de Comms).
                                Embeddings e insights preferem o teu dispositivo; pedidos de IA cloud ou pesquisa web so correm quando tu os pedes.
                            </p>
                            <p>
                                Partilha por link publico em texto claro foi desativada. Novas capsulas usam cifra com passphrase out-of-band,
                                ou Comms E2E entre utilizadores.
                            </p>
                        </Section>

                        <Section title="1. Quem somos">
                            <p>
                                Esta Politica de Privacidade explica como o Mnemosyne trata dados no site, na app web e na app Android
                                publicada com o package <strong>com.mnemosyne.mobile</strong>. O Mnemosyne e uma ferramenta de memoria,
                                notas, pesquisa assistida por IA e visualizacao de conhecimento pessoal.
                            </p>
                            <p>
                                Contacto para privacidade e suporte:{' '}
                                <a className="text-indigo-300 underline" href="mailto:suporte@mnemosyne.app">
                                    suporte@mnemosyne.app
                                </a>
                                .
                            </p>
                        </Section>

                        <Section title="2. Dados que podemos recolher">
                            <ul className="list-disc space-y-2 pl-6">
                                <li>Dados de conta, como email, identificador de utilizador e metodo de autenticacao.</li>
                                <li>Conteudo criado pelo utilizador, como memorias, notas, etiquetas, anexos e relacoes entre ideias.</li>
                                <li>Chaves publicas e metadados tecnicos necessarios para funcionalidades de Comms, partilha e sincronizacao.</li>
                                <li>Pedidos de pesquisa web ou comandos de IA quando o utilizador decide usar essas funcionalidades.</li>
                                <li>Dados tecnicos minimos, como registos de erro, eventos de seguranca e informacao necessaria para manter o servico.</li>
                                <li>Dados de pagamento apenas quando planos pagos forem ativados; neste caso, o processamento sera feito por fornecedor de pagamentos externo.</li>
                            </ul>
                        </Section>

                        <Section title="3. Permissoes do dispositivo">
                            <p>
                                A app Android pode pedir acesso a camera para ler QR codes de emparelhamento ou instalacao. O Mnemosyne nao usa
                                esta permissao para gravar fotografias pessoais sem acao do utilizador.
                            </p>
                        </Section>

                        <Section title="4. Como usamos os dados">
                            <ul className="list-disc space-y-2 pl-6">
                                <li>Criar e proteger a conta do utilizador.</li>
                                <li>Guardar, sincronizar, pesquisar, editar e apresentar memorias.</li>
                                <li>Gerar visualizacoes, clusters, relacoes semanticas e insights pessoais.</li>
                                <li>Permitir Comms, partilhas e emparelhamento entre dispositivos quando ativado pelo utilizador.</li>
                                <li>Executar pedidos de pesquisa web ou IA quando o utilizador solicitar.</li>
                                <li>Prevenir abuso, diagnosticar falhas e manter a seguranca do servico.</li>
                            </ul>
                        </Section>

                        <Section title="5. IA, pesquisa web e fornecedores externos">
                            <p>
                                O Mnemosyne privilegia processamento local e controlado pelo utilizador. Quando uma funcionalidade exige um
                                fornecedor externo, como Firebase, Google Cloud, Stripe ou um fornecedor de IA configurado pelo utilizador,
                                apenas os dados necessarios para executar a funcionalidade sao enviados.
                            </p>
                            <p>
                                As memorias do utilizador nao sao vendidas e nao sao usadas pelo Mnemosyne para treinar modelos publicos.
                                Provedores externos podem ter as suas proprias politicas quando o utilizador decide usar esses servicos.
                            </p>
                        </Section>

                        <Section title="6. Partilha de dados">
                            <p>
                                Nao vendemos dados pessoais. Podemos partilhar dados apenas com fornecedores essenciais para operar o servico,
                                cumprir obrigacoes legais, proteger utilizadores ou executar uma acao pedida pelo proprio utilizador.
                            </p>
                            <ul className="list-disc space-y-2 pl-6">
                                <li>Firebase/Google Cloud para autenticacao, base de dados, armazenamento, funcoes e hosting.</li>
                                <li>Stripe ou fornecedor equivalente para pagamentos, quando planos pagos estiverem ativos.</li>
                                <li>Fornecedores de IA ou pesquisa apenas quando a funcionalidade for usada ou configurada pelo utilizador.</li>
                            </ul>
                        </Section>

                        <Section title="7. Seguranca">
                            <p>
                                Aplicamos controlos tecnicos para reduzir risco de acesso nao autorizado, incluindo HTTPS, regras de seguranca,
                                autenticacao, armazenamento protegido no dispositivo e separacao entre chaves privadas e dados publicos sempre
                                que aplicavel. Nenhum sistema e totalmente imune a falhas, mas trabalhamos para proteger os dados de forma
                                proporcional ao risco.
                            </p>
                        </Section>

                        <Section title="8. Retencao e eliminacao">
                            <p>
                                Mantemos dados enquanto a conta existir ou enquanto forem necessarios para fornecer o servico, cumprir obrigacoes
                                legais ou resolver problemas de seguranca. O utilizador pode eliminar memorias dentro da app e pode pedir ou
                                iniciar eliminacao da conta nas definicoes quando essa opcao estiver disponivel.
                            </p>
                            <p>
                                Para pedir eliminacao de conta ou dados, contacte{' '}
                                <a className="text-indigo-300 underline" href="mailto:suporte@mnemosyne.app">
                                    suporte@mnemosyne.app
                                </a>
                                {' '}ou use a pagina publica de{' '}
                                <a className="text-indigo-300 underline" href="/account-deletion">
                                    eliminacao de conta
                                </a>
                                . O pedido deve incluir o email da conta para conseguirmos localizar os dados.
                            </p>
                        </Section>

                        <Section title="9. Crianças">
                            <p>
                                O Mnemosyne nao e dirigido a criancas com menos de 13 anos. Se descobrirmos que recolhemos dados de uma crianca
                                sem consentimento adequado, tomaremos medidas razoaveis para eliminar esses dados.
                            </p>
                        </Section>

                        <Section title="10. Direitos do utilizador">
                            <p>
                                Dependendo da legislacao aplicavel, o utilizador pode pedir acesso, correcao, exportacao, oposicao ou eliminacao
                                dos seus dados pessoais. Para exercer estes direitos, contacte o suporte indicado nesta politica.
                            </p>
                        </Section>

                        <Section title="11. Alteracoes a esta politica">
                            <p>
                                Podemos atualizar esta politica para refletir alteracoes no produto, requisitos legais ou praticas de seguranca.
                                A data no topo desta pagina indica a versao mais recente.
                            </p>
                        </Section>
                    </div>
                </article>
            </div>
        </div>
    );
};
