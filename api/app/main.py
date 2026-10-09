"""API do CompraCerta + entrega do site estático (mesma origem)."""
import hashlib
import json
import math
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import delete, func, insert, or_, select, update
from sqlalchemy.exc import IntegrityError

from . import config, db, imagens, validacao
from .seguranca import (
    CABECALHOS_FIXOS, LimiteDeCorpo, gerar_hash_senha, hash_token, ip_do_cliente, limitador,
    novo_token, origem_permitida, politica_de_conteudo, precisa_rehash, registrar_evento,
    verificar_senha,
)

FUSO = ZoneInfo("America/Sao_Paulo")
FALHAS_ATE_BLOQUEIO = 5
ESPERAS_BLOQUEIO_S = (30, 60, 300)
FRETE_PADRAO_CENTAVOS = 1990
FRETE_GRATIS_A_PARTIR_CENTAVOS = 30000
PAPEIS_PAINEL = ("financeiro", "ceo")
MENSAGEM_CADASTRO = "Não foi possível criar a conta com esses dados."

# Falhas de login para identificadores que não existem, guardadas em memória
# com as mesmas regras das contas reais: a resposta não revela se a conta existe.
_falhas_inexistentes: dict[str, tuple[int, int, datetime | None]] = {}


@asynccontextmanager
async def ciclo_de_vida(_app):
    aplicados = db.inicializar()
    if aplicados:
        registrar_evento("papeis_aplicados", quantidade=len(aplicados))
    yield


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=ciclo_de_vida)
app.add_middleware(LimiteDeCorpo, limite=config.LIMITE_CORPO_BYTES)


# ---------------------------------------------------------------- utilidades

def agora() -> datetime:
    return datetime.now(timezone.utc)


def utc(valor: datetime) -> datetime:
    return valor if valor.tzinfo else valor.replace(tzinfo=timezone.utc)


def erro(status: int, codigo: str, **extra) -> JSONResponse:
    return JSONResponse({"erro": codigo, **extra}, status_code=status)


def exigir_taxa(request: Request, grupo: str, limite: int, janela_s: int = 60) -> None:
    ip = ip_do_cliente(request)
    if not limitador.permitir(f"{grupo}:{ip}", limite, janela_s):
        registrar_evento("limite_excedido", grupo=grupo, ip=ip)
        raise HTTPException(429, "muitas_requisicoes")


# ---------------------------------------------------------------- middlewares

@app.middleware("http")
async def protecoes_http(request: Request, call_next):
    caminho = request.url.path
    eh_api = caminho.startswith("/api/")
    if eh_api and not limitador.permitir(f"api:{ip_do_cliente(request)}", 120, 60):
        resposta = erro(429, "muitas_requisicoes")
    elif eh_api and request.method not in ("GET", "HEAD", "OPTIONS") and not origem_permitida(request):
        registrar_evento("origem_recusada", rota=caminho, ip=ip_do_cliente(request))
        resposta = erro(403, "origem_nao_permitida")
    elif eh_api and request.method == "OPTIONS":
        resposta = Response(status_code=405)
    else:
        resposta = await call_next(request)
    for nome, valor in CABECALHOS_FIXOS.items():
        resposta.headers[nome] = valor
    resposta.headers["Content-Security-Policy"] = politica_de_conteudo()
    if config.COOKIE_SEGURO:
        resposta.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    if eh_api:
        resposta.headers["Cache-Control"] = "no-store"
    elif caminho.endswith((".html", "/")) or caminho.endswith(".js"):
        resposta.headers["Cache-Control"] = "no-cache"
    if "server" in resposta.headers:
        del resposta.headers["server"]
    return resposta


@app.exception_handler(RequestValidationError)
async def dados_invalidos(_request: Request, _exc: RequestValidationError):
    # Não devolve o detalhe da validação (evita eco dos dados enviados).
    return erro(400, "dados_invalidos")


@app.exception_handler(HTTPException)
async def erro_http(_request: Request, exc: HTTPException):
    if isinstance(exc.detail, dict):
        return JSONResponse(exc.detail, status_code=exc.status_code)
    return erro(exc.status_code, str(exc.detail))


@app.exception_handler(Exception)
async def erro_inesperado(_request: Request, exc: Exception):
    registrar_evento("erro_interno", classe=type(exc).__name__)
    return erro(500, "falha_interna")


# ---------------------------------------------------------------- sessão

def _definir_cookie(resposta: Response, token: str) -> None:
    resposta.set_cookie(
        config.NOME_COOKIE, token, max_age=config.DURACAO_MAXIMA_S, path="/",
        secure=config.COOKIE_SEGURO, httponly=True, samesite="strict",
    )


def _apagar_cookie(resposta: Response) -> None:
    resposta.delete_cookie(config.NOME_COOKIE, path="/", secure=config.COOKIE_SEGURO,
                           httponly=True, samesite="strict")


def sessao_opcional(request: Request) -> dict | None:
    token = request.cookies.get(config.NOME_COOKIE)
    if not token or len(token) > 100:
        return None
    momento = agora()
    with db.engine.begin() as conn:
        linha = conn.execute(
            select(db.sessoes.c.id, db.sessoes.c.criada_em, db.sessoes.c.ultima_atividade,
                   db.usuarios.c.id.label("usuario_id"), db.usuarios.c.usuario, db.usuarios.c.papel)
            .join(db.usuarios, db.usuarios.c.id == db.sessoes.c.usuario_id)
            .where(db.sessoes.c.token_hash == hash_token(token))
        ).first()
        if not linha:
            return None
        criada, ultima = utc(linha.criada_em), utc(linha.ultima_atividade)
        expira = min(ultima + timedelta(seconds=config.INATIVIDADE_S),
                     criada + timedelta(seconds=config.DURACAO_MAXIMA_S))
        if momento >= expira:
            conn.execute(delete(db.sessoes).where(db.sessoes.c.id == linha.id))
            return None
        if (momento - ultima).total_seconds() > 60:
            expira = min(momento + timedelta(seconds=config.INATIVIDADE_S),
                         criada + timedelta(seconds=config.DURACAO_MAXIMA_S))
            conn.execute(update(db.sessoes).where(db.sessoes.c.id == linha.id)
                         .values(ultima_atividade=momento, expira_em=expira))
    return {"sessao_id": linha.id, "usuario_id": linha.usuario_id, "usuario": linha.usuario,
            "papel": linha.papel, "expira_em": expira}


def exigir_login(sessao: Annotated[dict | None, Depends(sessao_opcional)]) -> dict:
    if not sessao:
        raise HTTPException(401, "nao_autenticado")
    return sessao


def exigir_painel(sessao: Annotated[dict, Depends(exigir_login)]) -> dict:
    if sessao["papel"] not in PAPEIS_PAINEL:
        registrar_evento("acesso_negado", rota="painel", usuario_id=sessao["usuario_id"])
        raise HTTPException(403, "sem_permissao")
    return sessao


def _resumo_sessao(sessao: dict) -> dict:
    return {"usuario": sessao["usuario"], "papel": sessao["papel"],
            "expiraEm": int(sessao["expira_em"].timestamp() * 1000)}


# ---------------------------------------------------------------- modelos

class Modelo(BaseModel):
    model_config = ConfigDict(extra="forbid")


Texto254 = Annotated[str, StringConstraints(max_length=254)]
Texto128 = Annotated[str, StringConstraints(max_length=128)]
Texto20 = Annotated[str, StringConstraints(max_length=20)]
Texto100 = Annotated[str, StringConstraints(max_length=100)]
Inteiro = Annotated[int, Field(strict=True)]


class CadastroIn(Modelo):
    email: Texto254
    usuario: Texto20
    senha: Texto128


class LoginIn(Modelo):
    identificador: Texto254
    senha: Texto128


class CompradorIn(Modelo):
    nome: Texto100
    cpf: Annotated[str, StringConstraints(max_length=14)]
    email: Texto254
    telefone: Texto20


class ItemIn(Modelo):
    id: Annotated[int, Field(strict=True, ge=1, le=1_000_000)]
    quantidade: Annotated[int, Field(strict=True, ge=1, le=10)]


class TransacaoIn(Modelo):
    comprador: CompradorIn
    itens: Annotated[list[ItemIn], Field(min_length=1, max_length=50)]
    metodoPagamento: Literal["pix", "cartao", "transferencia"]
    totalEsperadoCentavos: Annotated[int, Field(strict=True, ge=0, le=10_000_000_000)]
    idempotencyKey: Annotated[str, StringConstraints(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")]


# ---------------------------------------------------------------- rotas: saúde e configuração

@app.get("/api/saude")
def saude():
    return {"status": "ok"}


@app.get("/js/config.js")
def config_js():
    dados = json.dumps({"apiUrl": "", "imagensUrl": "/imagens" if config.IMAGENS_BLOB_URL else ""})
    return Response(f"window.CONFIG_COMPRACERTA = Object.freeze({dados});\n",
                    media_type="application/javascript")


@app.get("/imagens/{nome}")
def imagem_do_produto(nome: str, request: Request):
    exigir_taxa(request, "imagens", 300)
    try:
        dados = imagens.obter(nome)
    except Exception as exc:
        # Detalhes do storage ficam só no log interno; o cliente recebe 404.
        registrar_evento("imagem_indisponivel", classe=type(exc).__name__)
        dados = None
    if dados is None:
        return Response(status_code=404)
    return Response(dados, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})


# ---------------------------------------------------------------- rotas: autenticação

@app.post("/api/auth/cadastro", status_code=201)
def cadastro(dados: CadastroIn, request: Request):
    exigir_taxa(request, "auth", 10)
    email = dados.email.strip().lower()
    usuario = dados.usuario.strip().lower()
    if not (validacao.email_valido(email) and validacao.usuario_valido(usuario)
            and validacao.senha_valida(dados.senha)):
        registrar_evento("cadastro_recusado", motivo="validacao")
        return erro(400, "cadastro_recusado", mensagem=MENSAGEM_CADASTRO)
    # Hash antes da checagem de duplicidade: o tempo de resposta não revela se a conta existe.
    senha_hash = gerar_hash_senha(dados.senha)
    try:
        with db.engine.begin() as conn:
            conn.execute(insert(db.usuarios).values(
                usuario=usuario, email=email, senha_hash=senha_hash, papel="cliente",
                falhas_login=0, nivel_bloqueio=0, criado_em=agora()))
    except IntegrityError:
        registrar_evento("cadastro_recusado", motivo="duplicado")
        return erro(400, "cadastro_recusado", mensagem=MENSAGEM_CADASTRO)
    return {"ok": True}


@app.post("/api/auth/login")
def login(dados: LoginIn, request: Request):
    exigir_taxa(request, "auth", 10)
    identificador = dados.identificador.strip().lower()
    momento = agora()
    with db.engine.begin() as conn:
        usuario = conn.execute(
            select(db.usuarios).where(or_(db.usuarios.c.usuario == identificador,
                                          db.usuarios.c.email == identificador))
        ).first() if identificador else None

        if usuario:
            falhas_atuais, nivel_atual = usuario.falhas_login, usuario.nivel_bloqueio
            bloqueado_ate = utc(usuario.bloqueado_ate) if usuario.bloqueado_ate else None
        else:
            falhas_atuais, nivel_atual, bloqueado_ate = _falhas_inexistentes.get(identificador, (0, 0, None))
        if bloqueado_ate and momento < bloqueado_ate:
            espera = math.ceil((bloqueado_ate - momento).total_seconds())
            registrar_evento("login_bloqueado", ip=ip_do_cliente(request))
            return erro(429, "bloqueado", esperaSegundos=espera)

        valido = verificar_senha(usuario.senha_hash if usuario else None, dados.senha)
        if not valido:
            espera = 0
            falhas, nivel, ate = falhas_atuais + 1, nivel_atual, None
            if falhas >= FALHAS_ATE_BLOQUEIO:
                nivel = min(nivel + 1, len(ESPERAS_BLOQUEIO_S))
                espera = ESPERAS_BLOQUEIO_S[nivel - 1]
                ate, falhas = momento + timedelta(seconds=espera), 0
            if usuario:
                conn.execute(update(db.usuarios).where(db.usuarios.c.id == usuario.id)
                             .values(falhas_login=falhas, nivel_bloqueio=nivel, bloqueado_ate=ate))
            elif identificador:
                if len(_falhas_inexistentes) > 10000:
                    _falhas_inexistentes.clear()
                _falhas_inexistentes[identificador[:254]] = (falhas, nivel, ate)
            registrar_evento("login_falhou", ip=ip_do_cliente(request))
            if espera:
                return erro(429, "bloqueado", esperaSegundos=espera)
            return erro(401, "credenciais_invalidas")

        valores = {"falhas_login": 0, "nivel_bloqueio": 0, "bloqueado_ate": None}
        if precisa_rehash(usuario.senha_hash):
            valores["senha_hash"] = gerar_hash_senha(dados.senha)
        conn.execute(update(db.usuarios).where(db.usuarios.c.id == usuario.id).values(**valores))
        conn.execute(delete(db.sessoes).where(db.sessoes.c.expira_em < momento))
        token = novo_token()
        expira = momento + timedelta(seconds=config.INATIVIDADE_S)
        conn.execute(insert(db.sessoes).values(
            token_hash=hash_token(token), usuario_id=usuario.id, criada_em=momento,
            ultima_atividade=momento, expira_em=expira))

    resposta = JSONResponse({"usuario": usuario.usuario, "papel": usuario.papel,
                             "expiraEm": int(expira.timestamp() * 1000)})
    _definir_cookie(resposta, token)
    return resposta


@app.post("/api/auth/logout", status_code=204)
def logout(request: Request):
    token = request.cookies.get(config.NOME_COOKIE)
    if token and len(token) <= 100:
        with db.engine.begin() as conn:
            conn.execute(delete(db.sessoes).where(db.sessoes.c.token_hash == hash_token(token)))
    resposta = Response(status_code=204)
    _apagar_cookie(resposta)
    return resposta


@app.get("/api/auth/sessao")
def sessao(sessao_atual: Annotated[dict, Depends(exigir_login)]):
    return _resumo_sessao(sessao_atual)


# ---------------------------------------------------------------- rotas: pedidos

def _assinatura(dados: TransacaoIn) -> str:
    canonico = json.dumps({
        "itens": sorted((i.id, i.quantidade) for i in dados.itens),
        "metodo": dados.metodoPagamento,
        "total": dados.totalEsperadoCentavos,
    }, sort_keys=True)
    return hashlib.sha256(canonico.encode("utf-8")).hexdigest()


def _resposta_pedido(pedido) -> dict:
    return {"transacaoId": pedido.transacao_id, "status": pedido.status, "totalCentavos": pedido.total_centavos}


def _pedido_existente(conn, chave: str, usuario_id: int, assinatura: str):
    existente = conn.execute(select(db.pedidos).where(db.pedidos.c.idempotency_key == chave)).first()
    if not existente:
        return None
    if existente.usuario_id != usuario_id or existente.assinatura != assinatura:
        raise HTTPException(409, "pedido_conflitante")
    return _resposta_pedido(existente)


@app.post("/api/transacao")
def transacao(dados: TransacaoIn, request: Request,
              sessao_atual: Annotated[dict, Depends(exigir_login)]):
    exigir_taxa(request, "transacao", 20)
    comprador = dados.comprador
    if not (validacao.nome_valido(comprador.nome) and validacao.cpf_valido(comprador.cpf)
            and validacao.email_valido(comprador.email.strip()) and validacao.telefone_valido(comprador.telefone)):
        registrar_evento("validacao_falhou", rota="transacao")
        return erro(400, "dados_invalidos")
    ids = [item.id for item in dados.itens]
    if len(set(ids)) != len(ids):
        return erro(400, "itens_duplicados")

    assinatura = _assinatura(dados)
    usuario_id = sessao_atual["usuario_id"]
    try:
        with db.engine.begin() as conn:
            repetido = _pedido_existente(conn, dados.idempotencyKey, usuario_id, assinatura)
            if repetido:
                return repetido

            catalogo = {p.id: p for p in conn.execute(select(db.produtos).where(db.produtos.c.id.in_(ids)))}
            if len(catalogo) != len(ids):
                return erro(400, "produto_invalido")

            # Preço, frete e total calculados aqui, a partir do banco — nunca do cliente.
            subtotal = sum(catalogo[i.id].preco_centavos * i.quantidade for i in dados.itens)
            frete = 0 if subtotal >= FRETE_GRATIS_A_PARTIR_CENTAVOS else FRETE_PADRAO_CENTAVOS
            total = subtotal + frete
            if total != dados.totalEsperadoCentavos:
                registrar_evento("valor_divergente", usuario_id=usuario_id)
                return erro(422, "valor_divergente", totalCentavos=total)

            for item in sorted(dados.itens, key=lambda i: i.id):
                baixa = conn.execute(
                    update(db.produtos)
                    .where(db.produtos.c.id == item.id, db.produtos.c.estoque >= item.quantidade)
                    .values(estoque=db.produtos.c.estoque - item.quantidade))
                if baixa.rowcount != 1:
                    raise HTTPException(409, "estoque_insuficiente")

            transacao_id = "TX-" + secrets.token_hex(8).upper()
            pedido_id = conn.execute(insert(db.pedidos).values(
                transacao_id=transacao_id, idempotency_key=dados.idempotencyKey, assinatura=assinatura,
                usuario_id=usuario_id, metodo_pagamento=dados.metodoPagamento,
                subtotal_centavos=subtotal, frete_centavos=frete, total_centavos=total, status="aprovado",
                comprador_nome=validacao.normalizar_nome(comprador.nome),
                comprador_email=comprador.email.strip().lower(),
                comprador_telefone=validacao.apenas_digitos(comprador.telefone),
                comprador_cpf_final=validacao.apenas_digitos(comprador.cpf)[-2:],
                criado_em=agora(),
            )).inserted_primary_key[0]
            conn.execute(insert(db.itens_pedido), [
                {"pedido_id": pedido_id, "produto_id": i.id, "quantidade": i.quantidade,
                 "preco_unitario_centavos": catalogo[i.id].preco_centavos}
                for i in dados.itens
            ])
    except IntegrityError:
        # Duas requisições simultâneas com a mesma chave: devolve o pedido já gravado.
        with db.engine.begin() as conn:
            repetido = _pedido_existente(conn, dados.idempotencyKey, usuario_id, assinatura)
        if repetido:
            return repetido
        raise
    registrar_evento("pedido_criado", usuario_id=usuario_id, total=total)
    return {"transacaoId": transacao_id, "status": "aprovado", "totalCentavos": total}


@app.get("/api/pedidos")
def meus_pedidos(sessao_atual: Annotated[dict, Depends(exigir_login)]):
    """Histórico isolado: cada cliente vê apenas os próprios pedidos."""
    with db.engine.connect() as conn:
        lista = conn.execute(
            select(db.pedidos).where(db.pedidos.c.usuario_id == sessao_atual["usuario_id"])
            .order_by(db.pedidos.c.criado_em.desc()).limit(50)
        ).all()
        ids = [p.id for p in lista]
        itens = conn.execute(
            select(db.itens_pedido.c.pedido_id, db.itens_pedido.c.quantidade,
                   db.itens_pedido.c.preco_unitario_centavos, db.produtos.c.nome)
            .join(db.produtos, db.produtos.c.id == db.itens_pedido.c.produto_id)
            .where(db.itens_pedido.c.pedido_id.in_(ids))
        ).all() if ids else []
    por_pedido: dict[int, list] = {}
    for item in itens:
        por_pedido.setdefault(item.pedido_id, []).append(
            {"nome": item.nome, "quantidade": item.quantidade, "precoCentavos": item.preco_unitario_centavos})
    return {"pedidos": [{
        "transacaoId": p.transacao_id,
        "data": utc(p.criado_em).isoformat(),
        "metodoPagamento": p.metodo_pagamento,
        "status": p.status,
        "totalCentavos": p.total_centavos,
        "itens": por_pedido.get(p.id, []),
    } for p in lista]}


# ---------------------------------------------------------------- rotas: painel financeiro

@app.get("/api/painel")
def painel(_sessao: Annotated[dict, Depends(exigir_painel)]):
    momento = agora()
    hoje = momento.astimezone(FUSO).date()
    dias = [hoje - timedelta(days=d) for d in range(6, -1, -1)]
    with db.engine.connect() as conn:
        clientes = conn.execute(select(func.count()).select_from(db.usuarios)
                                .where(db.usuarios.c.papel == "cliente")).scalar_one()
        recentes = conn.execute(
            select(db.pedidos.c.criado_em, db.pedidos.c.total_centavos)
            .where(db.pedidos.c.criado_em >= momento - timedelta(days=8))).all()
        estoque_baixo = conn.execute(
            select(func.count()).select_from(db.produtos)
            .where(db.produtos.c.estoque > 0, db.produtos.c.estoque <= 10)).scalar_one()
        estoque = conn.execute(
            select(db.produtos.c.categoria, func.sum(db.produtos.c.estoque))
            .group_by(db.produtos.c.categoria).order_by(db.produtos.c.categoria)).all()
        transacoes = conn.execute(
            select(db.pedidos.c.transacao_id, db.pedidos.c.criado_em, db.pedidos.c.metodo_pagamento,
                   db.pedidos.c.total_centavos, db.pedidos.c.status)
            .order_by(db.pedidos.c.criado_em.desc()).limit(10)).all()

    receita = {d: 0 for d in dias}
    pedidos_semana = 0
    for criado, total in recentes:
        dia = utc(criado).astimezone(FUSO).date()
        if dia in receita:
            receita[dia] += total
            pedidos_semana += 1
    return {
        "clientes": clientes,
        "pedidosSemana": pedidos_semana,
        "receitaSemanaCentavos": sum(receita.values()),
        "estoqueBaixo": estoque_baixo,
        "vendasPorDia": [{"data": d.isoformat(), "totalCentavos": receita[d]} for d in dias],
        "estoquePorCategoria": [{"categoria": c, "unidades": int(u or 0)} for c, u in estoque],
        "transacoes": [{
            "transacaoId": t.transacao_id, "data": utc(t.criado_em).isoformat(),
            "metodoPagamento": t.metodo_pagamento, "totalCentavos": t.total_centavos, "status": t.status,
        } for t in transacoes],
    }


# ---------------------------------------------------------------- site estático (por último)

app.mount("/", StaticFiles(directory=config.SITE_DIR, html=True, check_dir=False), name="site")
