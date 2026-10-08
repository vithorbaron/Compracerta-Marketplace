/**
 * produtos.js
 * Controla a página de catálogo: busca + categoria + paginação combinadas,
 * tudo renderizado no cliente (sem recarregar a página).
 * Depende de PRODUTOS/CATEGORIAS (data/produtos.js), de el/imagemSegura/
 * estrelasTexto (js/dom.js) e de formatarCentavos (js/carrinho.js), então esses
 * arquivos devem ser incluídos antes deste.
 *
 * A05: parâmetros da URL são validados (busca ≤ 100 caracteres, categoria só
 * da lista CATEGORIAS, página inteira ≥ 1) e nada é inserido como HTML.
 */

const PRODUTOS_POR_PAGINA = 12;
const LIMITE_BUSCA = 100;

const estadoCatalogo = {
  pagina: 1,
  busca: "",
  categoria: "Todas",
};

function normalizarBusca(valor) {
  return String(valor || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, LIMITE_BUSCA);
}

function inicializarEstadoAPartirDaURL() {
  const params = new URLSearchParams(window.location.search);
  estadoCatalogo.busca = normalizarBusca(params.get("busca"));

  const categoria = params.get("categoria");
  estadoCatalogo.categoria = CATEGORIAS.includes(categoria) ? categoria : "Todas";

  const pagina = params.get("pagina");
  estadoCatalogo.pagina = /^[1-9][0-9]{0,3}$/.test(pagina || "") ? Number(pagina) : 1;
}

function filtrarProdutos() {
  const termo = estadoCatalogo.busca.trim().toLowerCase();

  return PRODUTOS.filter((produto) => {
    const combinaCategoria =
      estadoCatalogo.categoria === "Todas" || produto.categoria === estadoCatalogo.categoria;
    const combinaBusca =
      termo === "" ||
      produto.nome.toLowerCase().includes(termo) ||
      produto.categoria.toLowerCase().includes(termo);
    return combinaCategoria && combinaBusca;
  });
}

function criarCardProduto(produto) {
  return el("a", { className: "product-card", href: "produto.html?id=" + encodeURIComponent(produto.id) },
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
      ),
      produto.quantidadeEstoque === 0 ? el("span", { className: "out-of-stock", text: "Indisponível" }) : null
    )
  );
}

function renderizarProdutos(lista) {
  const container = document.getElementById("grade-produtos");

  if (lista.length === 0) {
    container.replaceChildren(el("p", {
      className: "empty-state",
      text: estadoCatalogo.busca
        ? `Nenhum produto encontrado para "${estadoCatalogo.busca}".`
        : "Nenhum produto encontrado.",
    }));
    return;
  }

  container.replaceChildren(...lista.map(criarCardProduto));
}

function renderizarPaginacao(totalItens) {
  const container = document.getElementById("paginacao");
  if (!container) return;
  container.replaceChildren();

  const totalPaginas = Math.max(1, Math.ceil(totalItens / PRODUTOS_POR_PAGINA));
  if (estadoCatalogo.pagina > totalPaginas) estadoCatalogo.pagina = totalPaginas;

  const botaoAnterior = document.createElement("button");
  botaoAnterior.type = "button";
  botaoAnterior.className = "page-btn page-nav";
  botaoAnterior.textContent = "← Anterior";
  botaoAnterior.disabled = estadoCatalogo.pagina === 1;
  botaoAnterior.addEventListener("click", () => irParaPagina(estadoCatalogo.pagina - 1));
  container.appendChild(botaoAnterior);

  for (let numero = 1; numero <= totalPaginas; numero++) {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "page-btn" + (numero === estadoCatalogo.pagina ? " active" : "");
    botao.textContent = String(numero);
    botao.addEventListener("click", () => irParaPagina(numero));
    container.appendChild(botao);
  }

  const botaoProximo = document.createElement("button");
  botaoProximo.type = "button";
  botaoProximo.className = "page-btn page-nav";
  botaoProximo.textContent = "Próximo →";
  botaoProximo.disabled = estadoCatalogo.pagina === totalPaginas;
  botaoProximo.addEventListener("click", () => irParaPagina(estadoCatalogo.pagina + 1));
  container.appendChild(botaoProximo);
}

function atualizarInfoResultado(totalItens) {
  const info = document.getElementById("resultado-info");
  if (!info) return;

  if (estadoCatalogo.busca) {
    info.textContent = `Pesquisa: "${estadoCatalogo.busca}" — ${totalItens} resultado(s) encontrado(s)`;
  } else if (estadoCatalogo.categoria !== "Todas") {
    info.textContent = `${estadoCatalogo.categoria} — ${totalItens} produto(s)`;
  } else {
    info.textContent = `${totalItens} produto(s)`;
  }
}

function atualizarFiltrosAtivos() {
  document.querySelectorAll("#filtros-categoria [data-categoria]").forEach((botao) => {
    botao.classList.toggle("active", botao.dataset.categoria === estadoCatalogo.categoria);
  });
}

function sincronizarURL() {
  const params = new URLSearchParams();
  if (estadoCatalogo.busca) params.set("busca", estadoCatalogo.busca);
  if (estadoCatalogo.categoria !== "Todas") params.set("categoria", estadoCatalogo.categoria);
  if (estadoCatalogo.pagina > 1) params.set("pagina", String(estadoCatalogo.pagina));

  const query = params.toString();
  const novaURL = window.location.pathname + (query ? `?${query}` : "");
  window.history.replaceState({}, "", novaURL);
}

function renderizarCatalogo() {
  const filtrados = filtrarProdutos();
  const inicio = (estadoCatalogo.pagina - 1) * PRODUTOS_POR_PAGINA;
  const itensDaPagina = filtrados.slice(inicio, inicio + PRODUTOS_POR_PAGINA);

  renderizarProdutos(itensDaPagina);
  renderizarPaginacao(filtrados.length);
  atualizarInfoResultado(filtrados.length);
  atualizarFiltrosAtivos();
  sincronizarURL();
}

function irParaPagina(numero) {
  estadoCatalogo.pagina = numero;
  renderizarCatalogo();
  const grade = document.getElementById("grade-produtos");
  if (grade) grade.scrollIntoView({ behavior: "smooth", block: "start" });
}

function selecionarCategoria(categoria) {
  estadoCatalogo.categoria = CATEGORIAS.includes(categoria) ? categoria : "Todas";
  estadoCatalogo.pagina = 1;
  renderizarCatalogo();
}

function pesquisarCatalogo(termo) {
  estadoCatalogo.busca = normalizarBusca(termo);
  estadoCatalogo.pagina = 1;
  renderizarCatalogo();
}

function montarFiltrosCategoria() {
  const container = document.getElementById("filtros-categoria");
  if (!container) return;

  const todas = document.createElement("button");
  todas.type = "button";
  todas.className = "filter-pill";
  todas.textContent = "Todas";
  todas.dataset.categoria = "Todas";
  container.appendChild(todas);

  CATEGORIAS.forEach((categoria) => {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "filter-pill";
    botao.textContent = categoria;
    botao.dataset.categoria = categoria;
    container.appendChild(botao);
  });

  container.querySelectorAll("[data-categoria]").forEach((botao) => {
    botao.addEventListener("click", () => selecionarCategoria(botao.dataset.categoria));
  });
}

document.addEventListener("DOMContentLoaded", () => {
  inicializarEstadoAPartirDaURL();
  montarFiltrosCategoria();

  const campoBusca = document.getElementById("campo-busca");
  if (campoBusca) {
    campoBusca.maxLength = LIMITE_BUSCA;
    campoBusca.value = estadoCatalogo.busca;
  }

  const formBusca = document.getElementById("form-busca");
  if (formBusca) {
    formBusca.addEventListener("submit", (evento) => {
      evento.preventDefault();
      pesquisarCatalogo(campoBusca.value);
    });
  }

  renderizarCatalogo();
});
