/**
 * Export utilities for downloading memories in various formats
 */

export type ExportFormat = 'txt' | 'md' | 'json' | 'html' | 'docx';

interface Memory {
    id: string;
    text: string;
    title?: string;
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
    const heading = memory.title ? `MEMÓRIA — ${memory.title}` : 'MEMÓRIA';
    let content = `${heading}\n`;
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
    const heading = memory.title || 'Memória';
    let content = `# ${heading}\n\n`;
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

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/** HTML printável (abre no browser → Guardar como PDF) e base para .doc Word. */
function formatAsHtmlDocument(memory: Memory): string {
    const date = escapeHtml(new Date(memory.timestamp).toLocaleDateString('pt-PT'));
    const title = escapeHtml(memory.title || 'Memória Mnemosyne');
    const safeBody = escapeHtml(memory.text || '').replace(/\n/g, '<br/>');
    const safeTags = memory.tags?.length
        ? `<div class="tags">${memory.tags.map((t) => escapeHtml(t)).join(' · ')}</div>`
        : '';

    return `<!DOCTYPE html><html><head>
<meta charset="UTF-8"/>
<title>${title} - Mnemosyne</title>
<style>
body { font-family: Georgia, serif; max-width: 700px; margin: 60px auto; color: #1a1a2e; line-height: 1.8; padding: 0 20px; }
h1 { font-size: 28px; border-bottom: 2px solid #8b5cf6; padding-bottom: 12px; }
.meta { color: #666; font-size: 13px; margin-bottom: 24px; }
.body { font-size: 16px; word-break: break-word; }
.tags { margin-top: 24px; font-size: 12px; color: #888; }
@media print { body { margin: 24px; } }
</style></head><body>
<h1>${title}</h1>
<div class="meta">${date}</div>
<div class="body">${safeBody}</div>
${safeTags}
</body></html>`;
}

/**
 * Get MIME type for format
 */
function getMimeType(format: ExportFormat): string {
    switch (format) {
        case 'txt':
            return 'text/plain;charset=utf-8';
        case 'md':
            return 'text/markdown;charset=utf-8';
        case 'json':
            return 'application/json;charset=utf-8';
        case 'html':
            return 'text/html;charset=utf-8';
        case 'docx':
            // HTML that Microsoft Word abre como documento
            return 'application/msword;charset=utf-8';
    }
}

/**
 * Get file extension for format
 */
function getExtension(format: ExportFormat): string {
    switch (format) {
        case 'docx':
            return 'doc';
        case 'html':
            return 'html';
        default:
            return format;
    }
}

/**
 * Format single memory content by requested format
 */
export function formatMemoryContent(memory: Memory, format: ExportFormat): string {
    switch (format) {
        case 'txt':
            return formatAsTxt(memory);
        case 'md':
            return formatAsMarkdown(memory);
        case 'json':
            return formatAsJson(memory);
        case 'html':
        case 'docx':
            return formatAsHtmlDocument(memory);
    }
}

function buildDownloadName(memory: Memory, format: ExportFormat): string {
    const date = new Date(memory.timestamp).toISOString().split('T')[0];
    const base = (memory.title || memory.text || 'memoria')
        .slice(0, 40)
        .replace(/[^a-z0-9]+/gi, '_')
        .replace(/^_|_$/g, '')
        .toLowerCase() || 'memoria';
    return `memoria_${date}_${base}.${getExtension(format)}`;
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

/**
 * Download a single memory
 */
export function downloadMemory(memory: Memory, format: ExportFormat = 'txt'): void {
    const content = formatMemoryContent(memory, format);
    const blob = new Blob([content], { type: getMimeType(format) });
    triggerBlobDownload(blob, buildDownloadName(memory, format));
}

/**
 * Download multiple memories packaged in a single ZIP file
 */
export async function downloadMultipleMemories(
    memories: Memory[],
    format: ExportFormat = 'md'
): Promise<void> {
    if (memories.length === 0) return;

    if (memories.length === 1) {
        downloadMemory(memories[0], format);
        return;
    }

    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    const dateStr = new Date().toISOString().split('T')[0];

    memories.forEach((memory, index) => {
        const filename = `${String(index + 1).padStart(3, '0')}_${buildDownloadName(memory, format)}`;
        const content = formatMemoryContent(memory, format);
        zip.file(filename, content);
    });

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    triggerBlobDownload(zipBlob, `mnemosyne_memories_${dateStr}.zip`);
}

/**
 * Export all memories for a user
 */
export async function exportAllMemories(
    memories: Memory[],
    format: ExportFormat = 'json'
): Promise<void> {
    if (format === 'json') {
        const data = {
            exportDate: new Date().toISOString(),
            version: '1.0',
            totalMemories: memories.length,
            memories: memories
        };

        const content = JSON.stringify(data, null, 2);
        const blob = new Blob([content], { type: 'application/json' });
        triggerBlobDownload(blob, `mnemosyne_export_${new Date().toISOString().split('T')[0]}.json`);
    } else {
        await downloadMultipleMemories(memories, format);
    }
}

/** Descarrega um anexo (Firebase URL cross-origin) via blob — o atributo download sozinho falha. */
export async function downloadAttachmentFile(
    url: string,
    filename: string,
    options: { guard?: () => boolean } = {},
): Promise<void> {
    const guard = () => { if (options.guard && !options.guard()) throw new Error('Não foi possível descarregar o anexo.'); };
    guard();
    if (!url) throw new Error('URL do anexo em falta.');
    if (url.startsWith('blob:') || url.startsWith('data:')) {
        const blob = await (await fetch(url)).blob();
        guard(); triggerBlobDownload(blob, filename || 'anexo');
        return;
    }
    const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error' });
    if (!response.ok) {
        throw new Error(`Não foi possível descarregar o ficheiro (${response.status}).`);
    }
    const blob = await response.blob();
    guard();
    const safeName = (filename || 'anexo').replace(/[/\\?%*:|"<>]/g, '_');
    triggerBlobDownload(blob, safeName);
}
