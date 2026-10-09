/**
 * conta.js — verificação em duas etapas (pages/conta.html).
 * O segredo só aparece no QR code, uma vez, e os códigos de recuperação também.
 * Nada disso é guardado no navegador.
 */
(function () {
  "use strict";

  const PAPEIS_PAINEL = ["financeiro", "ceo"];
  const $ = function (id) { return document.getElementById(id); };
  const avisoErro = $("formError");
  const avisoSucesso = $("formSuccess");
  let papelAtual = null;
  let codigosAtuais = [];

  function mostrar(elemento, mensagem) {
    elemento.textContent = mensagem;
    elemento.classList.add("visible");
  }

  function esconderAvisos() {
    [avisoErro, avisoSucesso].forEach(function (e) { e.classList.remove("visible"); e.textContent = ""; });
  }

  function exibir(secao) {
    ["secAtivar", "secQr", "secCodigos", "secDesativar"].forEach(function (id) { $(id).hidden = id !== secao; });
  }

  function erroDaApi(r, padrao) {
    if (r.status === 429) return "Muitas tentativas em pouco tempo. Aguarde um instante.";
    if (r.status === 503) return "Verificação em duas etapas indisponível no momento. Avise o administrador.";
    if (r.status === 423) return "Conta bloqueada por segurança. Procure o administrador.";
    if (r.dados.erro === "codigo_invalido") return "Código incorreto. Confira se o horário do celular está automático.";
    return padrao;
  }

  async function carregar() {
    const r = await chamarApi("GET", "/api/auth/sessao");
    if (r.status === 401) { window.location.replace("login.html"); return; }
    papelAtual = r.dados.papel;
    const operador = window.Auth.PAPEIS_OPERADOR.indexOf(papelAtual) !== -1;
    $("avisoOperador").hidden = !operador;
    if (r.dados.mfa === true) {
      $("mfaStatus").textContent = "Ativada. Ao entrar, o site pede o código do seu aplicativo autenticador.";
      exibir(operador ? null : "secDesativar");
    } else {
      $("mfaStatus").textContent = "Desativada.";
      exibir("secAtivar");
    }
  }

  async function iniciar() {
    esconderAvisos();
    $("btnAtivar").disabled = true;
    try {
      const r = await chamarApi("POST", "/api/mfa/iniciar");
      if (!r.ok || typeof r.dados.qr !== "string" || typeof r.dados.chave !== "string") {
        mostrar(avisoErro, erroDaApi(r, "Não foi possível iniciar a ativação. Tente novamente."));
        return;
      }
      const area = $("qrArea");
      area.replaceChildren(el("img", { src: r.dados.qr, alt: "QR code para o aplicativo autenticador", width: 220, height: 220 }));
      $("chaveManual").textContent = r.dados.chave.slice(0, 64);
      $("nomeConta").textContent = String(r.dados.conta || "CompraCerta").slice(0, 60);
      exibir("secQr");
      $("codigoConfirmar").focus();
    } catch (erro) {
      mostrar(avisoErro, erro instanceof ErroApi ? erro.mensagemUsuario : "Não foi possível iniciar a ativação.");
    } finally {
      $("btnAtivar").disabled = false;
    }
  }

  async function confirmar(evento) {
    evento.preventDefault();
    esconderAvisos();
    const codigo = $("codigoConfirmar").value.trim();
    if (!/^\d{6}$/.test(codigo)) { mostrar(avisoErro, "Digite os 6 números do aplicativo."); return; }
    try {
      const r = await chamarApi("POST", "/api/mfa/confirmar", { codigo: codigo });
      $("codigoConfirmar").value = "";
      const codigos = r.ok && Array.isArray(r.dados.codigosRecuperacao) ? r.dados.codigosRecuperacao : null;
      if (!codigos) { mostrar(avisoErro, erroDaApi(r, "Não foi possível ativar. Tente novamente.")); return; }
      codigosAtuais = codigos.filter(function (c) { return typeof c === "string" && /^[a-z0-9]{5}-[a-z0-9]{5}$/.test(c); });
      $("qrArea").replaceChildren();
      $("chaveManual").textContent = "";
      $("listaCodigos").replaceChildren.apply($("listaCodigos"), codigosAtuais.map(function (c) { return el("li", { text: c }); }));
      $("mfaStatus").textContent = "Ativada.";
      exibir("secCodigos");
    } catch (erro) {
      mostrar(avisoErro, erro instanceof ErroApi ? erro.mensagemUsuario : "Não foi possível ativar.");
    }
  }

  async function desativar(evento) {
    evento.preventDefault();
    esconderAvisos();
    const codigo = $("codigoDesativar").value.trim();
    try {
      const r = await chamarApi("POST", "/api/mfa/desativar", { codigo: codigo });
      $("codigoDesativar").value = "";
      if (!r.ok) { mostrar(avisoErro, erroDaApi(r, "Não foi possível desativar.")); return; }
      mostrar(avisoSucesso, "Verificação em duas etapas desativada.");
      await carregar();
    } catch (erro) {
      mostrar(avisoErro, erro instanceof ErroApi ? erro.mensagemUsuario : "Não foi possível desativar.");
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (new URLSearchParams(window.location.search).get("motivo") === "mfa") {
      mostrar(avisoErro, "Para acessar a área interna, ative a verificação em duas etapas.");
    }
    $("btnAtivar").addEventListener("click", iniciar);
    $("formConfirmar").addEventListener("submit", confirmar);
    $("formDesativar").addEventListener("submit", desativar);
    $("btnCopiar").addEventListener("click", async function () {
      try {
        await navigator.clipboard.writeText(codigosAtuais.join("\n"));
        mostrar(avisoSucesso, "Códigos copiados. Cole num gerenciador de senhas.");
      } catch (erro) {
        mostrar(avisoErro, "Não foi possível copiar. Anote os códigos manualmente.");
      }
    });
    $("btnConcluir").addEventListener("click", function () {
      codigosAtuais = [];
      $("listaCodigos").replaceChildren();
      window.location.href = PAPEIS_PAINEL.indexOf(papelAtual) !== -1 ? "dashboard.html" : "../index.html";
    });
    carregar().catch(function (erro) {
      mostrar(avisoErro, erro instanceof ErroApi ? erro.mensagemUsuario : "Não foi possível carregar.");
    });
  });
})();
