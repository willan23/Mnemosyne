/**
 * Export utilities for downloading memories in various formats
 */

export type ExportFormat = 'txt' | 'md' | 'json';

interface Memory {
    id: string;
    text: string;
    tags?: string[];
    category?: string;
    timestamp: number;
    nodes?: any[];
    links?: any[];
}

/**
 * Format memory as plain text
 */
function formatAsTxt(memory: Memory): string {
    const date = new Date(memory.timestamp).toLocaleString('pt-PT');
    let content = `MEMÓRIA\n`;
    content += `Data: ${date}\n`;
    if (memory.category) content += `Categoria: ${memory.category}\n`;
    if (memory.tags && memory.tags.length > 0) {
        content += `Tags: ${memory.tags.join(', ')}\n`;
    }
    content += `\n${'-'.repeat(50)}\n\n`;
    content += memory.text;
    content += `\n\n${'-'.repeat(50)}\n`;
    if (memory.nodes && memory.nodes.length > 0) {
        content += `\nNós do Grafo: ${memory.nodes.map(n => n.name).join(', ')}\n`;
    }
    return content;
}

/**
 * Format memory as Markdown
 */
function formatAsMarkdown(memory: Memory): string {
    const date = new Date(memory.timestamp).toLocaleString('pt-PT');
    let content = `# Memória\n\n`;
    content += `**Data**: ${date}\n\n`;
    if (memory.category) content += `**Categoria**: ${memory.category}\n\n`;
    if (memory.tags && memory.tags.length > 0) {
        content += `**Tags**: ${memory.tags.map(t => `\`${t}\``).join(', ')}\n\n`;
    }
    content += `---\n\n`;
    content += memory.text;
    content += `\n\n---\n\n`;
    if (memory.nodes && memory.nodes.length > 0) {
        content += `## Grafo de Conhecimento\n\n`;
        content += `**Nós**: ${memory.nodes.map(n => n.name).join(', ')}\n\n`;
        if (memory.links && memory.links.length > 0) {
            content += `**Conexões**:\n`;
            memory.links.forEach(link => {
                const source = memory.nodes?.find(n => n.id === link.source)?.name || link.source;
                const target = memory.nodes?.find(n => n.id === link.target)?.name || link.target;
                content += `- ${source} → ${target}\n`;
            });
        }
    }
    return content;
}

/**
 * Format memory as JSON
 */
function formatAsJson(memory: Memory): string {
    return JSON.stringify(memory, null, 2);
}

/**
 * Get MIME type for format
 */
function getMimeType(format: ExportFormat): string {
    switch (format) {
        case 'txt':
            return 'text/plain';
        case 'md':
            return 'text/markdown';
        case 'json':
            return 'application/json';
    }
}

/**
 * Get file extension for format
 */
function getExtension(format: ExportFormat): string {
    return format;
}

/**
 * Download a single memory
 */
export function downloadMemory(memory: Memory, format: ExportFormat = 'txt'): void {
    let content: string;

    switch (format) {
        case 'txt':
            content = formatAsTxt(memory);
            break;
        case 'md':
            content = formatAsMarkdown(memory);
            break;
        case 'json':
            content = formatAsJson(memory);
            break;
    }

    const blob = new Blob([content], { type: getMimeType(format) });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    // Generate filename
    const date = new Date(memory.timestamp).toISOString().split('T')[0];
    const sanitizedText = memory.text.slice(0, 30).replace(/[^a-z0-9]/gi, '_').toLowerCase();
    a.download = `memoria_${date}_${sanitizedText}.${getExtension(format)}`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Download multiple memories as individual files.
 */
export async function downloadMultipleMemories(
    memories: Memory[],
    format: ExportFormat = 'md'
): Promise<void> {
    memories.forEach((memory, index) => {
        setTimeout(() => {
            downloadMemory(memory, format);
        }, index * 100); // Stagger downloads
    });
}

/**
 * Export all memories for a user
 */
export async function exportAllMemories(
    memories: Memory[],
    format: ExportFormat = 'json'
): Promise<void> {
    if (format === 'json') {
        // Export as single JSON file
        const data = {
            exportDate: new Date().toISOString(),
            version: '1.0',
            totalMemories: memories.length,
            memories: memories
        };

        const content = JSON.stringify(data, null, 2);
        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mnemosyne_export_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } else {
        // Export each memory individually
        await downloadMultipleMemories(memories, format);
    }
}
