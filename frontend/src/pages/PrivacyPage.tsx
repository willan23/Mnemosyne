import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PublicSiteFooter } from '../components/PublicSiteFooter';
import { formatLocaleDate, useTranslation } from '../utils/translations';

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <section className="space-y-3">
        <h2 className="text-xl font-bold text-indigo-300">{title}</h2>
        <div className="space-y-3 text-sm leading-7 text-slate-300 md:text-base">{children}</div>
    </section>
);

export const PrivacyPage: React.FC = () => {
    const navigate = useNavigate();
    const { t, language } = useTranslation();
    const updated = formatLocaleDate(new Date(2026, 8, 24), language);

    return (
        <div className="min-h-screen bg-[#050816] px-5 py-8 text-slate-100 md:px-8">
            <div className="mx-auto max-w-4xl">
                <button
                    onClick={() => navigate('/')}
                    className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-indigo-200 transition-colors hover:bg-white/10 hover:text-white"
                >
                    <ArrowLeft className="h-4 w-4" />
                    {t('back')}
                </button>

                <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/30 md:p-10">
                    <header className="border-b border-white/10 pb-7">
                        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-indigo-300">
                            Mnemosyne
                        </p>
                        <h1 className="text-3xl font-bold text-white md:text-4xl">{t('privacyH1')}</h1>
                        <p className="mt-3 text-sm text-slate-400">{t('updatedOn', { date: updated })}</p>
                    </header>

                    <div className="mt-8 space-y-8">
                        <Section title={t('privacyS0')}>
                            <p>{t('privacyS0P1')}</p>
                            <p>{t('privacyS0P2')}</p>
                            <p>{t('privacyS0P3')}</p>
                        </Section>

                        <Section title={t('privacyS1')}>
                            <p>{t('privacyS1P1')}</p>
                            <p>
                                {t('privacyS1P2')}{' '}
                                <a className="text-indigo-300 underline" href="mailto:suporte@mnemosyne-one.com">
                                    suporte@mnemosyne-one.com
                                </a>
                            </p>
                        </Section>

                        <Section title={t('privacyS2')}>
                            <ul className="list-disc space-y-2 pl-6">
                                <li>{t('privacyS2L1')}</li>
                                <li>{t('privacyS2L2')}</li>
                                <li>{t('privacyS2L3')}</li>
                                <li>{t('privacyS2L4')}</li>
                                <li>{t('privacyS2L5')}</li>
                                <li>{t('privacyS2L6')}</li>
                            </ul>
                        </Section>

                        <Section title={t('privacyS3')}>
                            <p>{t('privacyS3P1')}</p>
                        </Section>

                        <Section title={t('privacyS4')}>
                            <ul className="list-disc space-y-2 pl-6">
                                <li>{t('privacyS4L1')}</li>
                                <li>{t('privacyS4L2')}</li>
                                <li>{t('privacyS4L3')}</li>
                                <li>{t('privacyS4L4')}</li>
                                <li>{t('privacyS4L5')}</li>
                                <li>{t('privacyS4L6')}</li>
                            </ul>
                        </Section>

                        <Section title={t('privacyS5')}>
                            <p>{t('privacyS5P1')}</p>
                            <p>{t('privacyS5P2')}</p>
                        </Section>

                        <Section title={t('privacyS6')}>
                            <p>{t('privacyS6P1')}</p>
                            <ul className="list-disc space-y-2 pl-6">
                                <li>{t('privacyS6L1')}</li>
                                <li>{t('privacyS6L2')}</li>
                                <li>{t('privacyS6L3')}</li>
                            </ul>
                        </Section>

                        <Section title={t('privacyS7')}>
                            <p>{t('privacyS7P1')}</p>
                            <p>{t('privacyS7P2')}</p>
                            <p>{t('privacyS7P3')}</p>
                        </Section>

                        <Section title={t('privacyS8')}>
                            <p>{t('privacyS8P1')}</p>
                            <p>
                                {t('privacyS8P2')}{' '}
                                <a className="text-indigo-300 underline" href="/account-deletion">
                                    {t('accountDeletionLink')}
                                </a>
                            </p>
                        </Section>

                        <Section title={t('privacyS9')}>
                            <p>{t('privacyS9P1')}</p>
                        </Section>

                        <Section title={t('privacyS10')}>
                            <p>{t('privacyS10P1')}</p>
                        </Section>

                        <Section title={t('privacyS11')}>
                            <p>{t('privacyS11P1')}</p>
                        </Section>
                    </div>
                </article>
                <PublicSiteFooter />
            </div>
        </div>
    );
};
