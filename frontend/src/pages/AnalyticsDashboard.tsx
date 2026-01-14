import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Eye, Users, Share2, Calendar, Tag, BarChart3 } from 'lucide-react';
import { db, auth } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

interface AnalyticsData {
    totalMemories: number;
    totalWords: number;
    thisWeek: number;
    totalViews: number;
    totalShares: number;
    topTags: { tag: string; count: number }[];
    topCategories: { category: string; count: number }[];
    memoryTrend: { date: string; count: number }[];
}

export const AnalyticsDashboard: React.FC = () => {
    const [analytics, setAnalytics] = useState<AnalyticsData>({
        totalMemories: 0,
        totalWords: 0,
        thisWeek: 0,
        totalViews: 0,
        totalShares: 0,
        topTags: [],
        topCategories: [],
        memoryTrend: []
    });
    const [isLoading, setIsLoading] = useState(true);

    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadAnalytics();
    }, []);

    const loadAnalytics = async () => {
        if (!auth.currentUser) {
            setIsLoading(false);
            return;
        }

        try {
            const sessionsRef = collection(db, 'sessions');
            const q = query(sessionsRef, where('uid', '==', auth.currentUser.uid));
            console.log('Fetching analytics for user:', auth.currentUser.uid);

            const snapshot = await getDocs(q);
            console.log('Analytics snapshot size:', snapshot.size);

            const sessions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // Calculate analytics
            const now = Date.now();
            const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

            const totalMemories = sessions.length;
            const totalWords = sessions.reduce((sum: number, s: any) =>
                sum + (s.text?.split(/\s+/).length || 0), 0
            );
            const thisWeek = sessions.filter((s: any) => s.timestamp > weekAgo).length;

            // Tags analysis
            const tagCounts: Record<string, number> = {};
            sessions.forEach((s: any) => {
                s.tags?.forEach((tag: string) => {
                    tagCounts[tag] = (tagCounts[tag] || 0) + 1;
                });
            });
            const topTags = Object.entries(tagCounts)
                .map(([tag, count]) => ({ tag, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 5);

            // Categories analysis
            const categoryCounts: Record<string, number> = {};
            sessions.forEach((s: any) => {
                if (s.category) {
                    categoryCounts[s.category] = (categoryCounts[s.category] || 0) + 1;
                }
            });
            const topCategories = Object.entries(categoryCounts)
                .map(([category, count]) => ({ category, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 5);

            setAnalytics({
                totalMemories,
                totalWords,
                thisWeek,
                totalViews: 0, // Would come from shares collection
                totalShares: 0, // Would come from shares collection
                topTags,
                topCategories,
                memoryTrend: [] // Would calculate from timestamps
            });
        } catch (error: any) {
            console.error('❌ Analytics error:', error);
            setError(error.message || 'Erro desconhecido ao carregar dados');
        } finally {
            setIsLoading(false);
        }
    };

    const StatCard: React.FC<{ icon: any; label: string; value: number | string; color: string }> =
        ({ icon: Icon, label, value, color }) => (
            <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="glass-card p-6"
            >
                <div className="flex items-center justify-between mb-3">
                    <div className={`w-12 h-12 rounded-lg bg-${color}-500/20 flex items-center justify-center`}>
                        <Icon className={`w-6 h-6 text-${color}-400`} />
                    </div>
                </div>
                <p className="text-3xl font-bold mb-1">{value}</p>
                <p className="text-sm text-gray-400">{label}</p>
            </motion.div>
        );

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-red-500 space-y-4">
                <p className="font-bold text-lg">Erro ao carregar análises</p>
                <p className="text-sm bg-red-500/10 p-4 rounded border border-red-500/20">{error}</p>
                <button
                    onClick={() => window.location.reload()}
                    className="px-4 py-2 bg-white/10 rounded hover:bg-white/20 transition-colors text-white text-sm"
                >
                    Tentar Novamente
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <button
                    onClick={() => window.location.href = '/'}
                    className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                    title="Voltar"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                </button>
                <BarChart3 className="w-8 h-8 text-indigo-400" />
                <div>
                    <h1 className="text-2xl font-bold glow-text">Análises</h1>
                    <p className="text-sm text-gray-400">Insights sobre suas memórias</p>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard icon={TrendingUp} label="Total de Memórias" value={analytics.totalMemories} color="indigo" />
                <StatCard icon={Calendar} label="Esta Semana" value={analytics.thisWeek} color="green" />
                <StatCard icon={Eye} label="Palavras Escritas" value={analytics.totalWords.toLocaleString()} color="blue" />
                <StatCard icon={Share2} label="Compartilhamentos" value={analytics.totalShares} color="purple" />
            </div>

            {/* Top Tags & Categories */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top Tags */}
                <div className="glass-card p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <Tag className="w-5 h-5 text-indigo-400" />
                        <h3 className="font-bold">Tags Mais Usadas</h3>
                    </div>
                    {analytics.topTags.length === 0 ? (
                        <p className="text-gray-500 text-sm">Nenhuma tag ainda</p>
                    ) : (
                        <div className="space-y-3">
                            {analytics.topTags.map((item, index) => (
                                <div key={item.tag} className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <span className="text-xs font-bold text-gray-500">#{index + 1}</span>
                                        <span className="text-sm">{item.tag}</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="w-32 h-2 bg-white/10 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-indigo-500"
                                                style={{ width: `${(item.count / analytics.totalMemories) * 100}%` }}
                                            />
                                        </div>
                                        <span className="text-sm font-bold text-gray-400">{item.count}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Top Categories */}
                <div className="glass-card p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <Users className="w-5 h-5 text-indigo-400" />
                        <h3 className="font-bold">Categorias Principais</h3>
                    </div>
                    {analytics.topCategories.length === 0 ? (
                        <p className="text-gray-500 text-sm">Nenhuma categoria ainda</p>
                    ) : (
                        <div className="space-y-3">
                            {analytics.topCategories.map((item, index) => (
                                <div key={item.category} className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <span className="text-xs font-bold text-gray-500">#{index + 1}</span>
                                        <span className="text-sm">{item.category}</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="w-32 h-2 bg-white/10 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-green-500"
                                                style={{ width: `${(item.count / analytics.totalMemories) * 100}%` }}
                                            />
                                        </div>
                                        <span className="text-sm font-bold text-gray-400">{item.count}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
