import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Image, Mic, X, Play, Pause, StopCircle, Trash2, Check } from 'lucide-react';
import { uploadFile, validateFile, formatFileSize, compressImage } from '../utils/storage';
import { useAudioRecorder, formatDuration } from '../hooks/useAudioRecorder';
import { auth } from '../firebase';

export interface Attachment {
    type: 'image' | 'audio';
    url: string;
    name: string;
    size?: number;
    duration?: number;
}

interface AttachmentUploaderProps {
    attachments: Attachment[];
    onChange: (attachments: Attachment[]) => void;
    maxImages?: number;
    maxAudios?: number;
}

export const AttachmentUploader: React.FC<AttachmentUploaderProps> = ({
    attachments,
    onChange,
    maxImages = 5,
    maxAudios = 3
}) => {
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [showAudioRecorder, setShowAudioRecorder] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const {
        isRecording,
        isPaused,
        duration,
        audioURL,
        startRecording,
        stopRecording,
        pauseRecording,
        resumeRecording,
        resetRecording,
        getRecording
    } = useAudioRecorder();

    const images = attachments.filter(a => a.type === 'image');
    const audios = attachments.filter(a => a.type === 'audio');

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        for (const file of files) {
            // Validate file
            const validation = validateFile(file, ['image/*'], 10);
            if (!validation.valid) {
                alert(validation.error);
                continue;
            }

            // Check limit
            if (images.length >= maxImages) {
                alert(`Máximo de ${maxImages} imagens permitidas`);
                break;
            }

            try {
                setIsUploading(true);

                // Compress image
                const compressedFile = await compressImage(file);

                // Upload to Firebase Storage
                const url = await uploadFile(
                    compressedFile,
                    auth.currentUser?.uid || 'anonymous',
                    (progress) => setUploadProgress(progress.progress)
                );

                // Add to attachments
                const newAttachment: Attachment = {
                    type: 'image',
                    url,
                    name: file.name,
                    size: compressedFile.size
                };

                onChange([...attachments, newAttachment]);
            } catch (error) {
                console.error('Upload error:', error);
                alert('Erro ao fazer upload da imagem');
            } finally {
                setIsUploading(false);
                setUploadProgress(0);
            }
        }

        // Reset input
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleSaveAudio = async () => {
        const recording = getRecording();
        if (!recording) return;

        // Check limit
        if (audios.length >= maxAudios) {
            alert(`Máximo de ${maxAudios} áudios permitidos`);
            return;
        }

        try {
            setIsUploading(true);

            // Create file from blob
            const file = new File([recording.blob], `audio_${Date.now()}.webm`, {
                type: 'audio/webm'
            });

            // Upload to Firebase Storage
            const url = await uploadFile(
                file,
                auth.currentUser?.uid || 'anonymous',
                (progress) => setUploadProgress(progress.progress)
            );

            // Add to attachments
            const newAttachment: Attachment = {
                type: 'audio',
                url,
                name: file.name,
                size: file.size,
                duration: recording.duration
            };

            onChange([...attachments, newAttachment]);
            resetRecording();
            setShowAudioRecorder(false);
        } catch (error) {
            console.error('Upload error:', error);
            alert('Erro ao fazer upload do áudio');
        } finally {
            setIsUploading(false);
            setUploadProgress(0);
        }
    };

    const removeAttachment = (index: number) => {
        const newAttachments = attachments.filter((_, i) => i !== index);
        onChange(newAttachments);
    };

    return (
        <div className="space-y-4">
            {/* Upload Buttons */}
            <div className="flex gap-3">
                <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading || images.length >= maxImages}
                    className="flex items-center gap-2 px-4 py-2 glass-button text-sm disabled:opacity-50"
                >
                    <Image className="w-4 h-4" />
                    Adicionar Imagem ({images.length}/{maxImages})
                </button>

                <button
                    onClick={() => setShowAudioRecorder(!showAudioRecorder)}
                    disabled={isUploading || audios.length >= maxAudios}
                    className="flex items-center gap-2 px-4 py-2 glass-button text-sm disabled:opacity-50"
                >
                    <Mic className="w-4 h-4" />
                    Gravar Áudio ({audios.length}/{maxAudios})
                </button>

                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileSelect}
                    className="hidden"
                />
            </div>

            {/* Upload Progress */}
            <AnimatePresence>
                {isUploading && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="glass-card p-3"
                    >
                        <div className="flex items-center gap-3">
                            <Upload className="w-4 h-4 text-indigo-400 animate-pulse" />
                            <div className="flex-1">
                                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-indigo-500 transition-all duration-300"
                                        style={{ width: `${uploadProgress}%` }}
                                    />
                                </div>
                            </div>
                            <span className="text-xs text-gray-400">{Math.round(uploadProgress)}%</span>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Audio Recorder */}
            <AnimatePresence>
                {showAudioRecorder && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="glass-card p-4 space-y-3"
                    >
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className={`w-3 h-3 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-gray-500'}`} />
                                <span className="text-sm font-mono">{formatDuration(duration)}</span>
                            </div>
                            <button
                                onClick={() => {
                                    resetRecording();
                                    setShowAudioRecorder(false);
                                }}
                                className="p-1 hover:bg-white/10 rounded-full transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {audioURL && (
                            <audio src={audioURL} controls className="w-full" />
                        )}

                        <div className="flex gap-2">
                            {!isRecording && !audioURL && (
                                <button
                                    onClick={startRecording}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-bold transition-all"
                                >
                                    <Mic className="w-4 h-4" />
                                    Iniciar Gravação
                                </button>
                            )}

                            {isRecording && (
                                <>
                                    {!isPaused ? (
                                        <button
                                            onClick={pauseRecording}
                                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-500 rounded-lg text-sm font-bold transition-all"
                                        >
                                            <Pause className="w-4 h-4" />
                                            Pausar
                                        </button>
                                    ) : (
                                        <button
                                            onClick={resumeRecording}
                                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-bold transition-all"
                                        >
                                            <Play className="w-4 h-4" />
                                            Continuar
                                        </button>
                                    )}
                                    <button
                                        onClick={stopRecording}
                                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-bold transition-all"
                                    >
                                        <StopCircle className="w-4 h-4" />
                                        Parar
                                    </button>
                                </>
                            )}

                            {audioURL && !isRecording && (
                                <>
                                    <button
                                        onClick={resetRecording}
                                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-sm font-bold transition-all"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                        Descartar
                                    </button>
                                    <button
                                        onClick={handleSaveAudio}
                                        disabled={isUploading}
                                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm font-bold transition-all"
                                    >
                                        <Check className="w-4 h-4" />
                                        Salvar Áudio
                                    </button>
                                </>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Attachments List */}
            {attachments.length > 0 && (
                <div className="space-y-2">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Anexos</h4>
                    <div className="grid grid-cols-2 gap-3">
                        {attachments.map((attachment, index) => (
                            <motion.div
                                key={index}
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                                className="glass-card p-3 relative group"
                            >
                                {attachment.type === 'image' ? (
                                    <img
                                        src={attachment.url}
                                        alt={attachment.name}
                                        className="w-full h-32 object-cover rounded-lg mb-2"
                                    />
                                ) : (
                                    <div className="w-full h-32 flex flex-col items-center justify-center bg-white/5 rounded-lg mb-2">
                                        <Mic className="w-8 h-8 text-indigo-400 mb-2" />
                                        <audio src={attachment.url} controls className="w-full px-2" />
                                    </div>
                                )}

                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-gray-400 truncate flex-1">
                                        {attachment.name}
                                    </span>
                                    {attachment.size && (
                                        <span className="text-gray-500 ml-2">
                                            {formatFileSize(attachment.size)}
                                        </span>
                                    )}
                                </div>

                                {attachment.duration && (
                                    <div className="text-xs text-gray-500 mt-1">
                                        {formatDuration(attachment.duration)}
                                    </div>
                                )}

                                <button
                                    onClick={() => removeAttachment(index)}
                                    className="absolute top-2 right-2 p-1 bg-red-600/80 hover:bg-red-600 rounded-full opacity-0 group-hover:opacity-100 transition-all"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </motion.div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
