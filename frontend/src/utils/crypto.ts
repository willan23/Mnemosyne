import englishWordlist from 'bip39/src/wordlists/english.json';

const BIP39_WORDLIST = englishWordlist as string[];
const volatileIdentities = new Map<string, { publicKey: CryptoKey, privateKey: CryptoKey, pemPublic: string }>();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const bytesToBinary = (bytes: Uint8Array): string =>
    Array.from(bytes).map((byte) => byte.toString(2).padStart(8, '0')).join('');

const normalizeMnemonic = (mnemonic: string | string[]): string =>
    (Array.isArray(mnemonic) ? mnemonic.join(' ') : mnemonic)
        .normalize('NFKD')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
    const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const digest = await window.crypto.subtle.digest('SHA-256', input);
    return new Uint8Array(digest);
}

export async function sha256Hex(value: string): Promise<string> {
    const digest = await window.crypto.subtle.digest('SHA-256', encoder.encode(value.trim().toLowerCase()));
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

export async function generateBip39Mnemonic(): Promise<string[]> {
    const entropy = new Uint8Array(16);
    window.crypto.getRandomValues(entropy);

    const entropyBits = bytesToBinary(entropy);
    const checksumBits = bytesToBinary(await sha256(entropy)).slice(0, entropy.length * 8 / 32);
    const bits = entropyBits + checksumBits;

    const words: string[] = [];
    for (let i = 0; i < bits.length / 11; i++) {
        const index = parseInt(bits.slice(i * 11, (i + 1) * 11), 2);
        words.push(BIP39_WORDLIST[index]);
    }

    return words;
}

export async function validateBip39Mnemonic(mnemonic: string | string[]): Promise<boolean> {
    const words = normalizeMnemonic(mnemonic).split(' ').filter(Boolean);
    if (words.length !== 12 || words.some((word) => !BIP39_WORDLIST.includes(word))) {
        return false;
    }

    const bits = words
        .map((word) => BIP39_WORDLIST.indexOf(word).toString(2).padStart(11, '0'))
        .join('');
    const dividerIndex = Math.floor(bits.length / 33) * 32;
    const entropyBits = bits.slice(0, dividerIndex);
    const checksumBits = bits.slice(dividerIndex);

    const entropy = new Uint8Array(entropyBits.length / 8);
    for (let i = 0; i < entropy.length; i++) {
        entropy[i] = parseInt(entropyBits.slice(i * 8, (i + 1) * 8), 2);
    }

    const expectedChecksum = bytesToBinary(await sha256(entropy)).slice(0, checksumBits.length);
    return checksumBits === expectedChecksum;
}

// Deriva uma chave AES-GCM 256-bit a partir da mnemônica usando PBKDF2.
export async function deriveAesKeyFromMnemonic(mnemonic: string[], salt: string = 'mnemosyne:local-vault', iterations: number = 250000): Promise<CryptoKey> {
    const mnemonicString = normalizeMnemonic(mnemonic);
    const keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        encoder.encode(mnemonicString),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );
    return await window.crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: encoder.encode(salt),
            iterations,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}
// utilitário criptográfico Soberano (Zero-Knowledge) usando Web Crypto API
// As operações acontecem 100% no cliente (browser/Rust) e nunca são enviadas ao servidor em texto limpo.

export async function generateRSAKeyPair() {
    const keyPair = await window.crypto.subtle.generateKey(
        {
            name: "RSA-OAEP",
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-256",
        },
        true,
        ["encrypt", "decrypt"]
    );
    return keyPair;
}

async function importRsaPublicJwk(publicJwk: JsonWebKey): Promise<CryptoKey> {
    return window.crypto.subtle.importKey(
        'jwk',
        publicJwk,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        true,
        ['encrypt']
    );
}

async function importRsaPrivateJwk(privateJwk: JsonWebKey): Promise<CryptoKey> {
    return window.crypto.subtle.importKey(
        'jwk',
        privateJwk,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        false,
        ['decrypt']
    );
}

export async function encryptTextAesGcm(plaintext: string, key: CryptoKey): Promise<{ iv: string, data: string }> {
    const encrypted = await encryptBytesAesGcm(encoder.encode(plaintext).buffer as ArrayBuffer, key);
    return {
        iv: encrypted.iv,
        data: window.btoa(String.fromCharCode(...new Uint8Array(encrypted.cipherBytes))),
    };
}

export async function decryptTextAesGcm(payload: { iv: string, data: string }, key: CryptoKey): Promise<string> {
    const ivBinary = window.atob(payload.iv);
    const iv = new Uint8Array(ivBinary.length);
    for (let i = 0; i < ivBinary.length; i++) iv[i] = ivBinary.charCodeAt(i);

    const dataBinary = window.atob(payload.data);
    const data = new Uint8Array(dataBinary.length);
    for (let i = 0; i < dataBinary.length; i++) data[i] = dataBinary.charCodeAt(i);

    const decrypted = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return decoder.decode(decrypted);
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
    const exported = await window.crypto.subtle.exportKey("spki", key);
    const exportedAsString = String.fromCharCode.apply(null, Array.from(new Uint8Array(exported)));
    const exportedAsBase64 = window.btoa(exportedAsString);
    return `-----BEGIN PUBLIC KEY-----\n${exportedAsBase64}\n-----END PUBLIC KEY-----`;
}

export async function importPublicKey(pem: string): Promise<CryptoKey> {
    // Remove cabeçalhos e espaços
    const pemHeader = "-----BEGIN PUBLIC KEY-----";
    const pemFooter = "-----END PUBLIC KEY-----";
    const pemContents = pem.replace(pemHeader, "").replace(pemFooter, "").replace(/\n/g, "").replace(/\r/g, "").trim();
    
    const binaryDerString = window.atob(pemContents);
    const binaryDer = new Uint8Array(binaryDerString.length);
    for (let i = 0; i < binaryDerString.length; i++) {
        binaryDer[i] = binaryDerString.charCodeAt(i);
    }

    return await window.crypto.subtle.importKey(
        "spki",
        binaryDer.buffer,
        {
            name: "RSA-OAEP",
            hash: "SHA-256"
        },
        true,
        ["encrypt"]
    );
}

export async function rsaEncrypt(text: string, publicKey: CryptoKey): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const encryptedData = await window.crypto.subtle.encrypt(
        {
            name: "RSA-OAEP"
        },
        publicKey,
        data
    );
    
    // Converte ArrayBuffer para Base64
    const buffer = new Uint8Array(encryptedData);
    const base64 = window.btoa(String.fromCharCode.apply(null, Array.from(buffer)));
    return base64;
}

export async function rsaDecrypt(base64Ciphertext: string, privateKey: CryptoKey): Promise<string> {
    const binaryString = window.atob(base64Ciphertext);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }

    const decryptedData = await window.crypto.subtle.decrypt(
        {
            name: "RSA-OAEP"
        },
        privateKey,
        bytes.buffer
    );

    const decoder = new TextDecoder();
    return decoder.decode(decryptedData);
}

function identityVaultKey(scope: string): string {
    return `mnemosyne_identity_vault_${scope}`;
}

// Identidade criptográfica soberana. Com mnemónica, a chave privada é guardada apenas cifrada.
export async function getOrCreateIdentity(scope: string = 'session', mnemonic?: string[] | null): Promise<{ publicKey: CryptoKey, privateKey: CryptoKey, pemPublic: string }> {
    localStorage.removeItem('mnemosyne_private_jwk');
    localStorage.removeItem('mnemosyne_public_jwk');

    const mnemonicFingerprint = mnemonic ? await sha256Hex(normalizeMnemonic(mnemonic)) : null;
    const cacheScope = mnemonicFingerprint ? `${scope}:vault:${mnemonicFingerprint}` : scope;
    const cachedIdentity = volatileIdentities.get(cacheScope);
    if (cachedIdentity) return cachedIdentity;

    if (mnemonic && mnemonic.length > 0) {
        const vaultKey = await deriveAesKeyFromMnemonic(mnemonic, `mnemosyne:identity:${scope}`);
        const storedVault = localStorage.getItem(identityVaultKey(scope));

        if (storedVault) {
            try {
                const parsedVault = JSON.parse(storedVault) as { iv: string, data: string };
                const identityJson = JSON.parse(await decryptTextAesGcm(parsedVault, vaultKey)) as { publicJwk: JsonWebKey, privateJwk: JsonWebKey };
                const publicKey = await importRsaPublicJwk(identityJson.publicJwk);
                const privateKey = await importRsaPrivateJwk(identityJson.privateJwk);
                const pemPublic = await exportPublicKey(publicKey);
                const identity = { publicKey, privateKey, pemPublic };
                volatileIdentities.set(cacheScope, identity);
                return identity;
            } catch (error) {
                console.error('Unable to unlock encrypted identity vault', error);
                throw new Error('Não foi possível desbloquear a identidade local com esta mnemónica.');
            }
        }

        const keyPair = await generateRSAKeyPair();
        const publicJwk = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);
        const privateJwk = await window.crypto.subtle.exportKey('jwk', keyPair.privateKey);
        const encryptedVault = await encryptTextAesGcm(JSON.stringify({ publicJwk, privateJwk }), vaultKey);
        localStorage.setItem(identityVaultKey(scope), JSON.stringify(encryptedVault));

        const pemPublic = await exportPublicKey(keyPair.publicKey);
        const identity = { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey, pemPublic };
        volatileIdentities.set(cacheScope, identity);
        return identity;
    }

    const keyPair = await generateRSAKeyPair();
    const pemPublic = await exportPublicKey(keyPair.publicKey);
    const identity = { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey, pemPublic };
    volatileIdentities.set(cacheScope, identity);
    return identity;
}

export async function encryptBytesAesGcm(data: ArrayBuffer, key: CryptoKey): Promise<{ cipherBytes: ArrayBuffer, iv: string }> {
    const ivBytes = new Uint8Array(12);
    window.crypto.getRandomValues(ivBytes);
    const cipherBytes = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivBytes }, key, data);
    return {
        cipherBytes,
        iv: window.btoa(String.fromCharCode(...ivBytes)),
    };
}

export async function generateMnemonic(): Promise<string[]> {
    return generateBip39Mnemonic();
}
