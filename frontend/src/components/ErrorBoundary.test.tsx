import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

// Component that throws an error
const ThrowError = ({ shouldThrow }: { shouldThrow: boolean }) => {
    if (shouldThrow) {
        throw new Error('Test error');
    }
    return <div>No error</div>;
};

describe('ErrorBoundary', () => {
    it('should render children when there is no error', () => {
        render(
            <ErrorBoundary>
                <ThrowError shouldThrow={false} />
            </ErrorBoundary>
        );

        expect(screen.getByText('No error')).toBeInTheDocument();
    });

    it('should render error UI when child throws', () => {
        // Suppress console.error for this test
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

        render(
            <ErrorBoundary>
                <ThrowError shouldThrow={true} />
            </ErrorBoundary>
        );

        expect(screen.getByText('Algo deu errado')).toBeInTheDocument();
        expect(screen.getByText(/Desculpe, ocorreu um erro inesperado/)).toBeInTheDocument();

        consoleSpy.mockRestore();
    });

    it('should show error details in development mode', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

        render(
            <ErrorBoundary>
                <ThrowError shouldThrow={true} />
            </ErrorBoundary>
        );

        // In Vite dev mode, import.meta.env.DEV is true
        if (import.meta.env.DEV) {
            expect(screen.getByText(/Detalhes do Erro/)).toBeInTheDocument();
        }

        consoleSpy.mockRestore();
    });
});
