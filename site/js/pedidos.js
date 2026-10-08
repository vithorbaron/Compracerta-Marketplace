/**
 * pedidos.js — histórico de pedidos do cliente (pages/pedidos.html).
 * A API devolve apenas os pedidos da conta logada; a resposta é validada
 * campo a campo e exibida só com textContent.
 */
(function () {
  "use strict";

  const NOMES_METODO = { pix: "Pix", cartao: "Cartão", transferencia: "Transferência" };
  const STATUS = { aprovado: "Aprovado", pendente: "Pendente", recusado: "Recusado" };

  function inteiro(valor) {
    return Number.isSafeInteger(valor) && valor >= 0 ? valor : 0;
  }

  function texto(valor, maximo) {
    return typeof valor === "string" ? valor.slice(0, maximo) : "";
  }

  function dataHora(iso) {
    const data = new Date(texto(iso, 40));
    return Number.isNaN(data.getTime()) ? "—" : data.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }

  function cartaoPedido(pedido) {
    const itens = (Array.isArray(pedido.itens) ? pedido.itens : []).slice(0, 50);
    return el("article", { className: "pedido-card" },
      el("header", { className: "pedido-topo" },
        el("span", { className: "pedido-id", text: texto(pedido.transacaoId, 40) }),
        el("span", { className: "pedido-data", text: dataHora(pedido.data) }),
        el("span", { className: "status-pedido", text: STATUS[pedido.status] || "Recebido" })
      ),
      el("ul", { className: "pedido-itens" }, itens.map(function (item) {
        return el("li", {},
          el("span", { text: texto(item.nome, 120) + " × " + inteiro(item.quantidade) }),
          el("span", { text: formatarCentavos(inteiro(item.precoCentavos) * inteiro(item.quantidade)) })
        );
      })),
      el("footer", { className: "pedido-rodape" },
        el("span", { text: NOMES_METODO[pedido.metodoPagamento] || "—" }),
        el("strong", { text: "Total: " + formatarCentavos(inteiro(pedido.totalCentavos)) })
      )
    );
  }

  document.addEventListener("DOMContentLoaded", async function () {
    const aviso = document.getElementById("pedidos-aviso");
    try {
      const r = await chamarApi("GET", "/api/pedidos");
      if (r.status === 401) {
        window.location.replace("login.html");
        return;
      }
      if (!r.ok) throw new ErroApi("Não foi possível carregar seus pedidos agora.", "http", r.status);
      const pedidos = (Array.isArray(r.dados.pedidos) ? r.dados.pedidos : []).slice(0, 50);
      document.getElementById("pedidos-vazio").hidden = pedidos.length > 0;
      const lista = document.getElementById("lista-pedidos");
      lista.replaceChildren.apply(lista, pedidos.map(cartaoPedido));
    } catch (erro) {
      aviso.textContent = erro instanceof ErroApi ? erro.mensagemUsuario : "Não foi possível carregar seus pedidos agora.";
      aviso.hidden = false;
    }
  });
})();
