/**
 * armazenamento.js
 * Acesso a localStorage/sessionStorage com tratamento de exceção (A10).
 *
 * As APIs de Web Storage lançam exceção em modo privado de alguns navegadores,
 * com cota excedida ou com o armazenamento desativado. Aqui isso vira um valor
 * padrão seguro (null / fallback) em vez de quebrar a página.
 *
 * Quem chama estas funções valida o conteúdo lido.
 */
(function () {
  "use strict";

  function obterArea(tipo) {
    try {
      return tipo === "sessao" ? window.sessionStorage : window.localStorage;
    } catch (erro) {
      return null;
    }
  }

  function lerTexto(tipo, chave) {
    const area = obterArea(tipo);
    if (!area) return null;
    try {
      return area.getItem(chave);
    } catch (erro) {
      return null;
    }
  }

  function lerJSON(tipo, chave, padrao) {
    const texto = lerTexto(tipo, chave);
    if (texto === null) return padrao;
    try {
      return JSON.parse(texto);
    } catch (erro) {
      return padrao;
    }
  }

  function gravarJSON(tipo, chave, valor) {
    const area = obterArea(tipo);
    if (!area) return false;
    try {
      area.setItem(chave, JSON.stringify(valor));
      return true;
    } catch (erro) {
      return false;
    }
  }

  function gravarTexto(tipo, chave, texto) {
    const area = obterArea(tipo);
    if (!area) return false;
    try {
      area.setItem(chave, String(texto));
      return true;
    } catch (erro) {
      return false;
    }
  }

  function remover(tipo, chave) {
    const area = obterArea(tipo);
    if (!area) return;
    try {
      area.removeItem(chave);
    } catch (erro) {
      /* nada a fazer: storage indisponível */
    }
  }

  window.Armazenamento = Object.freeze({ lerTexto, lerJSON, gravarJSON, gravarTexto, remover });
})();
