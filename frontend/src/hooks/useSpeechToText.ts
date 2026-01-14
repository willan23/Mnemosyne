import { useState, useCallback, useRef } from 'react';

export const useSpeechToText = () => {
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState('');
    const recognitionRef = useRef<any>(null);

    const startListening = useCallback(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert('Seu navegador não suporta reconhecimento de voz.');
            return;
        }

        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = true;
        recognitionRef.current.interimResults = true;
        recognitionRef.current.lang = 'pt-PT';

        recognitionRef.current.onresult = (event: any) => {
            let currentTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    currentTranscript += event.results[i][0].transcript;
                }
            }

            if (currentTranscript) {
                setTranscript(prev => {
                    const newTranscript = prev + ' ' + currentTranscript;
                    console.log('Final Transcript:', newTranscript.trim());
                    return newTranscript.trim();
                });
            }
        };

        recognitionRef.current.onerror = (event: any) => {
            console.error('Speech recognition error detailed:', event.error, event.message);
            if (event.error === 'not-allowed') {
                alert('Acesso ao microfone foi negado. Por favor, habilite nas permissões do navegador.');
            }
            setIsListening(false);
        };

        recognitionRef.current.onend = () => {
            setIsListening(false);
        };

        recognitionRef.current.start();
        setIsListening(true);
        setTranscript('');
    }, []);

    const stopListening = useCallback(() => {
        if (recognitionRef.current) {
            recognitionRef.current.stop();
            setIsListening(false);
        }
    }, []);

    return { isListening, transcript, startListening, stopListening };
};
