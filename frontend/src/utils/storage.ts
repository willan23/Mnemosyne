import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from '../firebase';

export interface UploadProgress {
    progress: number;
    state: 'running' | 'paused' | 'success' | 'error';
}

/**
 * Upload a file to Firebase Storage with progress tracking
 */
export const uploadFile = (
    file: File,
    userId: string,
    onProgress?: (progress: UploadProgress) => void
): Promise<string> => {
    return new Promise((resolve, reject) => {
        // Create unique filename
        const timestamp = Date.now();
        const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const filename = `${timestamp}_${sanitizedName}`;
        const storagePath = `attachments/${userId}/${filename}`;

        // Create storage reference
        const storageRef = ref(storage, storagePath);

        // Start upload
        const uploadTask = uploadBytesResumable(storageRef, file);

        // Monitor upload progress
        uploadTask.on(
            'state_changed',
            (snapshot) => {
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                onProgress?.({
                    progress,
                    state: snapshot.state as 'running' | 'paused'
                });
            },
            (error) => {
                console.error('Upload error:', error);
                onProgress?.({ progress: 0, state: 'error' });
                reject(error);
            },
            async () => {
                // Upload completed successfully
                try {
                    const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                    onProgress?.({ progress: 100, state: 'success' });
                    resolve(downloadURL);
                } catch (error) {
                    reject(error);
                }
            }
        );
    });
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
                            const compressedFile = new File([blob], file.name, {
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
    // Check file type
    const fileType = file.type;
    const isValidType = allowedTypes.some(type => {
        if (type.endsWith('/*')) {
            return fileType.startsWith(type.replace('/*', ''));
        }
        return fileType === type;
    });

    if (!isValidType) {
        return {
            valid: false,
            error: `Tipo de arquivo não suportado. Permitidos: ${allowedTypes.join(', ')}`
        };
    }

    // Check file size
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxSizeBytes) {
        return {
            valid: false,
            error: `Arquivo muito grande. Tamanho máximo: ${maxSizeMB}MB`
        };
    }

    return { valid: true };
};

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
