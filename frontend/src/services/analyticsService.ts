/**
 * Analytics Service
 * Calcula métricas e insights sobre o uso do Mnemosyne
 */

export interface AnalyticsData {
    // Métricas gerais
    totalMemories: number;
    totalWords: number;
    averageWordsPerMemory: number;

    // Atividade temporal
    memoriesThisWeek: number;
    memoriesThisMonth: number;
    currentStreak: number;
    longestStreak: number;

    // Categorias e tags
    topCategories: Array<{ name: string; count: number }>;
    topTags: Array<{ name: string; count: number }>;

    // Padrões de uso
    mostActiveDay: string;
    mostActiveHour: number;
    averageMemoriesPerDay: number;

    // Insights
    forgottenMemories: Array<{ id: string; text: string; daysSinceLastView: number }>;
    recentActivity: Array<{ date: string; count: number }>;
}

/**
 * Calcula todas as métricas de analytics
 */
export const calculateAnalytics = (sessions: readonly any[]): AnalyticsData => {
    if (!sessions || sessions.length === 0) {
        return getEmptyAnalytics();
    }

    // Métricas gerais
    const totalMemories = sessions.length;
    const totalWords = sessions.reduce((acc, s) => acc + (s.text?.split(' ').length || 0), 0);
    const averageWordsPerMemory = Math.round(totalWords / totalMemories);

    // Atividade temporal
    const now = Date.now();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;
    const oneMonth = 30 * 24 * 60 * 60 * 1000;

    const memoriesThisWeek = sessions.filter(s => (now - s.timestamp) < oneWeek).length;
    const memoriesThisMonth = sessions.filter(s => (now - s.timestamp) < oneMonth).length;

    // Streaks (dias consecutivos com memórias)
    const { currentStreak, longestStreak } = calculateStreaks(sessions);

    // Top categorias
    const categoryCount = new Map<string, number>();
    sessions.forEach(s => {
        if (s.category) {
            categoryCount.set(s.category, (categoryCount.get(s.category) || 0) + 1);
        }
    });
    const topCategories = Array.from(categoryCount.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    // Top tags
    const tagCount = new Map<string, number>();
    sessions.forEach(s => {
        if (s.tags && Array.isArray(s.tags)) {
            s.tags.forEach((tag: string) => {
                tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
            });
        }
    });
    const topTags = Array.from(tagCount.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

    // Padrões de uso
    const dayCount = new Map<string, number>();
    const hourCount = new Map<number, number>();

    sessions.forEach(s => {
        const date = new Date(s.timestamp);
        const dayName = date.toLocaleDateString('pt-PT', { weekday: 'long' });
        const hour = date.getHours();

        dayCount.set(dayName, (dayCount.get(dayName) || 0) + 1);
        hourCount.set(hour, (hourCount.get(hour) || 0) + 1);
    });

    const mostActiveDay = Array.from(dayCount.entries())
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

    const mostActiveHour = Array.from(hourCount.entries())
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 0;

    // Média de memórias por dia
    const oldestTimestamp = Math.min(...sessions.map(s => s.timestamp));
    const daysSinceFirst = Math.max(1, Math.ceil((now - oldestTimestamp) / (24 * 60 * 60 * 1000)));
    const averageMemoriesPerDay = Number((totalMemories / daysSinceFirst).toFixed(1));

    // Memórias esquecidas (não visualizadas há mais de 30 dias)
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const forgottenMemories = sessions
        .filter(s => {
            const lastView = s.lastViewedAt || s.timestamp;
            return (now - lastView) > thirtyDays;
        })
        .map(s => ({
            id: s.id,
            text: s.text?.substring(0, 50) || 'Sem texto',
            daysSinceLastView: Math.floor((now - (s.lastViewedAt || s.timestamp)) / (24 * 60 * 60 * 1000))
        }))
        .sort((a, b) => b.daysSinceLastView - a.daysSinceLastView)
        .slice(0, 5);

    // Atividade recente (últimos 30 dias)
    const recentActivity = calculateRecentActivity(sessions, 30);

    return {
        totalMemories,
        totalWords,
        averageWordsPerMemory,
        memoriesThisWeek,
        memoriesThisMonth,
        currentStreak,
        longestStreak,
        topCategories,
        topTags,
        mostActiveDay,
        mostActiveHour,
        averageMemoriesPerDay,
        forgottenMemories,
        recentActivity
    };
};

/**
 * Calcula streaks (dias consecutivos)
 */
const calculateStreaks = (sessions: readonly any[]): { currentStreak: number; longestStreak: number } => {
    if (sessions.length === 0) return { currentStreak: 0, longestStreak: 0 };

    // Agrupar por dia
    const daySet = new Set<string>();
    sessions.forEach(s => {
        const date = new Date(s.timestamp);
        const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
        daySet.add(dayKey);
    });

    const sortedDays = Array.from(daySet).sort();

    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 1;

    const today = new Date();
    const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
    const yesterdayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate() - 1}`;

    // Calcular streak atual
    if (sortedDays.includes(todayKey) || sortedDays.includes(yesterdayKey)) {
        currentStreak = 1;
        for (let i = sortedDays.length - 2; i >= 0; i--) {
            const current = new Date(sortedDays[i + 1]);
            const previous = new Date(sortedDays[i]);
            const diffDays = Math.floor((current.getTime() - previous.getTime()) / (24 * 60 * 60 * 1000));

            if (diffDays === 1) {
                currentStreak++;
            } else {
                break;
            }
        }
    }

    // Calcular longest streak
    for (let i = 1; i < sortedDays.length; i++) {
        const current = new Date(sortedDays[i]);
        const previous = new Date(sortedDays[i - 1]);
        const diffDays = Math.floor((current.getTime() - previous.getTime()) / (24 * 60 * 60 * 1000));

        if (diffDays === 1) {
            tempStreak++;
            longestStreak = Math.max(longestStreak, tempStreak);
        } else {
            tempStreak = 1;
        }
    }

    longestStreak = Math.max(longestStreak, tempStreak, currentStreak);

    return { currentStreak, longestStreak };
};

/**
 * Calcula atividade recente
 */
const calculateRecentActivity = (sessions: readonly any[], days: number): Array<{ date: string; count: number }> => {
    const now = Date.now();
    const activity = new Map<string, number>();

    // Inicializar todos os dias com 0
    for (let i = days - 1; i >= 0; i--) {
        const date = new Date(now - i * 24 * 60 * 60 * 1000);
        const dateKey = date.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' });
        activity.set(dateKey, 0);
    }

    // Contar memórias por dia
    sessions.forEach(s => {
        const date = new Date(s.timestamp);
        const dateKey = date.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' });
        if (activity.has(dateKey)) {
            activity.set(dateKey, (activity.get(dateKey) || 0) + 1);
        }
    });

    return Array.from(activity.entries()).map(([date, count]) => ({ date, count }));
};

/**
 * Retorna analytics vazios
 */
const getEmptyAnalytics = (): AnalyticsData => ({
    totalMemories: 0,
    totalWords: 0,
    averageWordsPerMemory: 0,
    memoriesThisWeek: 0,
    memoriesThisMonth: 0,
    currentStreak: 0,
    longestStreak: 0,
    topCategories: [],
    topTags: [],
    mostActiveDay: 'N/A',
    mostActiveHour: 0,
    averageMemoriesPerDay: 0,
    forgottenMemories: [],
    recentActivity: []
});
