import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Image, Mic, X, Play, Pause, StopCircle, Trash2, Check, FileText, Film } from 'lucide-react';
import { validateFile, formatFileSize, compressImage, describeUploadError } from '../utils/storage';
import { uploadEncryptedAttachment } from '../services/attachmentUploadClient';
import { useAudioRecorder, formatDuration } from '../hooks/useAudioRecorder';
import { auth } from '../firebase';
import { useSubscription } from '../hooks/useSubscription';
import { getEffectivePlanLimits } from '../config/planLimits';
import { isFreeFirstMode } from '../config/monetization';
import { FAIR_USE } from '../config/fairUse';
import { useNavigate } from 'react-router-dom';
import { DOCUMENT_FILE_ACCEPT_NO_MEDIA } from '../utils/fileTypes';
import type { Attachment } from '../types/attachments';
import { ATTACHMENT_READ_ONLY_MESSAGE, ATTACHMENT_WRITES_ENABLED } from '../config/releaseGates';

export type { Attachment };

interface AttachmentUploaderProps {
    attachments: Attachment[];
    onChange: (attachments: Attachment[]) => void;
    maxImages?: number;
    maxAudios?: number;
    maxDocuments?: number;
    maxVideos?: number;
    teamId?: string;
}

export const AttachmentUploader: React.FC<AttachmentUploaderProps> = ({
    attachments,
    onChange,
    maxImages = 5,
    maxAudios = 3,
    maxDocuments = 12,
    maxVideos = 3,
    teamId,
}) => {
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [showAudioRecorder, setShowAudioRecorder] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const documentInputRef = useRef<HTMLInputElement>(null);
    const videoInputRef = useRef<HTMLInputElement>(null);
    const navigate = useNavigate();
    const { tier } = useSubscription();
    const planLimits = getEffectivePlanLimits(tier);
    const canUploadImages = ATTACHMENT_WRITES_ENABLED && planLimits.attachments.images.enabled;
    const canUploadAudio = ATTACHMENT_WRITES_ENABLED && planLimits.attachments.audio.enabled;
    const canUploadDocuments = ATTACHMENT_WRITES_ENABLED && planLimits.attachments.pdfs.enabled;
    const canUploadVideos = ATTACHMENT_WRITES_ENABLED && planLimits.attachments.images.enabled;
    const effectiveMaxImages = canUploadImages ? maxImages : 0;
    const effectiveMaxAudios = canUploadAudio ? maxAudios : 0;
    const effectiveMaxDocuments = canUploadDocuments ? maxDocuments : 0;
    const effectiveMaxVideos = canUploadVideos ? maxVideos : 0;

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
    const documents = attachments.filter(a => a.type === 'document');
    const videos = attachments.filter(a => a.type === 'video');

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        if (!canUploadImages) {
            alert(isFreeFirstMode
                ? 'Upload de imagem temporariamente indisponível por limite técnico.'
                : 'Anexos de imagem exigem plano Pro ou Sovereign.');
            if (!isFreeFirstMode) navigate('/pricing');
            return;
        }

        for (const file of files) {
            // Validate file
            const validation = validateFile(file, ['image/*'], FAIR_USE.maxAttachmentMB);
            if (!validation.valid) {
                alert(validation.error);
                continue;
            }

            // Check limit
            if (images.length >= effectiveMaxImages) {
                alert(`Máximo de ${effectiveMaxImages} imagens permitidas`);
                break;
            }

            try {
                setIsUploading(true);

                // Compress image
                const compressedFile = await compressImage(file);

                const newAttachment = await uploadEncryptedAttachment(
                    { file: compressedFile, uid: auth.currentUser?.uid || '', teamId },
                    (progress) => setUploadProgress(progress.progress)
                );

                onChange([...attachments, newAttachment]);
            } catch {
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

    const handleDocumentSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        if (!canUploadDocuments) {
            alert(isFreeFirstMode
                ? 'Upload de documentos temporariamente indisponível por limite técnico.'
                : 'Documentos exigem plano Sovereign.');
            if (!isFreeFirstMode) navigate('/pricing');
            return;
        }

        let nextAttachments = [...attachments];
        let currentDocuments = documents.length;
        const allowedExtensions = /\.(pdf|txt|md|markdown|csv|json|doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|rtf|pages|key|numbers|py|js|jsx|ts|tsx|rs|go|java|html|htm|xml|yaml|yml|css|sql|log|mdx)$/i;

        for (const file of files.slice(0, maxDocuments)) {
            if (currentDocuments >= effectiveMaxDocuments) {
                alert(`Máximo de ${effectiveMaxDocuments} documentos permitidos`);
                break;
            }

            if (!allowedExtensions.test(file.name) && !file.type.startsWith('text/') && file.type !== 'application/pdf') {
                alert(`Tipo de documento não suportado: ${file.name}`);
                continue;
            }
            if (file.size > FAIR_USE.maxAttachmentMB * 1024 * 1024) {
                alert(`"${file.name}" é demasiado grande. Tamanho máximo: ${FAIR_USE.maxAttachmentMB}MB (fair-use).`);
                continue;
            }

            try {
                setIsUploading(true);
                const attachment = await uploadEncryptedAttachment(
                    { file, uid: auth.currentUser?.uid || '', teamId },
                    (progress) => setUploadProgress(progress.progress)
                );
                nextAttachments = [...nextAttachments, attachment];
                currentDocuments += 1;
                onChange(nextAttachments);
            } catch (error) {
                alert(`Erro ao fazer upload de "${file.name}": ${describeUploadError(error)}`);
            } finally {
                setIsUploading(false);
                setUploadProgress(0);
            }
        }

        if (documentInputRef.current) {
            documentInputRef.current.value = '';
        }
    };

    const handleVideoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        if (!canUploadVideos) {
            alert(isFreeFirstMode
                ? 'Upload de vídeo temporariamente indisponível por limite técnico.'
                : 'Vídeo exige anexos ativos no plano.');
            if (!isFreeFirstMode) navigate('/pricing');
            return;
        }

        let nextAttachments = [...attachments];
        let currentVideos = videos.length;

        for (const file of files.slice(0, maxVideos)) {
            if (currentVideos >= effectiveMaxVideos) {
                alert(`Máximo de ${effectiveMaxVideos} vídeos permitidos`);
                break;
            }

            const validation = validateFile(file, ['video/*'], 200);
            if (!validation.valid) {
                alert(validation.error);
                continue;
            }

            try {
                setIsUploading(true);
                const attachment = await uploadEncryptedAttachment(
                    { file, uid: auth.currentUser?.uid || '', teamId },
                    (progress) => setUploadProgress(progress.progress)
                );
                nextAttachments = [...nextAttachments, attachment];
                currentVideos += 1;
                onChange(nextAttachments);
            } catch {
                alert(`Erro ao fazer upload de "${file.name}"`);
            } finally {
                setIsUploading(false);
                setUploadProgress(0);
            }
        }

        if (videoInputRef.current) {
            videoInputRef.current.value = '';
        }
    };

    const handleSaveAudio = async () => {
        const recording = getRecording();
        if (!recording) return;
        if (!canUploadAudio) {
            alert(isFreeFirstMode
                ? 'Gravação de áudio temporariamente indisponível por limite técnico.'
                : 'Gravação de áudio exige plano Pro ou Sovereign.');
            if (!isFreeFirstMode) navigate('/pricing');
            return;
        }

        // Check limit
        if (audios.length >= effectiveMaxAudios) {
            alert(`Máximo de ${effectiveMaxAudios} áudios permitidos`);
            return;
        }

        try {
            setIsUploading(true);

            // Create file from blob
            const file = new File([recording.blob], `audio_${Date.now()}.webm`, {
                type: 'audio/webm'
            });

            const newAttachment = await uploadEncryptedAttachment(
                { file, uid: auth.currentUser?.uid || '', teamId },
                (progress) => setUploadProgress(progress.progress)
            );

            onChange([...attachments, newAttachment]);
            resetRecording();
            setShowAudioRecorder(false);
        } catch {
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
            <p className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs leading-relaxed text-amber-100" role="note">
                {ATTACHMENT_READ_ONLY_MESSAGE}
            </p>
            {/* Upload Buttons */}
            <div className="flex flex-wrap gap-3">
                <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading || !canUploadImages || images.length >= effectiveMaxImages}
                    className="flex items-center gap-2 px-4 py-2 glass-button text-sm disabled:opacity-50"
                >
                    <Image className="w-4 h-4" />
                    Adicionar Imagem ({images.length}/{effectiveMaxImages})
                </button>

                <button
                    onClick={() => setShowAudioRecorder(!showAudioRecorder)}
                    disabled={isUploading || !canUploadAudio || audios.length >= effectiveMaxAudios}
                    className="flex items-center gap-2 px-4 py-2 glass-button text-sm disabled:opacity-50"
                >
                    <Mic className="w-4 h-4" />
                    Gravar Áudio ({audios.length}/{effectiveMaxAudios})
                </button>

                <button
                    onClick={() => documentInputRef.current?.click()}
                    disabled={isUploading || !canUploadDocuments || documents.length >= effectiveMaxDocuments}
                    className="flex items-center gap-2 px-4 py-2 glass-button text-sm disabled:opacity-50"
                >
                    <FileText className="w-4 h-4" />
                    Documento ({documents.length}/{effectiveMaxDocuments})
                </button>

                <button
                    onClick={() => videoInputRef.current?.click()}
                    disabled={isUploading || !canUploadVideos || videos.length >= effectiveMaxVideos}
                    className="flex items-center gap-2 px-4 py-2 glass-button text-sm disabled:opacity-50"
                >
                    <Film className="w-4 h-4" />
                    Vídeo ({videos.length}/{effectiveMaxVideos})
                </button>

                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileSelect}
                    className="hidden"
                />
                <input
                    ref={documentInputRef}
                    type="file"
                    accept={DOCUMENT_FILE_ACCEPT_NO_MEDIA}
                    multiple
                    onChange={handleDocumentSelect}
                    className="hidden"
                />
                <input
                    ref={videoInputRef}
                    type="file"
                    accept="video/*"
                    multiple
                    onChange={handleVideoSelect}
                    className="hidden"
                />
            </div>
            {(!canUploadImages || !canUploadAudio || !canUploadDocuments) && (
                <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-xs text-indigo-200">
                    {isFreeFirstMode
                        ? 'Alguns anexos podem ser limitados por fair-use enquanto a infraestrutura estabiliza.'
                        : 'Anexos estão bloqueados no plano Free. Faz upgrade para ativar imagens e áudio.'}
                </div>
            )}

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
                                ) : attachment.type === 'audio' ? (
                                    <div className="w-full h-32 flex flex-col items-center justify-center bg-white/5 rounded-lg mb-2">
                                        <Mic className="w-8 h-8 text-indigo-400 mb-2" />
                                        <audio src={attachment.url} controls className="w-full px-2" />
                                    </div>
                                ) : attachment.type === 'video' ? (
                                    <div className="w-full h-32 overflow-hidden rounded-lg bg-white/5 mb-2">
                                        <video src={attachment.url} controls className="h-full w-full object-cover" />
                                    </div>
                                ) : (
                                    <a
                                        href={attachment.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="w-full h-32 flex flex-col items-center justify-center bg-white/5 rounded-lg mb-2 hover:bg-white/10 transition"
                                    >
                                        <FileText className="w-8 h-8 text-cyan-300 mb-2" />
                                        <span className="px-3 text-center text-xs text-gray-300 line-clamp-2">
                                            Abrir documento
                                        </span>
                                    </a>
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
