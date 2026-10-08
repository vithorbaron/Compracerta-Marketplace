/**
 * dom.js
 * Construção de DOM sem interpretar HTML (A05 — Injection / DOM XSS).
 *
 * Regra do projeto: dado dinâmico (catálogo, carrinho, resposta da API, URL)
 * nunca vira HTML. Os nós são criados com createElement e o texto entra por
 * textContent ou por nós de texto, seguindo o OWASP DOM based XSS Prevention
 * Cheat Sheet ("use safe sinks": textContent, setAttribute em atributos seguros).
 */
(function () {
  "use strict";

  const ATRIBUTOS_PROIBIDOS = new Set(["style", "srcdoc", "formaction"]);

  /**
   * Valida uma URL antes de usá-la em src/href.
   * Aceita: https:, caminhos relativos do próprio site e — só para imagens —
   * data:image/svg+xml (placeholder gerado em data/produtos.js; um SVG carregado
   * via <img> não executa script). Qualquer outro esquema (javascript:, data:
   * de outro tipo, http:, vbscript: etc.) devolve o valor de reserva.
   */
  function urlSegura(valor, reserva, contexto) {
    const fallback = reserva === undefined ? "" : reserva;
    if (typeof valor !== "string") return fallback;
    const texto = valor.trim();
    if (texto === "" || texto.length > 8192) return fallback;

    if (/^data:/i.test(texto)) {
      return contexto === "imagem" && /^data:image\/svg\+xml[;,]/i.test(texto) ? texto : fallback;
    }

    let url;
    try {
      url = new URL(texto, window.location.href);
    } catch (erro) {
      return fallback;
    }

    if (url.protocol === "https:") return url.href;

    const temEsquema = /^[a-z][a-z0-9+.-]*:/i.test(texto);
    const relativoAoSite = !temEsquema && !texto.startsWith("//") && url.origin === window.location.origin;
    return relativoAoSite ? texto : fallback;
  }

  /**
   * el(tag, props, ...filhos)
   * props aceitos: text, className, dataset, on (eventos), hidden, href, src
   * e atributos comuns. Filhos string viram nós de texto (nunca HTML).
   */
  function el(tag, props) {
    const no = document.createElement(tag);
    const filhos = Array.prototype.slice.call(arguments, 2);

    Object.entries(props || {}).forEach(function (par) {
      const chave = par[0];
      const valor = par[1];
      if (valor === undefined || valor === null || valor === false) return;

      if (chave === "text") {
        no.textContent = String(valor);
      } else if (chave === "className") {
        no.className = String(valor);
      } else if (chave === "dataset") {
        Object.entries(valor).forEach(function (d) { no.dataset[d[0]] = String(d[1]); });
      } else if (chave === "on") {
        Object.entries(valor).forEach(function (e) { no.addEventListener(e[0], e[1]); });
      } else if (chave === "hidden") {
        no.hidden = true;
      } else if (chave === "href") {
        no.setAttribute("href", urlSegura(valor, "#", "link"));
      } else if (chave === "src") {
        no.setAttribute("src", urlSegura(valor, "", "imagem"));
      } else if (/^on/i.test(chave) || ATRIBUTOS_PROIBIDOS.has(chave.toLowerCase())) {
        throw new Error("Atributo não permitido em el(): " + chave);
      } else {
        no.setAttribute(chave, String(valor));
      }
    });

    filhos.flat(Infinity).forEach(function (filho) {
      if (filho === null || filho === undefined || filho === false) return;
      no.append(filho instanceof Node ? filho : String(filho));
    });

    if (no.tagName === "A" && no.getAttribute("target") === "_blank") {
      no.setAttribute("rel", "noopener noreferrer");
    }
    return no;
  }

  /** Imagem com fallback por evento (sem atributo onerror inline). */
  function imagemSegura(src, fallback, alt, extras) {
    const reserva = urlSegura(fallback, "", "imagem");
    const img = el("img", Object.assign({ alt: String(alt || ""), src: urlSegura(src, reserva, "imagem") }, extras || {}));
    img.addEventListener("error", function () {
      if (reserva && img.getAttribute("src") !== reserva) img.setAttribute("src", reserva);
    }, { once: true });
    return img;
  }

  /** Estrelas de avaliação; tolera valores fora de 0–5 (evita RangeError de repeat). */
  function estrelasTexto(avaliacao) {
    const numero = Number(avaliacao);
    const cheias = Number.isFinite(numero) ? Math.min(5, Math.max(0, Math.round(numero))) : 0;
    return "★".repeat(cheias) + "☆".repeat(5 - cheias);
  }

  window.el = el;
  window.urlSegura = urlSegura;
  window.imagemSegura = imagemSegura;
  window.estrelasTexto = estrelasTexto;
})();
