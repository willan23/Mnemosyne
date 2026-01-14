import { describe, it, expect } from 'vitest';

/**
 * Utility function to format dates
 */
export function formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleDateString('pt-PT', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

/**
 * Utility function to format relative time
 */
export function formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 7) {
        return formatDate(timestamp);
    } else if (days > 0) {
        return `há ${days} dia${days > 1 ? 's' : ''}`;
    } else if (hours > 0) {
        return `há ${hours} hora${hours > 1 ? 's' : ''}`;
    } else if (minutes > 0) {
        return `há ${minutes} minuto${minutes > 1 ? 's' : ''}`;
    } else {
        return 'agora mesmo';
    }
}

/**
 * Utility function to truncate text
 */
export function truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

/**
 * Utility function to count words
 */
export function countWords(text: string): number {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

// Tests
describe('formatDate', () => {
    it('should format timestamp to Portuguese date', () => {
        const timestamp = new Date('2025-12-25').getTime();
        const result = formatDate(timestamp);
        expect(result).toContain('dez');
        expect(result).toContain('2025');
    });
});

describe('formatRelativeTime', () => {
    it('should return "agora mesmo" for recent timestamps', () => {
        const now = Date.now();
        expect(formatRelativeTime(now)).toBe('agora mesmo');
    });

    it('should return minutes for timestamps within an hour', () => {
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        expect(formatRelativeTime(fiveMinutesAgo)).toBe('há 5 minutos');
    });

    it('should return hours for timestamps within a day', () => {
        const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
        expect(formatRelativeTime(twoHoursAgo)).toBe('há 2 horas');
    });
});

describe('truncateText', () => {
    it('should not truncate text shorter than maxLength', () => {
        expect(truncateText('Hello', 10)).toBe('Hello');
    });

    it('should truncate text longer than maxLength', () => {
        expect(truncateText('Hello World', 5)).toBe('Hello...');
    });
});

describe('countWords', () => {
    it('should count words correctly', () => {
        expect(countWords('Hello world')).toBe(2);
        expect(countWords('  Multiple   spaces  ')).toBe(2);
        expect(countWords('')).toBe(0);
    });
});
