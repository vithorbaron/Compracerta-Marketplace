/**
 * cadastro.js — formulário de cadastro (pages/cadastro.html).
 * As regras vêm de validacao.js (as mesmas espelhadas nos atributos HTML e
 * repetidas na API). A mensagem de recusa é sempre a mesma, para não revelar
 * se o e-mail ou o usuário já existe.
 */
(function () {
  "use strict";

  const V = window.Validacao;
  const form = document.getElementById("formCadastro");
  const botao = form.querySelector("button[type=submit]");
  const avisoErro = document.getElementById("formError");
  const campos = {
    email: { input: document.getElementById("email"), erro: document.getElementById("erro-email"), validar: V.validarEmail },
    usuario: { input: document.getElementById("usuario"), erro: document.getElementById("erro-usuario"), validar: V.validarUsuario },
    senha: { input: document.getElementById("senha"), erro: document.getElementById("erro-senha"), validar: V.validarSenha },
  };

  function atualizarChecklistSenha() {
    const senha = campos.senha.input.value;
    document.querySelectorAll("#passwordChecklist li").forEach(function (item) {
      const regra = V.REGRAS_SENHA[item.dataset.rule];
      item.classList.toggle("met", Boolean(regra && regra(senha)));
    });
  }

  function validarCampos() {
    let primeiroInvalido = null;
    Object.keys(campos).forEach(function (nome) {
      const campo = campos[nome];
      const mensagem = campo.validar(campo.input.value);
      campo.erro.textContent = mensagem || "";
      campo.input.setAttribute("aria-invalid", mensagem ? "true" : "false");
      if (mensagem && !primeiroInvalido) primeiroInvalido = campo.input;
    });
    if (primeiroInvalido) primeiroInvalido.focus();
    return !primeiroInvalido;
  }

  campos.senha.input.addEventListener("input", atualizarChecklistSenha);

  form.addEventListener("submit", async function (evento) {
    evento.preventDefault();
    avisoErro.classList.remove("visible");
    avisoErro.textContent = "";

    if (!validarCampos()) {
      window.SegurancaLog.registrar("validacao_falhou", { pagina: "cadastro" });
      return;
    }

    botao.disabled = true;
    try {
      const resultado = await window.Auth.cadastrarUsuario({
        email: campos.email.input.value,
        usuario: campos.usuario.input.value,
        senha: campos.senha.input.value,
      });
      campos.senha.input.value = "";
      atualizarChecklistSenha();

      if (!resultado.ok) {
        avisoErro.textContent = resultado.erro;
        avisoErro.classList.add("visible");
        return;
      }

      document.getElementById("authCard").classList.add("is-confirmed");
      document.getElementById("confirmPanel").classList.add("visible");
      window.setTimeout(function () { window.location.href = "login.html"; }, 1800);
    } catch (erro) {
      avisoErro.textContent = erro instanceof ErroApi ? erro.mensagemUsuario : "Não foi possível criar a conta com esses dados.";
      avisoErro.classList.add("visible");
    } finally {
      botao.disabled = false;
    }
  });
})();
