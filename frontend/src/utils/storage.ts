import { ref, deleteObject } from 'firebase/storage';
import { storage } from '../firebase';
import { ATTACHMENT_READ_ONLY_MESSAGE } from '../config/releaseGates';
import {
    fileMatchesAllowedTypes,
    maxUploadBytesForFile,
} from './fileTypes';

export interface UploadProgress {
    progress: number;
    state: 'running' | 'paused' | 'success' | 'error';
}

/** Deprecated plaintext uploader stays closed even when the encrypted pipeline is enabled. */
export const uploadFile = (
    file: File,
    userId: string,
    onProgress?: (progress: UploadProgress) => void
): Promise<string> => {
    void file; void userId;
    onProgress?.({ progress: 0, state: 'error' });
    return Promise.reject(new Error(ATTACHMENT_READ_ONLY_MESSAGE));
};

/**
 * Delete a file from Firebase Storage
 */
export const deleteFile = async (fileUrl: string): Promise<void> => {
    try {
        const fileRef = ref(storage, fileUrl);
        await deleteObject(fileRef);
    } catch (error) {
        console.error('Delete error:', error);
        throw error;
    }
};

/**
 * Compress an image before upload
 */
export const compressImage = (file: File, maxWidth = 1920, quality = 0.8): Promise<File> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);

        reader.onload = (e) => {
            const img = new Image();
            img.src = e.target?.result as string;

            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // Calculate new dimensions
                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx?.drawImage(img, 0, 0, width, height);

                canvas.toBlob(
                    (blob) => {
                        if (blob) {
                            const jpegName = /\.[^./\\]+$/.test(file.name) ? file.name.replace(/\.[^./\\]+$/, '.jpg') : `${file.name}.jpg`;
                            const compressedFile = new File([blob], jpegName, {
                                type: 'image/jpeg',
                                lastModified: Date.now()
                            });
                            resolve(compressedFile);
                        } else {
                            reject(new Error('Compression failed'));
                        }
                    },
                    'image/jpeg',
                    quality
                );
            };

            img.onerror = () => reject(new Error('Image load failed'));
        };

        reader.onerror = () => reject(new Error('File read failed'));
    });
};

/**
 * Validate file type and size
 */
export const validateFile = (
    file: File,
    allowedTypes: string[],
    maxSizeMB: number
): { valid: boolean; error?: string } => {
    if (!fileMatchesAllowedTypes(file, allowedTypes)) {
        return {
            valid: false,
            error: `Tipo de arquivo não suportado. Permitidos: ${allowedTypes.join(', ')}`
        };
    }

    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxSizeBytes) {
        return {
            valid: false,
            error: `Arquivo muito grande. Tamanho máximo: ${maxSizeMB}MB`
        };
    }

    return { valid: true };
};

export function describeUploadError(error: unknown): string {
    const code = typeof error === 'object' && error && 'code' in error
        ? String((error as { code?: string }).code)
        : '';
    const message = error instanceof Error ? error.message : '';

    if (code === 'storage/unauthenticated' || /unauthenticated/i.test(message)) {
        return 'Inicia sessão para carregar ficheiros.';
    }
    if (code === 'storage/unauthorized' || /permission|unauthorized/i.test(message)) {
        return 'O armazenamento recusou o ficheiro (tipo, extensão em maiúsculas, MIME vazio no Windows, ou tamanho). Usa PDF, Markdown, texto, Office, código, imagem, áudio ou vídeo dentro dos limites.';
    }
    if (code === 'storage/canceled') {
        return 'Upload cancelado.';
    }
    if (code === 'storage/retry-limit-exceeded') {
        return 'A ligação falhou a meio do upload. Tenta de novo.';
    }
    if (message) return message;
    return 'Falha no upload.';
}

export function assertFileFitsStorageLimits(file: File): void {
    if (file.size <= 0) {
        throw new Error(`"${file.name}" está vazio.`);
    }
    const maxBytes = maxUploadBytesForFile(file);
    if (file.size > maxBytes) {
        const maxMb = Math.round(maxBytes / (1024 * 1024));
        throw new Error(`"${file.name}" é demasiado grande. Máximo ${maxMb} MB para este tipo.`);
    }
}

/**
 * Format file size for display
 */
export const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};
