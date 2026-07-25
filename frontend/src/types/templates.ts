/**
 * Tipos para o sistema de Templates Inteligentes
 */

export type TemplateBlockType =
    | 'heading'
    | 'text'
    | 'prompt'
    | 'checklist'
    | 'tags'
    | 'divider'
    | 'category';

export interface TemplateBlock {
    type: TemplateBlockType;
    content?: string;
    placeholder?: string;
    required?: boolean;
    defaultValue?: string;
}

export type TemplateCategory =
    | 'productivity'
    | 'learning'
    | 'personal'
    | 'work'
    | 'creative';

export interface Template {
    id: string;
    name: string;
    description: string;
    icon: string;
    category: TemplateCategory;
    blocks: TemplateBlock[];
    defaultTags?: string[];
    defaultCategory?: string;
    usageCount?: number; // Para analytics
    lastUsed?: number; // Timestamp
}

export interface TemplateUsageStats {
    templateId: string;
    count: number;
    lastUsed: number;
    avgCompletionTime?: number;
}
