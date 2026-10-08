# CompraCerta — Marketplace

E-commerce fictício desenvolvido como projeto acadêmico (Projeto Integrador II — NuvemPay):
catálogo, carrinho, checkout em 3 etapas, cadastro/login, histórico de pedidos e painel
do operador financeiro.

> Projeto acadêmico: nenhum produto é vendido de verdade e nenhum pagamento real é processado.

## Estrutura

| Caminho | Conteúdo |
|---|---|
| `site/` | Página web (HTML, CSS e JavaScript puro) |
| `api/` | API em Python (FastAPI), que também entrega a página |
| `infra/` | Infraestrutura no Azure (Bicep) |
| `.github/workflows/` | Publicação automática no Azure |

Serviços no Azure: App Service (página e API), Azure Database for PostgreSQL
(clientes, produtos e transações), Blob Storage (imagens dos produtos), Key Vault,
Log Analytics e Microsoft Entra ID com Azure RBAC para os operadores.

## Rodar localmente

Requer Python 3.11 ou mais novo.

```bash
cd api
python -m venv .venv
# Windows: .venv\Scripts\activate    |    Linux/Mac: source .venv/bin/activate
pip install -r requirements.txt
```

Linux/Mac:
```bash
COOKIE_SEGURO=0 python -m uvicorn app.main:app --port 8000
```

Windows (PowerShell):
```powershell
$env:COOKIE_SEGURO="0"; python -m uvicorn app.main:app --port 8000
```

Abra http://localhost:8000. Localmente os dados ficam num arquivo SQLite (`compracerta-local.db`).
