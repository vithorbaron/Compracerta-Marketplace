"""Administração pela linha de comando (rodar no console SSH do App Service).

  python -m app.admin criar-usuario --usuario ana_fin --email ana@exemplo.com --papel financeiro
  python -m app.admin definir-papel --usuario ana_fin --papel ceo
  python -m app.admin listar-usuarios
  python -m app.admin ativar-mfa --usuario ana_fin     (QR code no terminal)
  python -m app.admin destravar-mfa --usuario ana_fin  (após 10 códigos errados)
  python -m app.admin zerar-mfa --usuario ana_fin      (celular perdido: ativar de novo)

A senha é pedida no terminal (não aparece na tela nem no histórico).
"""
import argparse
import getpass
import sys
from datetime import datetime, timezone

from sqlalchemy import delete, insert, select, update
from sqlalchemy.exc import IntegrityError

from . import db, mfa, validacao
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
        linhas = conn.execute(
            select(db.usuarios.c.usuario, db.usuarios.c.papel, db.usuarios.c.criado_em,
                   db.mfa.c.ativo, db.mfa.c.travado)
            .outerjoin(db.mfa, db.mfa.c.usuario_id == db.usuarios.c.id)
            .order_by(db.usuarios.c.criado_em))
        for linha in linhas:
            situacao = "travado" if linha.travado else ("ativo" if linha.ativo else "-")
            print(f"{linha.usuario:<22}{linha.papel:<12}mfa:{situacao:<9}{linha.criado_em:%Y-%m-%d %H:%M}")
    return 0


def _id_do_usuario(conn, usuario: str) -> int | None:
    return conn.execute(select(db.usuarios.c.id).where(
        db.usuarios.c.usuario == usuario.strip().lower())).scalar_one_or_none()


def ativar_mfa(args) -> int:
    if not mfa.disponivel():
        print("MFA_CHAVE não configurada: defina a chave antes de ativar.")
        return 1
    segredo = mfa.novo_segredo()
    with db.engine.begin() as conn:
        usuario_id = _id_do_usuario(conn, args.usuario)
        if usuario_id is None:
            print("Usuário não encontrado.")
            return 1
        if conn.execute(select(db.mfa.c.ativo).where(db.mfa.c.usuario_id == usuario_id)).scalar():
            print("MFA já está ativo. Para trocar de celular, use zerar-mfa antes.")
            return 1
    nome = args.usuario.strip().lower()
    print(f"Escaneie no aplicativo autenticador (conta: {mfa.EMISSOR} ({nome})):\n")
    mfa.qr_terminal(mfa.uri_otpauth(segredo, nome))
    print(f"\nOu digite a chave manualmente: {mfa.segredo_base32(segredo)}\n")
    for _ in range(3):
        passo = mfa.verificar_totp(segredo, input("Código de 6 dígitos do aplicativo: ").strip(), 0)
        if passo is not None:
            break
        print("Código incorreto. Confira se o horário do celular está automático.")
    else:
        print("MFA não ativado.")
        return 1
    codigos = mfa.novos_codigos_recuperacao()
    with db.engine.begin() as conn:
        conn.execute(delete(db.mfa).where(db.mfa.c.usuario_id == usuario_id))
        conn.execute(insert(db.mfa).values(
            usuario_id=usuario_id, segredo_cifrado=mfa.cifrar(segredo, usuario_id), ativo=True,
            ultimo_passo=passo, falhas=0, travado=False, criado_em=datetime.now(timezone.utc)))
        conn.execute(delete(db.mfa_recuperacao).where(db.mfa_recuperacao.c.usuario_id == usuario_id))
        conn.execute(insert(db.mfa_recuperacao), [
            {"usuario_id": usuario_id, "codigo_hash": mfa.hash_recuperacao(mfa.normalizar_recuperacao(c))}
            for c in codigos])
        conn.execute(delete(db.sessoes).where(db.sessoes.c.usuario_id == usuario_id))
    print("\nMFA ativado. Códigos de recuperação (uso único; guarde num gerenciador de senhas):")
    for codigo in codigos:
        print("  ", codigo)
    return 0


def destravar_mfa(args) -> int:
    with db.engine.begin() as conn:
        usuario_id = _id_do_usuario(conn, args.usuario)
        resultado = conn.execute(update(db.mfa).where(db.mfa.c.usuario_id == usuario_id)
                                 .values(travado=False, falhas=0)) if usuario_id else None
    if not resultado or resultado.rowcount != 1:
        print("Usuário sem MFA ou não encontrado.")
        return 1
    print(f"MFA de '{args.usuario}' destravado. Se a conta travou por erros de código, troque a senha:"
          " quem errou sabia a senha.")
    return 0


def zerar_mfa(args) -> int:
    with db.engine.begin() as conn:
        usuario_id = _id_do_usuario(conn, args.usuario)
        if usuario_id is None:
            print("Usuário não encontrado.")
            return 1
        conn.execute(delete(db.mfa_recuperacao).where(db.mfa_recuperacao.c.usuario_id == usuario_id))
        conn.execute(delete(db.mfa).where(db.mfa.c.usuario_id == usuario_id))
        conn.execute(delete(db.pre_sessoes).where(db.pre_sessoes.c.usuario_id == usuario_id))
        conn.execute(delete(db.sessoes).where(db.sessoes.c.usuario_id == usuario_id))
        conn.execute(delete(db.dispositivos_confiaveis).where(db.dispositivos_confiaveis.c.usuario_id == usuario_id))
    print(f"MFA de '{args.usuario}' removido e sessões encerradas. Ative de novo com ativar-mfa.")
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

    for nome, funcao in (("ativar-mfa", ativar_mfa), ("destravar-mfa", destravar_mfa), ("zerar-mfa", zerar_mfa)):
        comando = sub.add_parser(nome)
        comando.add_argument("--usuario", required=True)
        comando.set_defaults(funcao=funcao)

    args = parser.parse_args(argv)
    db.inicializar()
    return args.funcao(args)


if __name__ == "__main__":
    sys.exit(main())
