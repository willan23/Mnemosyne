import React, { useState } from 'react';
import { Filter, Calendar, Tag, FolderOpen, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface FilterOptions {
    dateRange: 'all' | 'today' | 'week' | 'month' | 'year';
    tags: string[];
    category?: string;
}

interface FilterPanelProps {
    onFilterChange: (filters: FilterOptions) => void;
    availableTags: string[];
    availableCategories: string[];
}

export const FilterPanel: React.FC<FilterPanelProps> = ({
    onFilterChange,
    availableTags,
    availableCategories
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [filters, setFilters] = useState<FilterOptions>({
        dateRange: 'all',
        tags: [],
        category: undefined
    });

    const updateFilters = (newFilters: Partial<FilterOptions>) => {
        const updated = { ...filters, ...newFilters };
        setFilters(updated);
        onFilterChange(updated);
    };

    const clearFilters = () => {
        const cleared: FilterOptions = {
            dateRange: 'all',
            tags: [],
            category: undefined
        };
        setFilters(cleared);
        onFilterChange(cleared);
    };

    const hasActiveFilters =
        filters.dateRange !== 'all' ||
        filters.tags.length > 0 ||
        filters.category;

    const toggleTag = (tag: string) => {
        const newTags = filters.tags.includes(tag)
            ? filters.tags.filter(t => t !== tag)
            : [...filters.tags, tag];
        updateFilters({ tags: newTags });
    };

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`
          glass-button flex items-center gap-2 relative
          ${hasActiveFilters ? 'ring-2 ring-indigo-500/50' : ''}
        `}
            >
                <Filter className="w-4 h-4" />
                <span className="text-sm">Filtros</span>
                {hasActiveFilters && (
                    <span className="absolute -top-1 -right-1 w-3 h-3 bg-indigo-500 rounded-full" />
                )}
            </button>

            <AnimatePresence>
                {isOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsOpen(false)}
                            className="fixed inset-0 z-40"
                        />
                        <motion.div
                            initial={{ opacity: 0, y: -10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -10, scale: 0.95 }}
                            className="absolute right-0 top-12 z-50 w-80 glass-card p-4 space-y-4"
                        >
                            {/* Date Range Filter */}
                            <div>
                                <div className="flex items-center gap-2 mb-2">
                                    <Calendar className="w-4 h-4 text-indigo-400" />
                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                                        Período
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    {(['all', 'today', 'week', 'month', 'year'] as const).map(range => (
                                        <button
                                            key={range}
                                            onClick={() => updateFilters({ dateRange: range })}
                                            className={`
                        px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-tighter transition-all
                        ${filters.dateRange === range
                                                    ? 'bg-indigo-600 text-white'
                                                    : 'bg-white/5 text-gray-400 hover:bg-white/10'
                                                }
                      `}
                                        >
                                            {range === 'all' ? 'Tudo' :
                                                range === 'today' ? 'Hoje' :
                                                    range === 'week' ? 'Semana' :
                                                        range === 'month' ? 'Mês' : 'Ano'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Tags Filter */}
                            {availableTags.length > 0 && (
                                <div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <Tag className="w-4 h-4 text-purple-400" />
                                        <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                                            Tags
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {availableTags.map(tag => (
                                            <button
                                                key={tag}
                                                onClick={() => toggleTag(tag)}
                                                className={`
                          px-3 py-1 rounded-full text-xs font-medium transition-all
                          ${filters.tags.includes(tag)
                                                        ? 'bg-purple-600 text-white'
                                                        : 'bg-white/5 text-gray-400 hover:bg-white/10'
                                                    }
                        `}
                                            >
                                                {tag}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Category Filter */}
                            {availableCategories.length > 0 && (
                                <div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <FolderOpen className="w-4 h-4 text-green-400" />
                                        <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                                            Categoria
                                        </span>
                                    </div>
                                    <select
                                        value={filters.category || ''}
                                        onChange={(e) => updateFilters({ category: e.target.value || undefined })}
                                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-indigo-200 focus:ring-2 focus:ring-indigo-500"
                                    >
                                        <option value="">Todas</option>
                                        {availableCategories.map(cat => (
                                            <option key={cat} value={cat}>{cat}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Clear Filters */}
                            {hasActiveFilters && (
                                <button
                                    onClick={clearFilters}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-300 rounded-lg text-xs font-bold uppercase tracking-tighter transition-all"
                                >
                                    <X className="w-4 h-4" />
                                    Limpar Filtros
                                </button>
                            )}
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
};
