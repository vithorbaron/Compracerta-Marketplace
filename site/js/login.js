/**
 * login.js — formulário de login (pages/login.html).
 * A verificação da senha e o bloqueio de tentativas são feitos pela API.
 */
(function () {
  "use strict";

  const PAPEIS_PAINEL = ["financeiro", "ceo"];
  const form = document.getElementById("formLogin");
  const botao = form.querySelector("button[type=submit]");
  const campoIdentificador = document.getElementById("identificador");
  const campoSenha = document.getElementById("senha");
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
      if (!resultado.ok) {
        if (resultado.bloqueado) {
          mostrar(avisoErro, "Muitas tentativas sem sucesso. Aguarde " + resultado.esperaSegundos + " segundos e tente novamente.");
        } else {
          mostrar(avisoErro, resultado.erro || "Usuário/e-mail ou senha incorretos.");
        }
        return;
      }
      window.location.href = PAPEIS_PAINEL.indexOf(resultado.papel) !== -1 ? "dashboard.html" : "../index.html";
    } catch (erro) {
      mostrar(avisoErro, erro instanceof ErroApi ? erro.mensagemUsuario : "Não foi possível entrar agora. Tente novamente.");
    } finally {
      botao.disabled = false;
    }
  });
})();
