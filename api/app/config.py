"""Configuração lida de variáveis de ambiente (definidas no App Service)."""
import os
from pathlib import Path

from sqlalchemy.engine import URL


def _bool(nome: str, padrao: bool) -> bool:
    valor = os.environ.get(nome)
    if valor is None:
        return padrao
    return valor.strip().lower() in ("1", "true", "sim", "yes")


def _site_dir() -> Path:
    definido = os.environ.get("SITE_DIR")
    if definido:
        return Path(definido)
    base = Path(__file__).resolve().parent.parent
    for candidato in (base / "site", base.parent / "site"):
        if (candidato / "index.html").exists():
            return candidato
    return base / "site"


def _url_banco():
    direta = os.environ.get("DATABASE_URL")
    if direta:
        return direta
    host = os.environ.get("PGHOST")
    if host:
        return URL.create(
            "postgresql+psycopg",
            username=os.environ.get("PGUSER"),
            password=os.environ.get("PGPASSWORD"),
            host=host,
            port=int(os.environ.get("PGPORT", "5432")),
            database=os.environ.get("PGDATABASE", "compracerta"),
            query={"sslmode": os.environ.get("PGSSLMODE", "require")},
        )
    return "sqlite:///./compracerta-local.db"


SITE_DIR = _site_dir()
URL_BANCO = _url_banco()
# Origens aceitas em requisições que alteram dados (proteção CSRF).
ORIGENS_PERMITIDAS = {
    o.strip().rstrip("/") for o in os.environ.get("ORIGENS_PERMITIDAS", "").split(",") if o.strip()
}
# Atrás do proxy do App Service: IP do cliente vem do X-Forwarded-For.
CONFIAR_PROXY = _bool("TRUST_PROXY", False)
COOKIE_SEGURO = _bool("COOKIE_SEGURO", True)
NOME_COOKIE = "__Host-cc_sessao" if COOKIE_SEGURO else "cc_sessao"
# Endereço do container privado de imagens (Blob Storage). Só a aplicação o usa:
# o navegador recebe as fotos pela rota /imagens/ do próprio site.
IMAGENS_BLOB_URL = os.environ.get("IMAGENS_BLOB_URL", "").rstrip("/")

INATIVIDADE_S = 30 * 60
DURACAO_MAXIMA_S = 8 * 60 * 60
LIMITE_CORPO_BYTES = 16 * 1024
