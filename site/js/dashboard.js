/**
 * dashboard.js
 * Painel do operador financeiro (pages/dashboard.html).
 * Indicadores vêm de GET /api/painel (só para os papéis financeiro e ceo):
 * números agregados, sem dados pessoais.
 * Gráficos em SVG montados com createElementNS — nenhum texto vira markup.
 */
(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  function svg(tag, atributos, texto) {
    const no = document.createElementNS(SVG_NS, tag);
    Object.entries(atributos || {}).forEach(function (par) {
      no.setAttribute(par[0], String(par[1]));
    });
    if (texto !== undefined) no.textContent = String(texto);
    return no;
  }

  function formatarData(diasAtras, hoje) {
    const d = new Date(hoje);
    d.setDate(hoje.getDate() - diasAtras);
    return d.toLocaleDateString("pt-BR");
  }

  function linhasDeGrade(max, padL, padR, padT, plotH, largura, deslocTexto) {
    const nos = [];
    for (let g = 0; g <= 4; g++) {
      const gy = padT + plotH - (plotH * g / 4);
      nos.push(svg("line", { x1: padL, y1: gy.toFixed(1), x2: largura - padR, y2: gy.toFixed(1), stroke: "#E5E7EB", "stroke-width": 1 }));
      nos.push(svg("text", { x: padL - deslocTexto, y: (gy + 4).toFixed(1), "font-size": 10, fill: "#6B7280", "text-anchor": "end" }, Math.round(max * g / 4)));
    }
    return nos;
  }

  function desenharGraficoLinha(elId, rotulos, valores, rotuloAria) {
    const w = 520, h = 220, padL = 44, padR = 16, padT = 16, padB = 34;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const max = (Math.max.apply(null, valores) || 1) * 1.15;
    const n = valores.length;

    const pontos = valores.map(function (v, i) {
      return [padL + (plotW * i / (n - 1)), padT + plotH - (v / max) * plotH];
    });
    const pathLinha = pontos.map(function (p, i) {
      return (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1);
    }).join(" ");
    const pathArea = pathLinha +
      " L" + pontos[n - 1][0].toFixed(1) + "," + (padT + plotH) +
      " L" + pontos[0][0].toFixed(1) + "," + (padT + plotH) + " Z";

    const raiz = svg("svg", { viewBox: "0 0 " + w + " " + h, role: "img", "aria-label": rotuloAria });
    raiz.append.apply(raiz, linhasDeGrade(max, padL, padR, padT, plotH, w, 8));
    raiz.append(
      svg("path", { d: pathArea, fill: "rgba(255,122,26,0.14)", stroke: "none" }),
      svg("path", { d: pathLinha, fill: "none", stroke: "#FF7A1A", "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round" })
    );
    pontos.forEach(function (p, i) {
      raiz.append(
        svg("circle", { cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: 3.5, fill: "#FF7A1A" }),
        svg("text", { x: p[0].toFixed(1), y: h - 10, "font-size": 11, fill: "#6B7280", "text-anchor": "middle" }, rotulos[i])
      );
    });
    document.getElementById(elId).replaceChildren(raiz);
  }

  function desenharGraficoBarras(elId, rotulos, valores, rotuloAria) {
    const w = 520, h = 250, padL = 34, padR = 12, padT = 16, padB = 70;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const n = valores.length;
    const max = (Math.max.apply(null, valores) || 1) * 1.15;
    const gap = 10;
    const barW = (plotW - gap * (n - 1)) / n;

    const raiz = svg("svg", { viewBox: "0 0 " + w + " " + h, role: "img", "aria-label": rotuloAria });
    raiz.append.apply(raiz, linhasDeGrade(max, padL, padR, padT, plotH, w, 6));
    valores.forEach(function (v, i) {
      const x = padL + i * (barW + gap);
      const barH = (v / max) * plotH;
      const y = padT + plotH - barH;
      const lx = (x + barW / 2).toFixed(1), ly = padT + plotH + 16;
      raiz.append(
        svg("rect", { x: x.toFixed(1), y: y.toFixed(1), width: barW.toFixed(1), height: barH.toFixed(1), rx: 5, fill: "#2B6CB0" }),
        svg("text", { x: lx, y: (y - 6).toFixed(1), "font-size": 10, fill: "#374151", "text-anchor": "middle" }, v),
        svg("text", { x: lx, y: ly, "font-size": 9.5, fill: "#6B7280", "text-anchor": "end", transform: "rotate(-40 " + lx + " " + ly + ")" }, rotulos[i])
      );
    });
    document.getElementById(elId).replaceChildren(raiz);
  }

  const NOMES_METODO = { pix: "Pix", cartao: "Cartão", transferencia: "Transferência" };
  const STATUS_CONHECIDOS = ["aprovado", "pendente", "recusado"];
  const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  function inteiro(valor) {
    return Number.isSafeInteger(valor) && valor >= 0 ? valor : 0;
  }

  function texto(valor, maximo) {
    return typeof valor === "string" ? valor.slice(0, maximo) : "";
  }

  function dataCurta(iso) {
    const data = new Date(texto(iso, 40));
    return Number.isNaN(data.getTime()) ? "—" : data.toLocaleDateString("pt-BR");
  }

  function mostrarAviso(mensagem) {
    const aviso = document.getElementById("dashAviso");
    aviso.textContent = mensagem;
    aviso.hidden = false;
  }

  function renderizar(dados) {
    const tiles = [
      { label: "Clientes cadastrados", valor: inteiro(dados.clientes), trend: "contas de clientes", trendClass: "neutral" },
      { label: "Receita dos últimos 7 dias", valor: formatarCentavos(inteiro(dados.receitaSemanaCentavos)), trend: "pedidos aprovados", trendClass: "up" },
      { label: "Pedidos nos últimos 7 dias", valor: inteiro(dados.pedidosSemana), trend: "transações persistidas", trendClass: "up" },
      { label: "Produtos com estoque baixo (≤10un)", valor: inteiro(dados.estoqueBaixo), trend: inteiro(dados.estoqueBaixo) > 0 ? "atenção" : "estoque saudável", trendClass: inteiro(dados.estoqueBaixo) > 0 ? "warn" : "up" },
    ];
    const statGrid = document.getElementById("statGrid");
    statGrid.replaceChildren.apply(statGrid, tiles.map(function (tile) {
      return el("div", { className: "stat-tile" },
        el("span", { className: "stat-label", text: tile.label }),
        el("span", { className: "stat-value", text: tile.valor }),
        el("span", { className: "stat-trend " + tile.trendClass, text: tile.trend })
      );
    }));

    const vendas = (Array.isArray(dados.vendasPorDia) ? dados.vendasPorDia : []).slice(0, 7);
    const rotulos = vendas.map(function (d) {
      const data = new Date(texto(d.data, 10) + "T12:00:00");
      return Number.isNaN(data.getTime()) ? "" : DIAS_SEMANA[data.getDay()];
    });
    if (vendas.length >= 2) {
      desenharGraficoLinha("graficoVendas", rotulos, vendas.map(function (d) { return inteiro(d.totalCentavos) / 100; }),
        "Gráfico de linha com a receita dos últimos 7 dias");
    }

    const estoque = (Array.isArray(dados.estoquePorCategoria) ? dados.estoquePorCategoria : []).slice(0, 20);
    if (estoque.length) {
      desenharGraficoBarras("graficoEstoque", estoque.map(function (e) { return texto(e.categoria, 40); }),
        estoque.map(function (e) { return inteiro(e.unidades); }), "Gráfico de barras com o estoque por categoria");
    }

    const corpoTabela = document.querySelector("#tabelaTransacoes tbody");
    const transacoes = (Array.isArray(dados.transacoes) ? dados.transacoes : []).slice(0, 10);
    corpoTabela.replaceChildren.apply(corpoTabela, transacoes.map(function (t) {
      const status = STATUS_CONHECIDOS.indexOf(t.status) !== -1 ? t.status : "pendente";
      return el("tr", {},
        el("td", { text: texto(t.transacaoId, 40) }),
        el("td", { text: dataCurta(t.data) }),
        el("td", { text: NOMES_METODO[t.metodoPagamento] || "—" }),
        el("td", { text: formatarCentavos(inteiro(t.totalCentavos)) }),
        el("td", {}, el("span", { className: "status-chip " + status, text: status.charAt(0).toUpperCase() + status.slice(1) }))
      );
    }));
    if (!transacoes.length) {
      corpoTabela.append(el("tr", {}, el("td", { colspan: "5", text: "Nenhuma transação ainda." })));
    }
  }

  document.addEventListener("DOMContentLoaded", async function () {
    const sessao = obterSessao();
    document.getElementById("dashUsuario").textContent = sessao ? sessao.usuario : "—";
    document.getElementById("dashSair").addEventListener("click", async function () {
      await encerrarSessao();
      window.location.href = "login.html";
    });

    try {
      const r = await chamarApi("GET", "/api/painel");
      if (r.status === 401) {
        window.location.replace("login.html");
        return;
      }
      if (r.status === 403) {
        window.location.replace(r.dados.erro === "mfa_obrigatorio" ? "conta.html?motivo=mfa" : "../index.html");
        return;
      }
      if (!r.ok) {
        mostrarAviso("Não foi possível carregar os indicadores agora.");
        return;
      }
      renderizar(r.dados);
    } catch (erro) {
      mostrarAviso(erro instanceof ErroApi ? erro.mensagemUsuario : "Não foi possível carregar os indicadores agora.");
    }
  });
})();
