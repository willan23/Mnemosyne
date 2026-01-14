/**
 * Mnemosyne Crypto Utilities
 * Implements E2EE using Web Crypto API (PBKDF2 + AES-GCM)
 */

export const generateMnemonic = (): string[] => {
    // Simplistic 12-word generation for MVP (in production use a library like bip39)
    const wordList = [
        "nebula", "echo", "cipher", "mnemosyne", "constellation", "amber", "quartz", "vortex",
        "horizon", "pulse", "starlight", "glitch", "proxy", "zenith", "quantum", "archive",
        "binary", "drift", "ethos", "fable", "ghost", "hybrid", "index", "jive"
    ];
    const mnemonic: string[] = [];
    const randomValues = new Uint32Array(12);
    window.crypto.getRandomValues(randomValues);
    for (let i = 0; i < 12; i++) {
        mnemonic.push(wordList[randomValues[i] % wordList.length]);
    }
    return mnemonic;
};

export const deriveKey = async (passphrase: string, salt: Uint8Array): Promise<CryptoKey> => {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw",
        enc.encode(passphrase),
        "PBKDF2",
        false,
        ["deriveBits", "deriveKey"]
    );

    return window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt as any,
            iterations: 100000,
            hash: "SHA-256",
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
};

export const encryptData = async (data: string, key: CryptoKey): Promise<{ cipher: ArrayBuffer; iv: Uint8Array }> => {
    const enc = new TextEncoder();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const cipher = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv as any },
        key,
        enc.encode(data)
    );
    return { cipher, iv };
};

export const decryptData = async (cipher: ArrayBuffer, key: CryptoKey, iv: Uint8Array): Promise<string> => {
    const dec = new TextDecoder();
    const decrypted = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv as any },
        key,
        cipher
    );
    return dec.decode(decrypted);
};
