import { describe, it, expect } from 'vitest';
import { formatMemoryContent } from './export';

describe('export formatters', () => {
    const mockMemory = {
        id: 'mem-123',
        text: 'Esta é uma memória de teste com conteúdo rico.',
        title: 'Memória Alfa',
        tags: ['projeto', 'ia'],
        category: 'Trabalho',
        timestamp: new Date('2026-05-15T14:30:00Z').getTime(),
        nodes: [
            { id: 'node-1', name: 'Mnemosyne' },
            { id: 'node-2', name: 'Arquitetura' },
        ],
        links: [
            { source: 'node-1', target: 'node-2' },
        ],
    };

    it('should format memory as plain text correctly', () => {
        const text = formatMemoryContent(mockMemory, 'txt');
        expect(text.startsWith('MEMÓRIA — Memória Alfa\n')).toBe(true);
        expect(text).toContain('Categoria: Trabalho');
        expect(text).toContain('Tags: projeto, ia');
        expect(text).toContain('Esta é uma memória de teste com conteúdo rico.');
        expect(text).toContain('Nós do Grafo: Mnemosyne, Arquitetura');
    });

    it('should format memory as Markdown correctly', () => {
        const md = formatMemoryContent(mockMemory, 'md');
        expect(md).toContain('# Memória');
        expect(md).toContain('**Categoria**: Trabalho');
        expect(md).toContain('`projeto`');
        expect(md).toContain('## Grafo de Conhecimento');
        expect(md).toContain('- Mnemosyne → Arquitetura');
    });

    it('should format memory as JSON correctly', () => {
        const jsonStr = formatMemoryContent(mockMemory, 'json');
        const parsed = JSON.parse(jsonStr);
        expect(parsed.id).toBe('mem-123');
        expect(parsed.text).toBe('Esta é uma memória de teste com conteúdo rico.');
        expect(parsed.tags).toEqual(['projeto', 'ia']);
    });
});
