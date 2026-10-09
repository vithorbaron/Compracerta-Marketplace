"""Senhas, sessões, limites de requisição e cabeçalhos HTTP."""
import hashlib
import json
import logging
import secrets
import sys
import threading
import time
from collections import defaultdict, deque

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from . import config

# Argon2id com os parâmetros mínimos recomendados pelo OWASP (19 MiB, t=2, p=1).
_hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)
_HASH_FALSO = _hasher.hash(secrets.token_urlsafe(16))

_log = logging.getLogger("compracerta.seguranca")
if not _log.handlers:
    _saida = logging.StreamHandler(sys.stdout)
    _saida.setFormatter(logging.Formatter("%(message)s"))
    _log.addHandler(_saida)
    _log.setLevel(logging.INFO)
    _log.propagate = False


def registrar_evento(tipo: str, **detalhes) -> None:
    """Evento de segurança em JSON no stdout (vai para o Log Analytics). Sem dados pessoais."""
    _log.info(json.dumps({"evento": tipo, "em": int(time.time()), **detalhes}, ensure_ascii=False))


def gerar_hash_senha(senha: str) -> str:
    return _hasher.hash(senha)


def verificar_senha(hash_salvo: str | None, senha: str) -> bool:
    """Compara a senha; sem usuário, faz o mesmo trabalho para não revelar pelo tempo."""
    try:
        return _hasher.verify(hash_salvo or _HASH_FALSO, senha) and hash_salvo is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def precisa_rehash(hash_salvo: str) -> bool:
    try:
        return _hasher.check_needs_rehash(hash_salvo)
    except InvalidHashError:
        return True


def novo_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def ip_do_cliente(request) -> str:
    if config.CONFIAR_PROXY:
        encaminhado = request.headers.get("x-forwarded-for", "")
        if encaminhado:
            # O proxy do App Service acrescenta o IP real no fim da lista.
            ultimo = encaminhado.split(",")[-1].strip()
            if ultimo.startswith("["):
                return ultimo.split("]")[0].lstrip("[")
            return ultimo.rsplit(":", 1)[0] if ultimo.count(":") == 1 else ultimo
    return request.client.host if request.client else "desconhecido"


class LimitadorDeTaxa:
    """Janela deslizante em memória, por chave (ex.: IP + grupo de rotas)."""

    def __init__(self):
        self._acessos = defaultdict(deque)
        self._trava = threading.Lock()

    def permitir(self, chave: str, limite: int, janela_s: int) -> bool:
        agora = time.monotonic()
        with self._trava:
            fila = self._acessos[chave]
            while fila and agora - fila[0] > janela_s:
                fila.popleft()
            if len(fila) >= limite:
                return False
            fila.append(agora)
            if len(self._acessos) > 50000:
                self._acessos.clear()
            return True


limitador = LimitadorDeTaxa()


def origem_permitida(request) -> bool:
    """Proteção CSRF: alterações só vindas do próprio site."""
    site = request.headers.get("sec-fetch-site")
    if site and site not in ("same-origin", "none"):
        return False
    origem = request.headers.get("origin")
    if origem:
        origem = origem.rstrip("/")
        if origem in config.ORIGENS_PERMITIDAS:
            return True
        # Mesma origem: o navegador põe no Host o endereço do próprio site.
        esquema = "https" if config.COOKIE_SEGURO else request.url.scheme
        return origem == f"{esquema}://{request.headers.get('host', '')}"
    return site == "same-origin"


def politica_de_conteudo() -> str:
    imagens = "'self' data:"
    if not config.IMAGENS_BLOB_URL:
        # Fora do Azure (sem Blob configurado): fotos originais do catálogo.
        imagens += " https://images.unsplash.com"
    return (
        "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; "
        f"img-src {imagens}; connect-src 'self'; base-uri 'none'; form-action 'self'; "
        "object-src 'none'; frame-ancestors 'none'"
        + ("; upgrade-insecure-requests" if config.COOKIE_SEGURO else "")
    )


CABECALHOS_FIXOS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
}


class LimiteDeCorpo:
    """Middleware ASGI: recusa corpos de requisição acima do limite (413)."""

    def __init__(self, app, limite: int):
        self.app = app
        self.limite = limite

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        for nome, valor in scope.get("headers", []):
            if nome == b"content-length" and valor.isdigit() and int(valor) > self.limite:
                return await self._recusar(send)
        recebido = 0

        async def receber():
            nonlocal recebido
            mensagem = await receive()
            if mensagem["type"] == "http.request":
                recebido += len(mensagem.get("body", b""))
                if recebido > self.limite:
                    raise _CorpoGrande()
            return mensagem

        try:
            await self.app(scope, receber, send)
        except _CorpoGrande:
            await self._recusar(send)

    @staticmethod
    async def _recusar(send):
        corpo = b'{"erro":"requisicao_grande"}'
        await send({"type": "http.response.start", "status": 413,
                    "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(corpo)).encode())]})
        await send({"type": "http.response.body", "body": corpo})


class _CorpoGrande(Exception):
    pass
