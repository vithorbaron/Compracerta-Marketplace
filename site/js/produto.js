/**
 * produto.js
 * Controla a página de detalhes de um único produto (produto.html?id=ID).
 * Depende de PRODUTOS (data/produtos.js), de imagemSegura/estrelasTexto
 * (js/dom.js) e de formatarCentavos / adicionarAoCarrinho (js/carrinho.js),
 * que devem ser incluídos antes deste arquivo.
 *
 * O id da URL só é aceito se for inteiro positivo; o carrinho recebe apenas
 * o id e a quantidade (nunca o objeto do produto) e aplica o limite
 * min(estoque, 10) por conta própria.
 */

let produtoAtual = null;
let quantidadeSelecionada = 1;

function obterIdDaURL() {
  const valor = new URLSearchParams(window.location.search).get("id") || "";
  return /^[1-9][0-9]{0,5}$/.test(valor) ? Number(valor) : null;
}

function renderizarProduto(produto) {
  document.title = `${produto.nome} — CompraCerta`;

  const imagemAntiga = document.getElementById("produto-imagem");
  const imagem = imagemSegura(produto.imagem, produto.imagemFallback, produto.nome, { id: "produto-imagem" });
  imagemAntiga.replaceWith(imagem);

  const avaliacao = Number.isFinite(produto.avaliacao) ? produto.avaliacao : 0;
  document.getElementById("produto-categoria").textContent = produto.categoria;
  document.getElementById("produto-nome").textContent = produto.nome;
  document.getElementById("produto-estrelas").textContent = estrelasTexto(avaliacao);
  document.getElementById("produto-avaliacao-numero").textContent = avaliacao.toFixed(1);
  document.getElementById("produto-numero-avaliacoes").textContent = `(${produto.numeroAvaliacoes} avaliações)`;
  document.getElementById("produto-preco").textContent = formatarCentavos(produto.precoCentavos);
  document.getElementById("produto-descricao").textContent = produto.descricao;

  const precoAnteriorEl = document.getElementById("produto-preco-anterior");
  const descontoEl = document.getElementById("produto-desconto");
  if (produto.precoAnterior && produto.desconto) {
    precoAnteriorEl.textContent = formatarMoeda(produto.precoAnterior);
    precoAnteriorEl.hidden = false;
    descontoEl.textContent = `${produto.desconto}% OFF`;
    descontoEl.hidden = false;
  } else {
    precoAnteriorEl.hidden = true;
    descontoEl.hidden = true;
  }

  document.getElementById("produto-especificacoes").replaceChildren(
    ...(produto.especificacoes || []).map((linha) => el("li", { text: linha }))
  );

  const disponibilidadeEl = document.getElementById("produto-disponibilidade");
  const acoesEl = document.getElementById("produto-acoes");
  const seletorQuantidadeEl = document.getElementById("seletor-quantidade");

  if (produto.quantidadeEstoque > 0) {
    disponibilidadeEl.textContent = `Em estoque (${produto.quantidadeEstoque} unidades disponíveis)`;
    disponibilidadeEl.classList.add("in-stock");
    disponibilidadeEl.classList.remove("out-of-stock");
    acoesEl.hidden = false;
    seletorQuantidadeEl.hidden = false;
  } else {
    disponibilidadeEl.textContent = "Produto indisponível no momento";
    disponibilidadeEl.classList.add("out-of-stock");
    disponibilidadeEl.classList.remove("in-stock");
    acoesEl.hidden = true;
    seletorQuantidadeEl.hidden = true;
  }

  atualizarQuantidadeExibida();
}

function atualizarQuantidadeExibida() {
  document.getElementById("quantidade-valor").textContent = String(quantidadeSelecionada);
}

function alterarQuantidade(delta) {
  if (!produtoAtual) return;
  const maximo = Math.max(1, limiteDoProduto(produtoAtual));
  const nova = quantidadeSelecionada + delta;
  quantidadeSelecionada = Math.min(Math.max(1, nova), maximo);
  atualizarQuantidadeExibida();
  if (nova > maximo) {
    mostrarAviso(`Máximo de ${maximo} unidade(s) deste produto por pedido.`);
  }
}

function mostrarAviso(mensagem) {
  const aviso = document.getElementById("aviso-carrinho");
  if (!aviso) return;
  aviso.textContent = mensagem;
  aviso.hidden = false;
  clearTimeout(mostrarAviso._timeout);
  mostrarAviso._timeout = setTimeout(() => {
    aviso.hidden = true;
  }, 2500);
}

function adicionarSelecionado() {
  const resultado = adicionarAoCarrinho(produtoAtual.id, quantidadeSelecionada);
  if (!resultado.ok) {
    mostrarAviso("Produto indisponível no momento.");
  } else if (resultado.limitado) {
    mostrarAviso(`Limite atingido: o carrinho ficou com ${resultado.quantidade} unidade(s) deste produto.`);
  } else {
    mostrarAviso("Produto adicionado ao carrinho.");
  }
  return resultado;
}

document.addEventListener("DOMContentLoaded", () => {
  const id = obterIdDaURL();
  produtoAtual = id === null ? null : buscarProduto(id);

  const conteudo = document.getElementById("conteudo-produto");
  const naoEncontrado = document.getElementById("produto-nao-encontrado");

  if (!produtoAtual) {
    conteudo.hidden = true;
    naoEncontrado.hidden = false;
    return;
  }

  conteudo.hidden = false;
  naoEncontrado.hidden = true;
  renderizarProduto(produtoAtual);

  document.getElementById("btn-diminuir").addEventListener("click", () => alterarQuantidade(-1));
  document.getElementById("btn-aumentar").addEventListener("click", () => alterarQuantidade(1));

  document.getElementById("btn-adicionar-carrinho").addEventListener("click", adicionarSelecionado);

  document.getElementById("btn-comprar-agora").addEventListener("click", () => {
    if (adicionarSelecionado().ok) window.location.href = "checkout.html";
  });
});
