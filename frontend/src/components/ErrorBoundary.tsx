import { Component, type ErrorInfo, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

/**
 * Error Boundary Component
 * Catches JavaScript errors anywhere in the child component tree
 */
export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
        errorInfo: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error, errorInfo: null };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Error Boundary caught an error:', error, errorInfo);

        this.setState({
            error,
            errorInfo
        });

        // TODO: Send to error tracking service (Sentry, LogRocket, etc.)
        // logErrorToService(error, errorInfo);
    }

    private handleReset = () => {
        this.setState({
            hasError: false,
            error: null,
            errorInfo: null
        });
    };

    private handleGoHome = () => {
        window.location.href = '/';
    };

    public render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen bg-[#0a0a0a] text-[#ededed] flex items-center justify-center p-8">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="max-w-2xl w-full"
                    >
                        <div className="glass-card p-8 text-center">
                            {/* Icon */}
                            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-500/20 flex items-center justify-center">
                                <AlertTriangle className="w-10 h-10 text-red-400" />
                            </div>

                            {/* Title */}
                            <h1 className="text-3xl font-bold mb-4 glow-text">
                                Algo deu errado
                            </h1>

                            {/* Description */}
                            <p className="text-gray-400 mb-8">
                                Desculpe, ocorreu um erro inesperado. Tente recarregar a página ou voltar para a página inicial.
                            </p>

                            {/* Error Details (only in development) */}
                            {import.meta.env.DEV && this.state.error && (
                                <div className="mb-8 text-left">
                                    <details className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                                        <summary className="cursor-pointer text-sm font-bold text-red-400 mb-2">
                                            Detalhes do Erro (Dev Only)
                                        </summary>
                                        <div className="text-xs text-red-300 font-mono overflow-auto max-h-60">
                                            <p className="mb-2">
                                                <strong>Error:</strong> {this.state.error.toString()}
                                            </p>
                                            {this.state.errorInfo && (
                                                <pre className="whitespace-pre-wrap">
                                                    {this.state.errorInfo.componentStack}
                                                </pre>
                                            )}
                                        </div>
                                    </details>
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex gap-4 justify-center">
                                <button
                                    onClick={this.handleReset}
                                    className="glass-button flex items-center gap-2"
                                >
                                    <RefreshCw className="w-4 h-4" />
                                    Tentar Novamente
                                </button>
                                <button
                                    onClick={this.handleGoHome}
                                    className="glass-button flex items-center gap-2 bg-indigo-600/20 border-indigo-500/30"
                                >
                                    <Home className="w-4 h-4" />
                                    Página Inicial
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </div>
            );
        }

        return this.props.children;
    }
}
