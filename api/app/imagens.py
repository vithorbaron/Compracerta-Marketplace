"""Imagens dos produtos servidas a partir de um container privado do Blob Storage.

O navegador pede /imagens/produto-<id>.jpg ao próprio site. A aplicação busca o
arquivo no Blob com a identidade gerenciada do App Service (só leitura, só no
container de imagens) e devolve os bytes. Endereço do storage, nome do container
e token de acesso nunca chegam ao cliente.
"""
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from . import config

NOME_VALIDO = re.compile(r"^produto-[1-9][0-9]{0,3}\.jpg$")
TAMANHO_MAXIMO = 5 * 1024 * 1024
VALIDADE_CACHE_S = 60 * 60
VALIDADE_AUSENTE_S = 5 * 60
MAX_ITENS_CACHE = 200
RECURSO_STORAGE = "https://storage.azure.com/"
VERSAO_API_BLOB = "2023-11-03"

_trava = threading.Lock()
_trava_token = threading.Lock()
_token: tuple[str, float] | None = None
# nome -> (bytes ou None, expira_em). None guarda "não existe" por pouco tempo,
# para que nomes inexistentes não virem uma consulta ao storage a cada pedido.
_cache: dict[str, tuple[bytes | None, float]] = {}


def _token_identidade() -> str:
    """Token do Entra ID para o Storage, emitido pela identidade gerenciada do App Service."""
    global _token
    # Trava própria: pedidos simultâneos esperam um único token em vez de pedir vários.
    with _trava_token:
        if _token and _token[1] - 300 > time.time():
            return _token[0]
        endpoint = os.environ.get("IDENTITY_ENDPOINT")
        segredo = os.environ.get("IDENTITY_HEADER")
        if not endpoint or not segredo:
            raise RuntimeError("identidade_indisponivel")
        url = endpoint + "?" + urllib.parse.urlencode({"resource": RECURSO_STORAGE, "api-version": "2019-08-01"})
        requisicao = urllib.request.Request(url, headers={"X-IDENTITY-HEADER": segredo})
        with urllib.request.urlopen(requisicao, timeout=5) as resposta:
            dados = json.load(resposta)
        _token = (dados["access_token"], float(dados["expires_on"]))
        return _token[0]


def _baixar(nome: str) -> bytes | None:
    requisicao = urllib.request.Request(f"{config.IMAGENS_BLOB_URL}/{nome}", headers={
        "Authorization": f"Bearer {_token_identidade()}",
        "x-ms-version": VERSAO_API_BLOB,
    })
    try:
        with urllib.request.urlopen(requisicao, timeout=10) as resposta:
            dados = resposta.read(TAMANHO_MAXIMO + 1)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise
    # Só entrega JPEG de tamanho razoável, mesmo que o container tenha outra coisa.
    if len(dados) > TAMANHO_MAXIMO or not dados.startswith(b"\xff\xd8\xff"):
        return None
    return dados


def obter(nome: str) -> bytes | None:
    if not config.IMAGENS_BLOB_URL or not NOME_VALIDO.fullmatch(nome):
        return None
    momento = time.time()
    with _trava:
        item = _cache.get(nome)
        if item and item[1] > momento:
            return item[0]
    dados = _baixar(nome)
    with _trava:
        if len(_cache) >= MAX_ITENS_CACHE:
            _cache.clear()
        _cache[nome] = (dados, momento + (VALIDADE_CACHE_S if dados else VALIDADE_AUSENTE_S))
    return dados
