/**
 * auth.js — cadastro, login e sessão.
 *
 * Carregado de forma síncrona no <head> de todas as páginas, depois de
 * seguranca-log.js, armazenamento.js e api.js. Em páginas protegidas o próprio
 * <script> declara a exigência:
 *   <script src="js/auth.js" data-exigir-sessao data-login="pages/login.html"></script>
 *   (opcional) data-exigir-papel="financeiro ceo" data-sem-permissao="../index.html"
 *
 * Quem autentica é o servidor: a senha vai só para a API, e a sessão fica num
 * cookie HttpOnly. Aqui guardamos apenas usuário, papel e expiração para
 * montar a tela; a API confere o cookie em toda chamada.
 */
(function () {
  "use strict";

  const script = document.currentScript;
  const log = window.SegurancaLog || { registrar: function () {} };
  const store = window.Armazenamento;

  const CHAVE_SESSAO = "compracerta_sessao";
  const CHAVE_CARRINHO = "ecommerce_carrinho";
  const CHAVE_IDEMPOTENCIA = "compracerta_checkout_idem";
  const CHAVE_CADASTRO_OK = "compracerta_cadastro_ok";

  const PAPEIS = ["cliente", "financeiro", "ceo", "rede", "seguranca"];
  const RE_USUARIO = /^[a-z0-9_]{3,20}$/;
  const CONFIRMAR_A_CADA_MS = 2 * 60 * 1000;

  const MENSAGEM_CADASTRO_RECUSADO = "Não foi possível criar a conta com esses dados.";
  const MENSAGEM_LOGIN_INVALIDO = "Usuário/e-mail ou senha incorretos.";
  const MENSAGEM_CONTA_TRAVADA = "Conta bloqueada por segurança após muitos códigos incorretos. Procure o administrador.";

  // ---------------------------------------------------------------
  // Anti-clickjacking (segunda camada; o servidor envia frame-ancestors 'none').
  // ---------------------------------------------------------------
  (function protegerContraFrame() {
    let emFrame = true;
    try { emFrame = window.top !== window.self; } catch (erro) { emFrame = true; }
    if (!emFrame) return;
    document.documentElement.style.display = "none";
    log.registrar("clickjacking", { motivo: "pagina_em_frame" });
    try { window.top.location = window.self.location.href; } catch (erro) { /* navegação bloqueada pelo frame */ }
  })();

  // ---------------------------------------------------------------
  // Resumo local da sessão (só para a interface)
  // ---------------------------------------------------------------
  function resumoValido(s) {
    return Boolean(s) && typeof s === "object" && !Array.isArray(s) &&
      typeof s.usuario === "string" && RE_USUARIO.test(s.usuario) &&
      PAPEIS.indexOf(s.papel) !== -1 &&
      Number.isFinite(s.expiraEm) && s.expiraEm > Date.now();
  }

  function obterSessao() {
    const bruta = store.lerJSON("sessao", CHAVE_SESSAO, null);
    if (bruta === null) return null;
    if (!resumoValido(bruta)) {
      log.registrar("sessao_invalida", { motivo: "formato_ou_expirada" });
      store.remover("sessao", CHAVE_SESSAO);
      return null;
    }
    return Object.freeze({ usuario: bruta.usuario, papel: bruta.papel, expiraEm: bruta.expiraEm });
  }

  function guardarResumo(dados) {
    const resumo = { usuario: dados.usuario, papel: dados.papel, expiraEm: dados.expiraEm };
    if (!resumoValido(resumo)) return null;
    store.gravarJSON("sessao", CHAVE_SESSAO, resumo);
    return Object.freeze(resumo);
  }

  function limparLocal() {
    store.remover("sessao", CHAVE_SESSAO);
    store.remover("sessao", CHAVE_IDEMPOTENCIA);
    store.remover("local", CHAVE_CARRINHO);
  }

  /** Encerra a sessão no servidor e limpa os dados locais. */
  async function encerrarSessao() {
    limparLocal();
    try {
      await chamarApi("POST", "/api/auth/logout");
    } catch (erro) {
      /* sem rede: a sessão expira sozinha no servidor */
    }
  }

  function redirecionar(destino) {
    document.documentElement.style.visibility = "hidden";
    window.location.replace(destino);
  }

  // ---------------------------------------------------------------
  // Confirmação no servidor
  // ---------------------------------------------------------------
  let ultimaConfirmacao = 0;

  async function confirmarNoServidor(opcoes) {
    ultimaConfirmacao = Date.now();
    let r;
    try {
      r = await chamarApi("GET", "/api/auth/sessao");
    } catch (erro) {
      return; // falha de rede não derruba a página; a próxima chamada à API decide
    }
    if (r.status === 401) {
      limparLocal();
      redirecionar(opcoes.login);
      return;
    }
    if (!r.ok) return;
    const resumo = guardarResumo(r.dados);
    if (!resumo) {
      limparLocal();
      redirecionar(opcoes.login);
      return;
    }
    if (opcoes.papeis && opcoes.papeis.indexOf(resumo.papel) === -1) {
      log.registrar("acesso_negado", { motivo: "papel" });
      redirecionar(opcoes.semPermissao || opcoes.login);
    }
  }

  let monitorAtivo = false;
  function monitorarSessao(opcoes) {
    if (monitorAtivo) return;
    monitorAtivo = true;
    // Atividade do usuário mantém a sessão viva no servidor (no máximo a cada 2 min).
    ["click", "keydown", "touchstart"].forEach(function (evento) {
      window.addEventListener(evento, function () {
        if (Date.now() - ultimaConfirmacao > CONFIRMAR_A_CADA_MS) confirmarNoServidor(opcoes);
      }, { passive: true });
    });
    window.setInterval(function () {
      if (!obterSessao()) {
        limparLocal();
        redirecionar(opcoes.login);
      }
    }, 60 * 1000);
  }

  function exigirSessao(opcoes) {
    const config = {
      login: (opcoes && opcoes.login) || "login.html",
      papeis: opcoes && opcoes.papeis && opcoes.papeis.length ? opcoes.papeis : null,
      semPermissao: (opcoes && opcoes.semPermissao) || null,
    };
    const sessao = obterSessao();
    if (!sessao) {
      limparLocal();
      redirecionar(config.login);
      return null;
    }
    if (config.papeis && config.papeis.indexOf(sessao.papel) === -1) {
      log.registrar("acesso_negado", { motivo: "papel" });
      redirecionar(config.semPermissao || config.login);
      return null;
    }
    confirmarNoServidor(config);
    monitorarSessao(config);
    return sessao;
  }

  // ---------------------------------------------------------------
  // Cadastro e login (quem decide é a API)
  // ---------------------------------------------------------------
  async function cadastrarUsuario(dados) {
    const r = await chamarApi("POST", "/api/auth/cadastro", {
      email: String((dados && dados.email) || "").trim().toLowerCase(),
      usuario: String((dados && dados.usuario) || "").trim().toLowerCase(),
      senha: String((dados && dados.senha) || ""),
    });
    if (r.ok) {
      store.gravarTexto("sessao", CHAVE_CADASTRO_OK, "1");
      return { ok: true };
    }
    log.registrar("cadastro_recusado", { status: r.status });
    if (r.status === 429) return { ok: false, erro: "Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente." };
    return { ok: false, erro: MENSAGEM_CADASTRO_RECUSADO };
  }

  async function autenticar(identificador, senha) {
    const r = await chamarApi("POST", "/api/auth/login", {
      identificador: String(identificador || "").trim(),
      senha: String(senha || ""),
    });
    if (r.ok && r.dados.mfaNecessario === true) {
      // Senha certa: falta o código do aplicativo autenticador (operador ou situação de risco).
      const motivos = ["operador", "dispositivo_novo", "tentativas_recentes"];
      return { ok: false, mfa: true, motivo: motivos.indexOf(r.dados.motivo) !== -1 ? r.dados.motivo : "operador" };
    }
    if (r.ok) {
      const resumo = guardarResumo(r.dados);
      if (!resumo) return { ok: false, erro: MENSAGEM_LOGIN_INVALIDO };
      return { ok: true, usuario: resumo.usuario, papel: resumo.papel, mfa: r.dados.mfa === true };
    }
    if (r.status === 423) {
      log.registrar("conta_travada", {});
      return { ok: false, erro: MENSAGEM_CONTA_TRAVADA };
    }
    if (r.status === 429) {
      const espera = Number.isInteger(r.dados.esperaSegundos) && r.dados.esperaSegundos > 0 ? r.dados.esperaSegundos : 60;
      log.registrar("login_bloqueado", { esperaSegundos: espera });
      return { ok: false, bloqueado: true, esperaSegundos: Math.min(espera, 3600) };
    }
    log.registrar("login_falhou", { status: r.status });
    return { ok: false, erro: MENSAGEM_LOGIN_INVALIDO };
  }

  /** Segunda etapa do login: código do aplicativo ou de recuperação. */
  async function verificarCodigo(codigo, lembrar) {
    const r = await chamarApi("POST", "/api/auth/mfa", {
      codigo: String(codigo || "").trim().slice(0, 20),
      lembrar: lembrar === true,
    });
    if (r.ok) {
      const resumo = guardarResumo(r.dados);
      if (!resumo) return { ok: false, reiniciar: true, erro: MENSAGEM_LOGIN_INVALIDO };
      return { ok: true, usuario: resumo.usuario, papel: resumo.papel, mfa: true };
    }
    log.registrar("mfa_falhou", { status: r.status });
    if (r.status === 423) return { ok: false, reiniciar: true, erro: MENSAGEM_CONTA_TRAVADA };
    if (r.status === 429) return { ok: false, erro: "Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente." };
    if (r.dados.erro === "etapa_expirada" || r.dados.reiniciar === true) {
      return { ok: false, reiniciar: true, erro: "Por segurança, entre com sua senha novamente." };
    }
    const restantes = Number.isInteger(r.dados.tentativasRestantes) ? r.dados.tentativasRestantes : null;
    return {
      ok: false,
      erro: "Código incorreto." + (restantes ? " Restam " + restantes + " tentativa(s) antes de pedir a senha de novo." : ""),
    };
  }

  function consumirAvisoCadastro() {
    const flag = store.lerTexto("sessao", CHAVE_CADASTRO_OK);
    store.remover("sessao", CHAVE_CADASTRO_OK);
    return flag === "1";
  }

  window.obterSessao = obterSessao;
  window.exigirSessao = exigirSessao;
  window.encerrarSessao = encerrarSessao;
  window.Auth = Object.freeze({
    cadastrarUsuario,
    autenticar,
    verificarCodigo,
    consumirAvisoCadastro,
    PAPEIS_OPERADOR: Object.freeze(["financeiro", "ceo", "rede", "seguranca"]),
  });

  // Guarda de rota declarada no próprio <script>.
  if (script && script.hasAttribute("data-exigir-sessao")) {
    const papeis = (script.getAttribute("data-exigir-papel") || "").split(/\s+/).filter(Boolean);
    exigirSessao({
      login: script.getAttribute("data-login") || "login.html",
      papeis: papeis,
      semPermissao: script.getAttribute("data-sem-permissao") || null,
    });
  }
})();
