/**
 * home.js
 * Página inicial: cabeçalho de conta, vitrines de produtos e categorias.
 * Depende de PRODUTOS/CATEGORIAS (data/produtos.js), de el/imagemSegura/
 * estrelasTexto (js/dom.js), de formatarCentavos (js/carrinho.js) e de
 * obterSessao/encerrarSessao (js/auth.js).
 */

function criarCardHome(produto) {
  return el("a", { className: "product-card", href: "pages/produto.html?id=" + encodeURIComponent(produto.id) },
    el("div", { className: "product-card-image" },
      imagemSegura(produto.imagem, produto.imagemFallback, produto.nome, { loading: "lazy" }),
      produto.desconto ? el("span", { className: "product-badge", text: "-" + produto.desconto + "%" }) : null
    ),
    el("div", { className: "product-card-body" },
      el("span", { className: "product-card-category", text: produto.categoria }),
      el("h3", { className: "product-card-name", text: produto.nome }),
      el("div", { className: "product-card-rating" },
        el("span", { className: "stars", "aria-hidden": "true", text: estrelasTexto(produto.avaliacao) }),
        el("span", { className: "rating-count", text: "(" + produto.numeroAvaliacoes + ")" })
      ),
      el("div", { className: "product-card-price" },
        produto.precoAnterior ? el("span", { className: "price-old", text: formatarMoeda(produto.precoAnterior) }) : null,
        el("span", { className: "price-current", text: formatarCentavos(produto.precoCentavos) })
      )
    )
  );
}

function montarCabecalhoConta() {
  const sessao = obterSessao();
  if (!sessao) return;
  document.getElementById("texto-conta").textContent = sessao.usuario;
  document.getElementById("link-pedidos").hidden = false;
  document.getElementById("link-seguranca").hidden = false;
  if (["financeiro", "ceo"].includes(sessao.papel)) document.getElementById("link-painel").hidden = false;
  const botaoSair = document.getElementById("botao-sair");
  botaoSair.hidden = false;
  botaoSair.addEventListener("click", async () => {
    await encerrarSessao();
    window.location.href = "pages/login.html";
  });
}

document.addEventListener("DOMContentLoaded", () => {
  montarCabecalhoConta();

  const destaque = [...PRODUTOS]
    .filter((produto) => produto.quantidadeEstoque > 0 && produto.desconto)
    .sort((a, b) => b.desconto - a.desconto)
    .slice(0, 8);

  const idsDestaque = new Set(destaque.map((produto) => produto.id));
  const recomendados = [...PRODUTOS]
    .filter((produto) => produto.quantidadeEstoque > 0 && !idsDestaque.has(produto.id))
    .sort((a, b) => b.avaliacao - a.avaliacao)
    .slice(0, 8);

  document.getElementById("grade-destaque").replaceChildren(...destaque.map(criarCardHome));
  document.getElementById("grade-recomendados").replaceChildren(...recomendados.map(criarCardHome));

  document.getElementById("grade-categorias").replaceChildren(...CATEGORIAS.map((categoria) =>
    el("a", {
      className: "category-tile",
      href: "pages/produtos.html?categoria=" + encodeURIComponent(categoria),
      text: categoria,
    })
  ));
});
