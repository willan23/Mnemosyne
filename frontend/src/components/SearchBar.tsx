import React, { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface SearchBarProps {
    onSearch: (query: string) => void;
    placeholder?: string;
}

export const SearchBar: React.FC<SearchBarProps> = ({
    onSearch,
    placeholder = "Buscar memórias..."
}) => {
    const [query, setQuery] = useState('');
    const [isFocused, setIsFocused] = useState(false);

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            onSearch(query);
        }, 300);

        return () => clearTimeout(timer);
    }, [query, onSearch]);

    const handleClear = () => {
        setQuery('');
        onSearch('');
    };

    return (
        <div className="relative w-full max-w-md">
            <div className={`
        glass-card flex items-center gap-3 px-4 py-2 transition-all
        ${isFocused ? 'ring-2 ring-indigo-500/50' : ''}
      `}>
                <Search className="w-5 h-5 text-gray-400" />
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    placeholder={placeholder}
                    className="flex-1 bg-transparent border-none outline-none text-sm placeholder-gray-600 focus:ring-0"
                />
                <AnimatePresence>
                    {query && (
                        <motion.button
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            onClick={handleClear}
                            className="p-1 hover:bg-white/10 rounded-full transition-colors"
                        >
                            <X className="w-4 h-4 text-gray-400" />
                        </motion.button>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};
