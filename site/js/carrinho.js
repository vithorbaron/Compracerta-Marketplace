/**
 * carrinho.js
 * Carrinho de compras compartilhado por todas as páginas (localStorage).
 *
 * Integridade (A06/A08): o carrinho persistido guarda SOMENTE {id, quantidade}.
 * Nome, imagem e preço vêm sempre de PRODUTOS (data/produtos.js) pelo id, e
 * todo valor monetário é calculado em centavos inteiros. Cada leitura passa
 * por normalizarCarrinho(), que descarta e corrige dados inválidos.
 * O valor cobrado é confirmado pela API.
 *
 * Renderização (A05): nenhum dado vira HTML; os nós são montados com el().
 * Este arquivo não faz requisições de rede.
 */

const CHAVE_CARRINHO = "ecommerce_carrinho";
const LIMITE_POR_PRODUTO = 10;
const LIMITE_ITENS_CARRINHO = 50;
const LIMITE_BYTES_CARRINHO = 20 * 1024;
const FRETE_PADRAO_CENTAVOS = 1990;
const FRETE_GRATIS_A_PARTIR_CENTAVOS = 30000;

function formatarMoeda(valorEmReais) {
  const numero = Number(valorEmReais);
  return (Number.isFinite(numero) ? numero : 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatarCentavos(centavos) {
  return formatarMoeda((Number.isSafeInteger(centavos) ? centavos : 0) / 100);
}

function buscarProduto(id) {
  if (!Number.isInteger(id) || typeof PRODUTOS === "undefined") return null;
  return PRODUTOS.find(function (produto) { return produto.id === id; }) || null;
}

/** Quantidade máxima permitida para o produto: min(estoque, 10). */
function limiteDoProduto(produto) {
  const estoque = Number.isInteger(produto.quantidadeEstoque) ? produto.quantidadeEstoque : 0;
  return Math.max(0, Math.min(estoque, LIMITE_POR_PRODUTO));
}

function limitarQuantidade(valor, limite) {
  const numero = Number(valor);
  const inteiro = Number.isFinite(numero) ? Math.trunc(numero) : 1;
  return Math.min(Math.max(inteiro, 1), limite);
}

/**
 * Lê o carrinho do storage e devolve uma lista confiável de {id, quantidade}:
 * descarta itens com id inválido ou fora do catálogo, força a quantidade para
 * 1..min(estoque,10), junta ids repetidos, limita a 50 itens / 20 KB e regrava
 * o resultado já saneado.
 */
function normalizarCarrinho() {
  const bruto = Armazenamento.lerTexto("local", CHAVE_CARRINHO);
  if (bruto === null) return [];

  let lista = [];
  if (bruto.length <= LIMITE_BYTES_CARRINHO) {
    try {
      const lido = JSON.parse(bruto);
      if (Array.isArray(lido)) lista = lido;
    } catch (erro) {
      lista = [];
    }
  }

  let removidos = 0;
  const porId = new Map();
  lista.forEach(function (item) {
    const produto = item && typeof item === "object" ? buscarProduto(item.id) : null;
    const limite = produto ? limiteDoProduto(produto) : 0;
    if (!produto || limite === 0) {
      removidos++;
      return;
    }
    const anterior = porId.get(produto.id) || 0;
    porId.set(produto.id, limitarQuantidade(anterior + limitarQuantidade(item.quantidade, limite), limite));
  });

  let normalizado = Array.from(porId, function (par) { return { id: par[0], quantidade: par[1] }; });
  if (normalizado.length > LIMITE_ITENS_CARRINHO) {
    removidos += normalizado.length - LIMITE_ITENS_CARRINHO;
    normalizado = normalizado.slice(0, LIMITE_ITENS_CARRINHO);
  }

  if (JSON.stringify(normalizado) !== bruto) {
    Armazenamento.gravarJSON("local", CHAVE_CARRINHO, normalizado);
    if (window.SegurancaLog) {
      SegurancaLog.registrar("carrinho_saneado", { removidos: removidos, quantidadeItens: normalizado.length });
    }
  }
  return normalizado;
}

function obterCarrinho() {
  return normalizarCarrinho();
}

function salvarCarrinho(carrinho) {
  const somenteIdQuantidade = carrinho.map(function (item) { return { id: item.id, quantidade: item.quantidade }; });
  Armazenamento.gravarJSON("local", CHAVE_CARRINHO, somenteIdQuantidade);
  atualizarContadorCarrinho();
}

/**
 * Adiciona `quantidade` do produto `produtoId`, respeitando o limite.
 * Retorna { ok, quantidade, limite, limitado }.
 */
function adicionarAoCarrinho(produtoId, quantidade) {
  const produto = buscarProduto(produtoId);
  const limite = produto ? limiteDoProduto(produto) : 0;
  if (!produto || limite === 0) return { ok: false, quantidade: 0, limite: 0, limitado: true };

  const carrinho = obterCarrinho();
  const existente = carrinho.find(function (item) { return item.id === produto.id; });
  const atual = existente ? existente.quantidade : 0;
  const pedido = atual + limitarQuantidade(quantidade, limite);
  const final = Math.min(pedido, limite);

  if (existente) existente.quantidade = final;
  else carrinho.push({ id: produto.id, quantidade: final });

  salvarCarrinho(carrinho);
  return { ok: true, quantidade: final, limite: limite, limitado: pedido > limite };
}

function removerDoCarrinho(id) {
  salvarCarrinho(obterCarrinho().filter(function (item) { return item.id !== id; }));
}

/** Retorna { limitado } — true quando o pedido passou do limite permitido. */
function atualizarQuantidadeItem(id, quantidade) {
  let carrinho = obterCarrinho();
  const produto = buscarProduto(id);
  if (!produto) return { limitado: false };
  if (quantidade <= 0) {
    salvarCarrinho(carrinho.filter(function (item) { return item.id !== id; }));
    return { limitado: false };
  }
  const limite = limiteDoProduto(produto);
  carrinho = carrinho.map(function (item) {
    return item.id === id ? { id: id, quantidade: limitarQuantidade(quantidade, limite) } : item;
  });
  salvarCarrinho(carrinho);
  return { limitado: quantidade > limite };
}

function limparCarrinho() {
  Armazenamento.remover("local", CHAVE_CARRINHO);
  atualizarContadorCarrinho();
}

/** Itens com os dados do catálogo anexados (para exibição). */
function itensDetalhados(carrinho) {
  return (carrinho || obterCarrinho())
    .map(function (item) {
      const produto = buscarProduto(item.id);
      return produto ? { id: item.id, quantidade: item.quantidade, produto: produto } : null;
    })
    .filter(Boolean);
}

function calcularResumoCarrinho(carrinho) {
  let subtotalCentavos = 0;
  let quantidadeItens = 0;
  itensDetalhados(carrinho).forEach(function (item) {
    subtotalCentavos += item.produto.precoCentavos * item.quantidade;
    quantidadeItens += item.quantidade;
  });
  const freteCentavos = subtotalCentavos === 0 || subtotalCentavos >= FRETE_GRATIS_A_PARTIR_CENTAVOS ? 0 : FRETE_PADRAO_CENTAVOS;
  return {
    quantidadeItens: quantidadeItens,
    subtotalCentavos: subtotalCentavos,
    freteCentavos: freteCentavos,
    totalCentavos: subtotalCentavos + freteCentavos,
  };
}

function atualizarContadorCarrinho() {
  const badge = document.getElementById("contador-carrinho");
  if (!badge) return;
  const quantidade = calcularResumoCarrinho().quantidadeItens;
  badge.textContent = String(quantidade);
  badge.hidden = quantidade === 0;
}

document.addEventListener("DOMContentLoaded", atualizarContadorCarrinho);

/**
 * Renderiza a página carrinho.html. Nas demais páginas não faz nada.
 */
function renderizarPaginaCarrinho() {
  const containerLista = document.getElementById("lista-carrinho");
  if (!containerLista) return;
  const aviso = document.getElementById("aviso-limite");

  function avisar(mensagem) {
    if (!aviso) return;
    aviso.textContent = mensagem || "";
    aviso.hidden = !mensagem;
  }

  function criarLinha(item) {
    const produto = item.produto;
    return el("div", { className: "cart-item", dataset: { id: item.id } },
      el("div", { className: "cart-item-image" },
        imagemSegura(produto.imagem, produto.imagemFallback, produto.nome)
      ),
      el("div", { className: "cart-item-info" },
        el("span", { className: "cart-item-nome", text: produto.nome }),
        el("span", { className: "cart-item-preco-unit", text: formatarCentavos(produto.precoCentavos) + " cada" }),
        el("div", { className: "cart-item-controls" },
          el("div", { className: "qty-stepper-sm" },
            el("button", { type: "button", dataset: { acao: "diminuir" }, "aria-label": "Diminuir quantidade", text: "−" }),
            el("span", { text: String(item.quantidade) }),
            el("button", { type: "button", dataset: { acao: "aumentar" }, "aria-label": "Aumentar quantidade", text: "+" })
          ),
          el("span", { className: "cart-item-subtotal", text: formatarCentavos(produto.precoCentavos * item.quantidade) })
        ),
        el("button", { type: "button", className: "cart-item-remove", dataset: { acao: "remover" }, text: "Remover" })
      )
    );
  }

  function desenharCarrinho() {
    const carrinho = obterCarrinho();
    const vazio = document.getElementById("carrinho-vazio");
    const conteudo = document.getElementById("carrinho-conteudo");

    if (carrinho.length === 0) {
      vazio.hidden = false;
      conteudo.hidden = true;
      return;
    }

    vazio.hidden = true;
    conteudo.hidden = false;
    containerLista.replaceChildren.apply(containerLista, itensDetalhados(carrinho).map(criarLinha));

    const resumo = calcularResumoCarrinho(carrinho);
    document.getElementById("resumo-subtotal").textContent = formatarCentavos(resumo.subtotalCentavos);
    document.getElementById("resumo-frete").textContent = resumo.freteCentavos === 0 ? "Grátis" : formatarCentavos(resumo.freteCentavos);
    document.getElementById("resumo-total").textContent = formatarCentavos(resumo.totalCentavos);
    atualizarContadorCarrinho();
  }

  containerLista.addEventListener("click", function (evento) {
    const botao = evento.target.closest("button[data-acao]");
    const linha = evento.target.closest(".cart-item");
    if (!botao || !linha) return;

    const id = Number(linha.dataset.id);
    const item = obterCarrinho().find(function (atual) { return atual.id === id; });
    if (!item) return;

    avisar("");
    if (botao.dataset.acao === "aumentar") {
      const resultado = atualizarQuantidadeItem(id, item.quantidade + 1);
      if (resultado.limitado) avisar("Limite atingido para este produto (estoque disponível ou máximo de " + LIMITE_POR_PRODUTO + " unidades).");
    } else if (botao.dataset.acao === "diminuir") {
      atualizarQuantidadeItem(id, item.quantidade - 1);
    } else if (botao.dataset.acao === "remover") {
      removerDoCarrinho(id);
    }
    desenharCarrinho();
  });

  desenharCarrinho();
}

document.addEventListener("DOMContentLoaded", renderizarPaginaCarrinho);
