/**
 * login.js — formulário de login (pages/login.html).
 * A verificação da senha, do código do aplicativo autenticador e o bloqueio
 * de tentativas são feitos pela API.
 */
(function () {
  "use strict";

  const PAPEIS_PAINEL = ["financeiro", "ceo"];
  const form = document.getElementById("formLogin");
  const botao = form.querySelector("button[type=submit]");
  const campoIdentificador = document.getElementById("identificador");
  const campoSenha = document.getElementById("senha");
  const formCodigo = document.getElementById("formCodigo");
  const botaoCodigo = formCodigo.querySelector("button[type=submit]");
  const campoCodigo = document.getElementById("codigo");
  const avisoErro = document.getElementById("formError");
  const avisoSucesso = document.getElementById("formSuccess");

  function mostrar(elemento, mensagem) {
    elemento.textContent = mensagem;
    elemento.classList.add("visible");
  }

  function esconder(elemento) {
    elemento.classList.remove("visible");
    elemento.textContent = "";
  }

  function etapaSenha() {
    formCodigo.hidden = true;
    form.hidden = false;
    campoCodigo.value = "";
    campoSenha.focus();
  }

  const TEXTO_MOTIVO = {
    operador: "Conta de operador: digite o código de 6 dígitos do aplicativo autenticador.",
    dispositivo_novo: "Novo dispositivo: confirme que é você com o código do aplicativo autenticador.",
    tentativas_recentes: "Houve tentativas de senha erradas nesta conta. Confirme que é você com o código do aplicativo.",
  };

  function etapaCodigo(motivo) {
    form.hidden = true;
    formCodigo.hidden = false;
    document.getElementById("motivoCodigo").textContent = TEXTO_MOTIVO[motivo] || TEXTO_MOTIVO.operador;
    // Operador nunca tem dispositivo confiável: o código é pedido em todo acesso.
    document.getElementById("campoLembrar").hidden = motivo === "operador";
    campoCodigo.value = "";
    campoCodigo.focus();
  }

  function seguir(resultado) {
    if (window.Auth.PAPEIS_OPERADOR.indexOf(resultado.papel) !== -1 && !resultado.mfa) {
      // Operador sem verificação em duas etapas: precisa ativar antes de usar a área interna.
      window.location.href = "conta.html?motivo=mfa";
      return;
    }
    window.location.href = PAPEIS_PAINEL.indexOf(resultado.papel) !== -1 ? "dashboard.html" : "../index.html";
  }

  if (window.Auth.consumirAvisoCadastro()) {
    mostrar(avisoSucesso, "Conta criada com sucesso. Entre com suas credenciais.");
  }

  form.addEventListener("submit", async function (evento) {
    evento.preventDefault();
    esconder(avisoErro);

    const identificador = campoIdentificador.value.trim();
    const senha = campoSenha.value;
    if (!identificador || !senha) {
      mostrar(avisoErro, "Preencha usuário/e-mail e senha.");
      return;
    }

    botao.disabled = true;
    try {
      const resultado = await window.Auth.autenticar(identificador, senha);
      campoSenha.value = "";
      if (resultado.mfa && !resultado.ok) {
        etapaCodigo(resultado.motivo);
        return;
      }
      if (!resultado.ok) {
        if (resultado.bloqueado) {
          mostrar(avisoErro, "Muitas tentativas sem sucesso. Aguarde " + resultado.esperaSegundos + " segundos e tente novamente.");
        } else {
          mostrar(avisoErro, resultado.erro || "Usuário/e-mail ou senha incorretos.");
        }
        return;
      }
      seguir(resultado);
    } catch (erro) {
      mostrar(avisoErro, erro instanceof ErroApi ? erro.mensagemUsuario : "Não foi possível entrar agora. Tente novamente.");
    } finally {
      botao.disabled = false;
    }
  });

  formCodigo.addEventListener("submit", async function (evento) {
    evento.preventDefault();
    esconder(avisoErro);
    const codigo = campoCodigo.value.trim();
    if (!/^(\d{6}|[a-z0-9]{5}-?[a-z0-9]{5})$/i.test(codigo)) {
      mostrar(avisoErro, "Digite os 6 números do aplicativo ou um código de recuperação.");
      return;
    }

    botaoCodigo.disabled = true;
    try {
      const lembrar = !document.getElementById("campoLembrar").hidden && document.getElementById("lembrar").checked;
      const resultado = await window.Auth.verificarCodigo(codigo, lembrar);
      campoCodigo.value = "";
      if (resultado.ok) {
        seguir(resultado);
        return;
      }
      mostrar(avisoErro, resultado.erro);
      if (resultado.reiniciar) etapaSenha();
    } catch (erro) {
      mostrar(avisoErro, erro instanceof ErroApi ? erro.mensagemUsuario : "Não foi possível verificar agora. Tente novamente.");
    } finally {
      botaoCodigo.disabled = false;
    }
  });

  document.getElementById("voltarSenha").addEventListener("click", function () {
    esconder(avisoErro);
    etapaSenha();
  });
})();
