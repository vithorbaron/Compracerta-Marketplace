"""Regras de validação — as mesmas de site/js/validacao.js."""
import re
import unicodedata

RE_EMAIL = re.compile(
    r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
    r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$"
)
RE_USUARIO = re.compile(r"^[a-z0-9_]{3,20}$")

SENHAS_COMUNS = {
    "password", "123456", "123456789", "12345678", "12345", "qwerty", "abc123",
    "password1", "111111", "123123", "senha", "senha123", "admin", "admin123",
    "iloveyou", "welcome", "brasil", "mudar123", "teste123", "qwerty123",
    "password1!", "password@1", "p@ssw0rd", "p@ssword1", "p@ssw0rd1",
    "senha@123", "senha123!", "senha@1234", "admin@123", "admin123!",
    "mudar@123", "mudar123!", "teste@123", "teste123!", "brasil@123",
    "brasil@2024", "brasil@2025", "brasil@2026", "qwerty@123", "qwerty123!",
    "abc@1234", "abc12345!", "welcome@1", "welcome1!", "bemvindo@1",
    "mudar@2024", "mudar@2025", "mudar@2026", "compra@123", "trocar@123",
}

DDDS_VALIDOS = {
    11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
    41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
    71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
}

METODOS_PAGAMENTO = ("pix", "cartao", "transferencia")
PAPEIS = ("cliente", "financeiro", "ceo", "rede", "seguranca")


def apenas_digitos(valor: str) -> str:
    return re.sub(r"\D", "", valor or "")


def email_valido(valor: str) -> bool:
    return isinstance(valor, str) and len(valor) <= 254 and bool(RE_EMAIL.match(valor))


def usuario_valido(valor: str) -> bool:
    return isinstance(valor, str) and bool(RE_USUARIO.match(valor))


def senha_valida(valor: str) -> bool:
    if not isinstance(valor, str) or not 8 <= len(valor) <= 128:
        return False
    regras = (r"[a-z]", r"[A-Z]", r"[0-9]", r"[^A-Za-z0-9]")
    if not all(re.search(r, valor) for r in regras):
        return False
    return valor.lower() not in SENHAS_COMUNS


def cpf_valido(valor: str) -> bool:
    if not isinstance(valor, str) or len(valor) > 14:
        return False
    cpf = apenas_digitos(valor)
    if len(cpf) != 11 or cpf == cpf[0] * 11:
        return False
    for posicao in (9, 10):
        soma = sum(int(cpf[i]) * (posicao + 1 - i) for i in range(posicao))
        if (soma * 10) % 11 % 10 != int(cpf[posicao]):
            return False
    return True


def normalizar_nome(valor: str) -> str:
    return re.sub(r"\s+", " ", (valor or "").strip())


def nome_valido(valor: str) -> bool:
    nome = normalizar_nome(valor)
    if not 3 <= len(nome) <= 100:
        return False
    if not nome[0].isalpha():
        return False
    return all(c.isalpha() or c in " '-" or unicodedata.category(c).startswith("M") for c in nome)


def telefone_valido(valor: str) -> bool:
    if not isinstance(valor, str) or len(valor) > 20:
        return False
    digitos = apenas_digitos(valor)
    if len(digitos) not in (10, 11):
        return False
    if int(digitos[:2]) not in DDDS_VALIDOS:
        return False
    if len(digitos) == 11:
        return digitos[2] == "9"
    return digitos[2] in "2345678"
