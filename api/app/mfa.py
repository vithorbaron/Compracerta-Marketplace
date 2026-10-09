"""Verificação em duas etapas por aplicativo autenticador (TOTP, RFC 6238).

Nenhum código é enviado por e-mail ou SMS: o aplicativo do usuário gera o
código a partir de um segredo compartilhado na ativação (QR code). O segredo
fica cifrado no banco (AES-256-GCM) com a chave MFA_CHAVE, guardada no Key Vault.
"""
import base64
import hashlib
import hmac
import os
import secrets
import struct
import time

import segno
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from . import config

EMISSOR = "CompraCerta"
PERIODO_S = 30
DIGITOS = 6
# Aceita o código anterior e o seguinte: tolera relógio do celular até 30 s fora.
JANELA = 1
CODIGOS_RECUPERACAO = 10
_ALFABETO_RECUPERACAO = "abcdefghjkmnpqrstuvwxyz23456789"  # sem 0/o, 1/l/i
_VERSAO_CIFRA = "v1"


# ---------------------------------------------------------------- TOTP

def novo_segredo() -> bytes:
    return secrets.token_bytes(20)  # 160 bits, o recomendado pela RFC 4226


def segredo_base32(segredo: bytes) -> str:
    return base64.b32encode(segredo).decode("ascii").rstrip("=")


def passo_atual(momento: float | None = None) -> int:
    return int((time.time() if momento is None else momento) // PERIODO_S)


def codigo_totp(segredo: bytes, passo: int) -> str:
    digest = hmac.new(segredo, struct.pack(">Q", passo), hashlib.sha1).digest()
    deslocamento = digest[-1] & 0x0F
    numero = struct.unpack(">I", digest[deslocamento:deslocamento + 4])[0] & 0x7FFFFFFF
    return str(numero % 10 ** DIGITOS).zfill(DIGITOS)


def verificar_totp(segredo: bytes, codigo: str, ultimo_passo: int, momento: float | None = None) -> int | None:
    """Devolve o passo aceito, ou None. Recusa passos já usados (sem reuso de código)."""
    if not (isinstance(codigo, str) and len(codigo) == DIGITOS and codigo.isdigit()):
        return None
    atual = passo_atual(momento)
    aceito = None
    for passo in range(atual - JANELA, atual + JANELA + 1):
        # Compara todos os candidatos, em tempo constante, antes de decidir.
        if hmac.compare_digest(codigo_totp(segredo, passo), codigo) and passo > ultimo_passo:
            aceito = passo
    return aceito


def uri_otpauth(segredo: bytes, usuario: str) -> str:
    rotulo = f"{EMISSOR}:{usuario}"
    return (f"otpauth://totp/{rotulo}?secret={segredo_base32(segredo)}&issuer={EMISSOR}"
            f"&algorithm=SHA1&digits={DIGITOS}&period={PERIODO_S}")


def qr_svg_data_uri(conteudo: str) -> str:
    return segno.make(conteudo, error="m").svg_data_uri(scale=5, border=2)


def qr_terminal(conteudo: str) -> None:
    segno.make(conteudo, error="m").terminal(compact=True)


# ---------------------------------------------------------------- códigos de recuperação

def novos_codigos_recuperacao() -> list[str]:
    codigos = []
    for _ in range(CODIGOS_RECUPERACAO):
        bruto = "".join(secrets.choice(_ALFABETO_RECUPERACAO) for _ in range(10))
        codigos.append(f"{bruto[:5]}-{bruto[5:]}")
    return codigos


def normalizar_recuperacao(codigo: str) -> str | None:
    limpo = codigo.strip().lower().replace("-", "").replace(" ", "")
    if len(limpo) != 10 or any(c not in _ALFABETO_RECUPERACAO for c in limpo):
        return None
    return limpo


def hash_recuperacao(codigo_normalizado: str) -> str:
    # 50 bits aleatórios por código: SHA-256 basta (como os tokens de sessão).
    return hashlib.sha256(codigo_normalizado.encode("ascii")).hexdigest()


# ---------------------------------------------------------------- cifra do segredo

def _chave() -> bytes | None:
    bruta = os.environ.get("MFA_CHAVE", "")
    if len(bruta) >= 32:
        return hashlib.sha256(bruta.encode("utf-8")).digest()
    if not config.COOKIE_SEGURO:
        # Só fora do Azure (teste local): chave fixa de desenvolvimento.
        return hashlib.sha256(b"compracerta-desenvolvimento-local").digest()
    return None


def disponivel() -> bool:
    return _chave() is not None


def cifrar(segredo: bytes, usuario_id: int) -> str:
    chave = _chave()
    if chave is None:
        raise RuntimeError("mfa_sem_chave")
    nonce = secrets.token_bytes(12)
    # O id do usuário entra como dado associado: o segredo de uma conta não serve em outra.
    cifrado = AESGCM(chave).encrypt(nonce, segredo, str(usuario_id).encode("ascii"))
    return f"{_VERSAO_CIFRA}:" + base64.urlsafe_b64encode(nonce + cifrado).decode("ascii")


def decifrar(texto: str, usuario_id: int) -> bytes:
    chave = _chave()
    versao, _, corpo = texto.partition(":")
    if chave is None or versao != _VERSAO_CIFRA:
        raise RuntimeError("mfa_sem_chave")
    bruto = base64.urlsafe_b64decode(corpo.encode("ascii"))
    try:
        return AESGCM(chave).decrypt(bruto[:12], bruto[12:], str(usuario_id).encode("ascii"))
    except InvalidTag as exc:
        raise RuntimeError("mfa_chave_incorreta") from exc
