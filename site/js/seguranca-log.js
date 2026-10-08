/**
 * seguranca-log.js
 * Registro local de eventos de segurança, sem dados pessoais.
 * Guarda no máximo 50 eventos em memória.
 */
(function () {
  "use strict";

  const MAX_EVENTOS = 50;
  const ENVIO_REMOTO_ATIVO = false;
  const ENDPOINT_EVENTOS = "";

  const TIPOS_CONHECIDOS = new Set([
    "login_falhou",
    "login_bloqueado",
    "cadastro_recusado",
    "sessao_invalida",
    "acesso_negado",
    "carrinho_saneado",
    "validacao_falhou",
    "api_erro",
    "resposta_suspeita",
    "clickjacking",
  ]);

  // Só estes campos podem ir para o log, e só com valores curtos e primitivos.
  // Nada de usuário, e-mail, CPF, telefone, nome ou senha.
  const CAMPOS_PERMITIDOS = new Set([
    "motivo", "pagina", "status", "etapa", "campo", "removidos",
    "quantidadeItens", "tentativas", "esperaSegundos", "codigo",
  ]);

  const eventos = [];

  function modoDebug() {
    try {
      return window.localStorage.getItem("compracerta_debug") === "1";
    } catch (erro) {
      return false;
    }
  }

  function limparDetalhes(detalhes) {
    const limpos = {};
    if (!detalhes || typeof detalhes !== "object") return limpos;
    Object.keys(detalhes).forEach(function (chave) {
      if (!CAMPOS_PERMITIDOS.has(chave)) return;
      const valor = detalhes[chave];
      if (typeof valor === "number" && Number.isFinite(valor)) limpos[chave] = valor;
      else if (typeof valor === "boolean") limpos[chave] = valor;
      else if (typeof valor === "string") limpos[chave] = valor.slice(0, 60);
    });
    return limpos;
  }

  function enviarRemoto(evento) {
    if (!ENVIO_REMOTO_ATIVO || !ENDPOINT_EVENTOS.startsWith("https://")) return;
    try {
      const corpo = new Blob([JSON.stringify(evento)], { type: "application/json" });
      navigator.sendBeacon(ENDPOINT_EVENTOS, corpo);
    } catch (erro) {
      /* falha de envio não pode quebrar a página */
    }
  }

  function registrar(tipo, detalhes) {
    const evento = {
      tipo: TIPOS_CONHECIDOS.has(tipo) ? tipo : "outro",
      em: new Date().toISOString(),
      pagina: window.location.pathname.split("/").pop() || "index.html",
      detalhes: limparDetalhes(detalhes),
    };
    eventos.push(evento);
    if (eventos.length > MAX_EVENTOS) eventos.shift();
    if (modoDebug()) console.warn("[seguranca]", evento.tipo, evento.detalhes);
    enviarRemoto(evento);
  }

  function listar() {
    return eventos.map(function (evento) {
      return Object.assign({}, evento, { detalhes: Object.assign({}, evento.detalhes) });
    });
  }

  window.SegurancaLog = Object.freeze({ registrar, listar });
})();
