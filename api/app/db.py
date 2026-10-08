"""Esquema do banco (PostgreSQL no Azure; SQLite para desenvolvimento local)."""
import json
import os
from pathlib import Path

from sqlalchemy import (
    BigInteger, Column, DateTime, ForeignKey, Integer, MetaData, String, Table,
    create_engine, func, insert, select, text, update,
)

from . import config

# hide_parameters: valores das consultas (que podem conter dados pessoais)
# nunca aparecem em mensagens de erro ou logs.
engine = create_engine(config.URL_BANCO, pool_pre_ping=True, hide_parameters=True, future=True)
metadata = MetaData()

usuarios = Table(
    "usuarios", metadata,
    Column("id", Integer, primary_key=True),
    Column("usuario", String(20), nullable=False, unique=True),
    Column("email", String(254), nullable=False, unique=True),
    Column("senha_hash", String(255), nullable=False),
    Column("papel", String(20), nullable=False, default="cliente"),
    Column("falhas_login", Integer, nullable=False, default=0),
    Column("nivel_bloqueio", Integer, nullable=False, default=0),
    Column("bloqueado_ate", DateTime(timezone=True), nullable=True),
    Column("criado_em", DateTime(timezone=True), nullable=False, server_default=func.now()),
)

sessoes = Table(
    "sessoes", metadata,
    Column("id", Integer, primary_key=True),
    Column("token_hash", String(64), nullable=False, unique=True),
    Column("usuario_id", Integer, ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False, index=True),
    Column("criada_em", DateTime(timezone=True), nullable=False),
    Column("ultima_atividade", DateTime(timezone=True), nullable=False),
    Column("expira_em", DateTime(timezone=True), nullable=False, index=True),
)

produtos = Table(
    "produtos", metadata,
    Column("id", Integer, primary_key=True, autoincrement=False),
    Column("nome", String(120), nullable=False),
    Column("categoria", String(40), nullable=False),
    Column("preco_centavos", BigInteger, nullable=False),
    Column("estoque", Integer, nullable=False),
)

pedidos = Table(
    "pedidos", metadata,
    Column("id", Integer, primary_key=True),
    Column("transacao_id", String(40), nullable=False, unique=True),
    Column("idempotency_key", String(36), nullable=False, unique=True),
    Column("assinatura", String(64), nullable=False),
    Column("usuario_id", Integer, ForeignKey("usuarios.id"), nullable=False, index=True),
    Column("metodo_pagamento", String(20), nullable=False),
    Column("subtotal_centavos", BigInteger, nullable=False),
    Column("frete_centavos", BigInteger, nullable=False),
    Column("total_centavos", BigInteger, nullable=False),
    Column("status", String(20), nullable=False),
    # Dados do comprador: o mínimo para o pedido; do CPF só os 2 últimos dígitos.
    Column("comprador_nome", String(100), nullable=False),
    Column("comprador_email", String(254), nullable=False),
    Column("comprador_telefone", String(11), nullable=False),
    Column("comprador_cpf_final", String(2), nullable=False),
    Column("criado_em", DateTime(timezone=True), nullable=False, server_default=func.now()),
)

itens_pedido = Table(
    "itens_pedido", metadata,
    Column("id", Integer, primary_key=True),
    Column("pedido_id", Integer, ForeignKey("pedidos.id", ondelete="CASCADE"), nullable=False, index=True),
    Column("produto_id", Integer, ForeignKey("produtos.id"), nullable=False),
    Column("quantidade", Integer, nullable=False),
    Column("preco_unitario_centavos", BigInteger, nullable=False),
)


PAPEIS_VALIDOS = ("cliente", "financeiro", "ceo", "rede", "seguranca")


def _papeis_configurados() -> dict[str, str]:
    """Lê PAPEIS_OPERADORES no formato "usuario=papel,usuario2=papel2"."""
    resultado = {}
    for par in os.environ.get("PAPEIS_OPERADORES", "").split(","):
        usuario, _, papel = par.strip().partition("=")
        usuario, papel = usuario.strip().lower(), papel.strip().lower()
        if usuario and papel in PAPEIS_VALIDOS:
            resultado[usuario] = papel
    return resultado


def inicializar() -> list[str]:
    """Cria as tabelas que faltam, carrega o catálogo se estiver vazio e aplica
    os papéis de operador definidos na configuração do App Service.
    Devolve os usuários cujo papel foi aplicado."""
    aplicados = []
    with engine.begin() as conn:
        if conn.dialect.name == "postgresql":
            # Vários processos sobem juntos: só um cria as tabelas por vez.
            conn.execute(text("SELECT pg_advisory_xact_lock(724001)"))
        metadata.create_all(conn)
        if not conn.execute(select(produtos.c.id).limit(1)).first():
            catalogo = json.loads((Path(__file__).parent / "catalogo.json").read_text(encoding="utf-8"))
            conn.execute(insert(produtos), [
                {"id": p["id"], "nome": p["nome"], "categoria": p["categoria"],
                 "preco_centavos": p["precoCentavos"], "estoque": p["estoque"]}
                for p in catalogo
            ])
        for usuario, papel in _papeis_configurados().items():
            resultado = conn.execute(update(usuarios).where(usuarios.c.usuario == usuario).values(papel=papel))
            if resultado.rowcount:
                aplicados.append(usuario)
    return aplicados
