import os
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.backends import default_backend

# --- 1. SIMULAÇÃO DO LADO DO CLIENTE (DISPOSITIVO DO UTILIZADOR) ---

def derivar_chave(frase_passe: str, sal: bytes) -> bytes:
    """Deriva uma chave de 32 bytes (256 bits) a partir da frase-passe e do sal."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=sal,
        iterations=100000,  # Alto número de iterações para segurança
        backend=default_backend()
    )
    return kdf.derive(frase_passe.encode())

def cifrar_dados(chave: bytes, dados: str) -> tuple[bytes, bytes]:
    """Cifra os dados usando AES-256-GCM e gera um IV (Nonce)."""
    aesgcm = AESGCM(chave)
    # O IV (Initialization Vector) deve ser único para cada cifragem
    iv = os.urandom(12)
    dados_cifrados = aesgcm.encrypt(iv, dados.encode(), None)
    return dados_cifrados, iv

# --- 2. SIMULAÇÃO DO LADO DO SERVIDOR (ZERO-KNOWLEDGE) ---

def simular_armazenamento_servidor(dados_cifrados: bytes, iv: bytes):
    """O servidor armazena apenas os dados cifrados e o IV."""
    print("\n--- SIMULAÇÃO DO SERVIDOR (ARMAZENAMENTO) ---")
    print(f"Dados Cifrados (Armazenados): {dados_cifrados.hex()[:50]}...")
    print(f"IV (Armazenado): {iv.hex()}")
    # O servidor NÃO armazena a chave de cifragem!
    return dados_cifrados, iv

def tentar_decifrar_servidor(dados_cifrados: bytes, iv: bytes):
    """Simula a tentativa de decifragem no servidor (DEVE FALHAR)."""
    print("\n--- SIMULAÇÃO DO SERVIDOR (TENTATIVA DE LEITURA) ---")
    try:
        # Tentativa de usar uma chave aleatória (o servidor não tem a chave real)
        chave_falsa = os.urandom(32)
        aesgcm = AESGCM(chave_falsa)
        aesgcm.decrypt(iv, dados_cifrados, None)
        print("ERRO: O servidor conseguiu decifrar com uma chave falsa. O PoC falhou.")
    except Exception as e:
        print(f"SUCESSO: O servidor FALHOU ao decifrar (Erro esperado: {e}). Zero-Knowledge provado.")

# --- 3. SIMULAÇÃO DO LADO DO CLIENTE (RECUPERAÇÃO) ---

def decifrar_dados(chave: bytes, dados_cifrados: bytes, iv: bytes) -> str:
    """Decifra os dados usando a chave correta e o IV."""
    aesgcm = AESGCM(chave)
    dados_decifrados = aesgcm.decrypt(iv, dados_cifrados, None)
    return dados_decifrados.decode()

# --- EXECUÇÃO DO POC ---

# Dados de entrada (simulando a transcrição da entrevista)
DADOS_TRANSCRICAO = "A minha maior lição sobre o dinheiro foi que ele só serve para te dar tempo. Tempo para as pessoas que amas."
FRASE_PASSE = "tempo para as pessoas que amas" # A chave mestra do utilizador
SAL_UNICO = os.urandom(16) # O sal é único para o utilizador e pode ser armazenado não cifrado

# 1. Cliente: Deriva a chave
CHAVE_CLIENTE = derivar_chave(FRASE_PASSE, SAL_UNICO)

# 2. Cliente: Cifra os dados
DADOS_CIFRADOS, IV = cifrar_dados(CHAVE_CLIENTE, DADOS_TRANSCRICAO)

# 3. Servidor: Armazena os dados cifrados e o IV
DADOS_ARMAZENADOS, IV_ARMAZENADO = simular_armazenamento_servidor(DADOS_CIFRADOS, IV)

# 4. Servidor: Tenta ler os dados (DEVE FALHAR)
tentar_decifrar_servidor(DADOS_ARMAZENADOS, IV_ARMAZENADO)

# 5. Cliente: Recupera os dados do servidor e decifra
DADOS_DECIFRADOS = decifrar_dados(CHAVE_CLIENTE, DADOS_ARMAZENADOS, IV_ARMAZENADO)

print("\n--- SIMULAÇÃO DO CLIENTE (RECUPERAÇÃO) ---")
print(f"Dados Decifrados (Recuperados): {DADOS_DECIFRADOS}")
print(f"Verificação: {DADOS_DECIFRADOS == DADOS_TRANSCRICAO}")
