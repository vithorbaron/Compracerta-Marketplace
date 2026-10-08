"""Administração pela linha de comando (rodar no console SSH do App Service).

  python -m app.admin criar-usuario --usuario ana_fin --email ana@exemplo.com --papel financeiro
  python -m app.admin definir-papel --usuario ana_fin --papel ceo
  python -m app.admin listar-usuarios

A senha é pedida no terminal (não aparece na tela nem no histórico).
"""
import argparse
import getpass
import sys
from datetime import datetime, timezone

from sqlalchemy import insert, select, update
from sqlalchemy.exc import IntegrityError

from . import db, validacao
from .seguranca import gerar_hash_senha


def criar_usuario(args) -> int:
    usuario, email = args.usuario.strip().lower(), args.email.strip().lower()
    if not validacao.usuario_valido(usuario) or not validacao.email_valido(email):
        print("Usuário ou e-mail inválido.")
        return 1
    senha = getpass.getpass("Senha: ")
    if senha != getpass.getpass("Repita a senha: "):
        print("As senhas não conferem.")
        return 1
    if not validacao.senha_valida(senha):
        print("Senha fraca: 8 a 128 caracteres, com minúscula, maiúscula, número e especial.")
        return 1
    try:
        with db.engine.begin() as conn:
            conn.execute(insert(db.usuarios).values(
                usuario=usuario, email=email, senha_hash=gerar_hash_senha(senha), papel=args.papel,
                falhas_login=0, nivel_bloqueio=0, criado_em=datetime.now(timezone.utc)))
    except IntegrityError:
        print("Já existe uma conta com esse usuário ou e-mail.")
        return 1
    print(f"Conta '{usuario}' criada com papel '{args.papel}'.")
    return 0


def definir_papel(args) -> int:
    with db.engine.begin() as conn:
        resultado = conn.execute(update(db.usuarios)
                                 .where(db.usuarios.c.usuario == args.usuario.strip().lower())
                                 .values(papel=args.papel))
    if resultado.rowcount != 1:
        print("Usuário não encontrado.")
        return 1
    print(f"Papel de '{args.usuario}' alterado para '{args.papel}'.")
    return 0


def listar_usuarios(_args) -> int:
    with db.engine.connect() as conn:
        for linha in conn.execute(select(db.usuarios.c.usuario, db.usuarios.c.papel, db.usuarios.c.criado_em)
                                  .order_by(db.usuarios.c.criado_em)):
            print(f"{linha.usuario:<22}{linha.papel:<12}{linha.criado_em:%Y-%m-%d %H:%M}")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.admin")
    sub = parser.add_subparsers(dest="comando", required=True)

    criar = sub.add_parser("criar-usuario")
    criar.add_argument("--usuario", required=True)
    criar.add_argument("--email", required=True)
    criar.add_argument("--papel", choices=validacao.PAPEIS, default="cliente")
    criar.set_defaults(funcao=criar_usuario)

    papel = sub.add_parser("definir-papel")
    papel.add_argument("--usuario", required=True)
    papel.add_argument("--papel", choices=validacao.PAPEIS, required=True)
    papel.set_defaults(funcao=definir_papel)

    listar = sub.add_parser("listar-usuarios")
    listar.set_defaults(funcao=listar_usuarios)

    args = parser.parse_args(argv)
    db.inicializar()
    return args.funcao(args)


if __name__ == "__main__":
    sys.exit(main())
