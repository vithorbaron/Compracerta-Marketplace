"""Baixa as fotos do catálogo e remove os metadados antes do envio ao Blob Storage.

Uso (só Python, sem instalar nada):

    python preparar_imagens.py                  # baixa e limpa -> pasta imagens/
    python preparar_imagens.py --limpar PASTA   # só limpa os .jpg de uma pasta

Remove EXIF (GPS, aparelho, data), XMP (autor, software), IPTC, perfis e
comentários. Mantém só o necessário para exibir a imagem; nada é recomprimido.
"""
import argparse
import json
import sys
import urllib.request
from pathlib import Path

ORIGENS = Path(__file__).with_name("imagens-origem.json")
PREFIXO_PERMITIDO = "https://images.unsplash.com/"
TAMANHO_MAXIMO = 5 * 1024 * 1024
APP0, APP14, COM, SOS = 0xE0, 0xEE, 0xFE, 0xDA


def limpar_jpeg(dados: bytes) -> bytes:
    """Devolve o JPEG sem os segmentos de metadados (APP1 a APP15, exceto APP14, e COM)."""
    if not dados.startswith(b"\xff\xd8\xff"):
        raise ValueError("não é JPEG")
    saida = bytearray(b"\xff\xd8")
    i = 2
    while i + 1 < len(dados):
        if dados[i] != 0xFF:
            raise ValueError("JPEG malformado")
        marcador = dados[i + 1]
        if marcador == 0xFF:  # preenchimento
            i += 1
            continue
        if marcador == SOS:  # daqui em diante são os dados da imagem
            saida += dados[i:]
            return bytes(saida)
        if 0xD0 <= marcador <= 0xD7 or marcador == 0x01:  # marcadores sem tamanho
            saida += dados[i:i + 2]
            i += 2
            continue
        fim = i + 2 + int.from_bytes(dados[i + 2:i + 4], "big")
        eh_metadado = (APP0 < marcador <= 0xEF and marcador != APP14) or marcador == COM
        if not eh_metadado:
            saida += dados[i:fim]
        i = fim
    raise ValueError("JPEG sem dados de imagem")


def tem_metadados(dados: bytes) -> bool:
    return limpar_jpeg(dados) != dados


def baixar(url: str) -> bytes:
    if not url.startswith(PREFIXO_PERMITIDO):
        raise ValueError("origem não permitida")
    with urllib.request.urlopen(url, timeout=60) as resposta:
        dados = resposta.read(TAMANHO_MAXIMO + 1)
    if len(dados) > TAMANHO_MAXIMO:
        raise ValueError("arquivo grande demais")
    return dados


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--limpar", metavar="PASTA", help="só limpa os .jpg de uma pasta existente")
    parser.add_argument("--saida", default="imagens", help="pasta de saída (padrão: imagens)")
    args = parser.parse_args()

    if args.limpar:
        arquivos = sorted(Path(args.limpar).glob("*.jpg"))
        destino = Path(args.limpar)
        itens = [(a.name, a.read_bytes()) for a in arquivos]
    else:
        destino = Path(args.saida)
        destino.mkdir(exist_ok=True)
        itens = []
        for item in json.loads(ORIGENS.read_text(encoding="utf-8")):
            nome = f"produto-{int(item['id'])}.jpg"
            itens.append((nome, baixar(item["url"])))
            print("baixada:", nome)

    for nome, dados in itens:
        limpo = limpar_jpeg(dados)
        if tem_metadados(limpo):
            raise SystemExit(f"Ainda há metadados em {nome}")
        (destino / nome).write_bytes(limpo)
    print(f"{len(itens)} imagens sem metadados em: {destino.resolve()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
