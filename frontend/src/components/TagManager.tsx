import React, { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface TagManagerProps {
    tags: string[];
    onChange: (tags: string[]) => void;
    suggestions?: string[];
}

const TAG_COLORS = [
    'bg-indigo-600',
    'bg-purple-600',
    'bg-pink-600',
    'bg-blue-600',
    'bg-green-600',
    'bg-yellow-600',
    'bg-red-600',
    'bg-orange-600'
];

const getTagColor = (tag: string): string => {
    const hash = tag.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return TAG_COLORS[hash % TAG_COLORS.length];
};

export const TagManager: React.FC<TagManagerProps> = ({
    tags,
    onChange,
    suggestions = []
}) => {
    const [inputValue, setInputValue] = useState('');
    const [showSuggestions, setShowSuggestions] = useState(false);

    const addTag = (tag: string) => {
        const trimmed = tag.trim().toLowerCase();
        if (trimmed && !tags.includes(trimmed)) {
            onChange([...tags, trimmed]);
        }
        setInputValue('');
        setShowSuggestions(false);
    };

    const removeTag = (tagToRemove: string) => {
        onChange(tags.filter(t => t !== tagToRemove));
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addTag(inputValue);
        }
    };

    const filteredSuggestions = suggestions.filter(
        s => !tags.includes(s) && s.toLowerCase().includes(inputValue.toLowerCase())
    );

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
                <AnimatePresence>
                    {tags.map(tag => (
                        <motion.div
                            key={tag}
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.8, opacity: 0 }}
                            className={`
                ${getTagColor(tag)} px-3 py-1 rounded-full flex items-center gap-2 text-xs font-medium text-white
              `}
                        >
                            <span>{tag}</span>
                            <button
                                onClick={() => removeTag(tag)}
                                className="hover:bg-white/20 rounded-full p-0.5 transition-colors"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </motion.div>
                    ))}
                </AnimatePresence>

                <div className="relative">
                    <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-full px-3 py-1">
                        <Plus className="w-3 h-3 text-gray-400" />
                        <input
                            type="text"
                            value={inputValue}
                            onChange={(e) => {
                                setInputValue(e.target.value);
                                setShowSuggestions(true);
                            }}
                            onKeyDown={handleKeyDown}
                            onFocus={() => setShowSuggestions(true)}
                            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                            placeholder="Adicionar tag..."
                            className="bg-transparent border-none outline-none text-xs w-24 placeholder-gray-600 focus:ring-0"
                        />
                    </div>

                    {/* Suggestions Dropdown */}
                    <AnimatePresence>
                        {showSuggestions && filteredSuggestions.length > 0 && (
                            <motion.div
                                initial={{ opacity: 0, y: -5 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -5 }}
                                className="absolute top-full mt-1 left-0 w-48 glass-card p-2 space-y-1 z-10"
                            >
                                {filteredSuggestions.slice(0, 5).map(suggestion => (
                                    <button
                                        key={suggestion}
                                        onClick={() => addTag(suggestion)}
                                        className="w-full text-left px-3 py-1 rounded text-xs text-gray-300 hover:bg-white/10 transition-colors"
                                    >
                                        {suggestion}
                                    </button>
                                ))}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
};
