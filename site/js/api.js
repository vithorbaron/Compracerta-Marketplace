/**
 * api.js
 * Cliente HTTP da API (mesma origem do site). Carregado no <head>, antes de auth.js.
 *
 * A sessão viaja num cookie HttpOnly definido pelo servidor: o JavaScript não
 * lê nem guarda o token. Mensagens ao usuário são sempre fixas, em português;
 * texto cru do servidor nunca chega à tela nem ao console.
 */
(function () {
  "use strict";

  const TEMPO_LIMITE_MS = 15000;
  const LIMITE_ENVIO_BYTES = 16 * 1024;
  const LIMITE_RESPOSTA_BYTES = 64 * 1024;

  const MENSAGEM_REDE = "Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.";
  const MENSAGEM_TEMPO = "O servidor demorou muito para responder. Tente novamente em instantes.";
  const MENSAGEM_RESPOSTA = "Recebemos uma resposta inesperada do servidor. Tente novamente.";
  const MENSAGEM_ENVIO = "Os dados enviados são grandes demais.";

  /** Erro com mensagem pronta para o usuário e um código curto para o log. */
  class ErroApi extends Error {
    constructor(mensagemUsuario, codigo, status) {
      super(mensagemUsuario);
      this.name = "ErroApi";
      this.mensagemUsuario = mensagemUsuario;
      this.codigo = codigo;
      this.status = status || 0;
    }
  }

  function falhar(mensagem, codigo, status) {
    if (window.SegurancaLog) SegurancaLog.registrar("api_erro", { codigo: codigo, status: status || 0 });
    throw new ErroApi(mensagem, codigo, status);
  }

  /**
   * Faz a requisição e devolve { ok, status, dados } para qualquer resposta HTTP
   * com JSON (ou vazia). Falhas de rede, tempo esgotado, erro 5xx e respostas
   * fora do formato lançam ErroApi.
   */
  async function chamarApi(metodo, caminho, corpo) {
    if (typeof caminho !== "string" || !/^\/api\/[a-z0-9/_-]+$/.test(caminho)) falhar(MENSAGEM_RESPOSTA, "caminho");

    const opcoes = {
      method: metodo,
      headers: { Accept: "application/json" },
      mode: "same-origin",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    };
    if (corpo !== undefined) {
      const texto = JSON.stringify(corpo);
      if (texto.length > LIMITE_ENVIO_BYTES) falhar(MENSAGEM_ENVIO, "envio_grande");
      opcoes.headers["Content-Type"] = "application/json";
      opcoes.body = texto;
    }

    const controlador = new AbortController();
    opcoes.signal = controlador.signal;
    const timeoutId = setTimeout(() => controlador.abort(), TEMPO_LIMITE_MS);

    let resposta;
    let texto;
    try {
      resposta = await fetch(caminho, opcoes);
      texto = await resposta.text();
    } catch (erro) {
      if (erro && erro.name === "AbortError") falhar(MENSAGEM_TEMPO, "timeout");
      falhar(MENSAGEM_REDE, "rede");
    } finally {
      clearTimeout(timeoutId);
    }

    if (resposta.status >= 500) falhar("O serviço está com instabilidade. Tente novamente em instantes.", "http", resposta.status);
    if (texto.length > LIMITE_RESPOSTA_BYTES) falhar(MENSAGEM_RESPOSTA, "resposta_grande", resposta.status);
    let dados = null;
    if (texto) {
      const tipo = (resposta.headers.get("Content-Type") || "").toLowerCase();
      if (!tipo.startsWith("application/json")) falhar(MENSAGEM_RESPOSTA, "content_type", resposta.status);
      try {
        dados = JSON.parse(texto);
      } catch (erro) {
        falhar(MENSAGEM_RESPOSTA, "json_invalido", resposta.status);
      }
      if (!dados || typeof dados !== "object" || Array.isArray(dados)) falhar(MENSAGEM_RESPOSTA, "json_formato", resposta.status);
    }
    return { ok: resposta.ok, status: resposta.status, dados: dados || {} };
  }

  const MENSAGENS_PEDIDO = Object.freeze({
    400: "Alguns dados do pedido não foram aceitos. Revise e tente novamente.",
    401: "Sua sessão expirou. Entre novamente para concluir a compra.",
    403: "Não foi possível confirmar a origem do pedido. Recarregue a página e tente novamente.",
    413: "Os dados do pedido são grandes demais.",
    422: "Os valores do pedido mudaram. Revise o carrinho e tente novamente.",
    429: "Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente.",
  });

  /**
   * Envia o pedido (contrato em checkout.js) para POST /api/transacao.
   * Devolve o JSON da resposta SEM confiar nele: quem chama valida campo a campo.
   */
  async function realizarTransferencia(pedido) {
    const r = await chamarApi("POST", "/api/transacao", pedido);
    if (r.ok) return r.dados;
    if (r.status === 409) {
      falhar(r.dados.erro === "estoque_insuficiente"
        ? "Algum item do carrinho ficou sem estoque. Revise o carrinho e tente novamente."
        : "Este pedido já foi recebido com outros dados. Revise o carrinho antes de tentar de novo.", "http", 409);
    }
    falhar(MENSAGENS_PEDIDO[r.status] || "Não foi possível processar sua compra. Tente novamente.", "http", r.status);
  }

  window.ErroApi = ErroApi;
  window.chamarApi = chamarApi;
  window.realizarTransferencia = realizarTransferencia;
})();
