import { useState, useRef, useCallback } from 'react';

export interface AudioRecording {
    blob: Blob;
    url: string;
    duration: number;
}

export const useAudioRecorder = () => {
    const [isRecording, setIsRecording] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [duration, setDuration] = useState(0);
    const [audioURL, setAudioURL] = useState<string | null>(null);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<number | null>(null);
    const startTimeRef = useRef<number>(0);
    const pausedTimeRef = useRef<number>(0);

    const startRecording = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus'
            });

            mediaRecorderRef.current = mediaRecorder;
            chunksRef.current = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunksRef.current.push(e.data);
                }
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
                const url = URL.createObjectURL(blob);
                setAudioURL(url);

                // Stop all tracks
                stream.getTracks().forEach(track => track.stop());

                // Clear timer
                if (timerRef.current) {
                    clearInterval(timerRef.current);
                }
            };

            mediaRecorder.start();
            setIsRecording(true);
            setIsPaused(false);
            startTimeRef.current = Date.now();
            pausedTimeRef.current = 0;

            // Start duration timer
            timerRef.current = window.setInterval(() => {
                const elapsed = Date.now() - startTimeRef.current - pausedTimeRef.current;
                setDuration(Math.floor(elapsed / 1000));
            }, 1000);

        } catch (error) {
            console.error('Error starting recording:', error);
            alert('Erro ao acessar microfone. Verifique as permissões.');
        }
    }, []);

    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            setIsPaused(false);
        }
    }, [isRecording]);

    const pauseRecording = useCallback(() => {
        if (mediaRecorderRef.current && isRecording && !isPaused) {
            mediaRecorderRef.current.pause();
            setIsPaused(true);

            if (timerRef.current) {
                clearInterval(timerRef.current);
            }
        }
    }, [isRecording, isPaused]);

    const resumeRecording = useCallback(() => {
        if (mediaRecorderRef.current && isRecording && isPaused) {
            mediaRecorderRef.current.resume();
            setIsPaused(false);

            const pauseDuration = Date.now() - startTimeRef.current - duration * 1000;
            pausedTimeRef.current += pauseDuration;

            timerRef.current = window.setInterval(() => {
                const elapsed = Date.now() - startTimeRef.current - pausedTimeRef.current;
                setDuration(Math.floor(elapsed / 1000));
            }, 1000);
        }
    }, [isRecording, isPaused, duration]);

    const resetRecording = useCallback(() => {
        if (audioURL) {
            URL.revokeObjectURL(audioURL);
        }
        setAudioURL(null);
        setDuration(0);
        setIsRecording(false);
        setIsPaused(false);
        chunksRef.current = [];

        if (timerRef.current) {
            clearInterval(timerRef.current);
        }
    }, [audioURL]);

    const getRecording = useCallback((): AudioRecording | null => {
        if (!audioURL) return null;

        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        return {
            blob,
            url: audioURL,
            duration
        };
    }, [audioURL, duration]);

    return {
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
    };
};

/**
 * Format duration in seconds to MM:SS
 */
export const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};
