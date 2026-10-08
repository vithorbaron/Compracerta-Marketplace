/**
 * validacao.js
 * Regras de validação únicas do projeto (A05, A06).
 *
 * Os atributos HTML (type, pattern, minlength, maxlength) dos formulários
 * espelham exatamente estas regras, mas os formulários usam novalidate para
 * mostrar mensagens por campo — então quem decide é sempre este arquivo.
 *
 * A API aplica as mesmas regras.
 */
(function () {
  "use strict";

  const LIMITES = Object.freeze({
    emailMax: 254,
    usuarioMin: 3,
    usuarioMax: 20,
    senhaMin: 8,
    senhaMax: 128,
    nomeMin: 3,
    nomeMax: 100,
    identificadorMax: 254,
    buscaMax: 100,
  });

  const RE_EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
  const RE_USUARIO = /^[a-z0-9_]{3,20}$/i;
  const RE_NOME = /^\p{L}[\p{L}\p{M}' -]*$/u;

  // Mesmas regras usadas no checklist ao vivo da página de cadastro.
  const REGRAS_SENHA = Object.freeze({
    tamanho: function (s) { return s.length >= LIMITES.senhaMin && s.length <= LIMITES.senhaMax; },
    minuscula: function (s) { return /[a-z]/.test(s); },
    maiuscula: function (s) { return /[A-Z]/.test(s); },
    numero: function (s) { return /[0-9]/.test(s); },
    especial: function (s) { return /[^A-Za-z0-9]/.test(s); },
  });

  // Lista curta embutida de senhas comuns. Inclui variações que passariam nas
  // regras de composição (Senha@123, P@ssw0rd...), que são as que importam aqui.
  const SENHAS_COMUNS = new Set([
    "password", "123456", "123456789", "12345678", "12345", "qwerty", "abc123",
    "password1", "111111", "123123", "senha", "senha123", "admin", "admin123",
    "iloveyou", "welcome", "brasil", "mudar123", "teste123", "qwerty123",
    "password1!", "password@1", "p@ssw0rd", "p@ssword1", "p@ssw0rd1",
    "senha@123", "senha123!", "senha@1234", "admin@123", "admin123!",
    "mudar@123", "mudar123!", "teste@123", "teste123!", "brasil@123",
    "brasil@2024", "brasil@2025", "brasil@2026", "qwerty@123", "qwerty123!",
    "abc@1234", "abc12345!", "welcome@1", "welcome1!", "bemvindo@1",
    "mudar@2024", "mudar@2025", "mudar@2026", "compra@123", "trocar@123",
  ]);

  const DDDS_VALIDOS = new Set([
    11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
    41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
    71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
  ]);

  const METODOS_PAGAMENTO = Object.freeze(["pix", "cartao", "transferencia"]);

  function texto(valor) {
    return typeof valor === "string" ? valor : "";
  }

  // Cada validador devolve null quando está tudo certo, ou a mensagem de erro.

  function validarEmail(valor) {
    const email = texto(valor).trim();
    if (!email) return "Informe seu e-mail.";
    if (email.length > LIMITES.emailMax || !RE_EMAIL.test(email)) return "Informe um e-mail válido.";
    return null;
  }

  function validarUsuario(valor) {
    const usuario = texto(valor).trim();
    if (!usuario) return "Informe um nome de usuário.";
    if (!RE_USUARIO.test(usuario)) return "Use de 3 a 20 caracteres: letras sem acento, números ou _.";
    return null;
  }

  function validarSenha(valor) {
    const senha = texto(valor);
    if (!senha) return "Informe uma senha.";
    const falhou = Object.keys(REGRAS_SENHA).some(function (regra) { return !REGRAS_SENHA[regra](senha); });
    if (falhou) return "A senha precisa ter de 8 a 128 caracteres, com letra minúscula, maiúscula, número e caractere especial.";
    if (SENHAS_COMUNS.has(senha.toLowerCase())) return "Essa senha é muito comum. Escolha outra.";
    return null;
  }

  function apenasDigitos(valor) {
    return texto(valor).replace(/\D/g, "");
  }

  function cpfValido(valor) {
    const cpf = apenasDigitos(valor);
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    for (let posicao = 9; posicao <= 10; posicao++) {
      let soma = 0;
      for (let i = 0; i < posicao; i++) soma += Number(cpf[i]) * (posicao + 1 - i);
      const digito = (soma * 10) % 11 % 10;
      if (digito !== Number(cpf[posicao])) return false;
    }
    return true;
  }

  function validarCPF(valor) {
    if (texto(valor).length > 14) return "CPF inválido: confira os números.";
    return cpfValido(valor) ? null : "CPF inválido: confira os números.";
  }

  function normalizarNome(valor) {
    return texto(valor).trim().replace(/\s+/g, " ");
  }

  function validarNome(valor) {
    const nome = normalizarNome(valor);
    if (nome.length < LIMITES.nomeMin || nome.length > LIMITES.nomeMax) return "Informe seu nome completo (3 a 100 caracteres).";
    if (!RE_NOME.test(nome)) return "Use apenas letras, espaços, hífen e apóstrofo.";
    return null;
  }

  function validarTelefone(valor) {
    if (texto(valor).length > 20) return "Informe um telefone válido com DDD.";
    const digitos = apenasDigitos(valor);
    if (digitos.length !== 10 && digitos.length !== 11) return "Informe um telefone válido com DDD.";
    if (!DDDS_VALIDOS.has(Number(digitos.slice(0, 2)))) return "DDD inválido.";
    if (digitos.length === 11 && digitos[2] !== "9") return "Celular deve começar com 9 após o DDD.";
    if (digitos.length === 10 && !/[2-8]/.test(digitos[2])) return "Telefone fixo inválido.";
    return null;
  }

  function metodoPagamentoValido(valor) {
    return METODOS_PAGAMENTO.indexOf(valor) !== -1;
  }

  function mascararCPF(valor) {
    const cpf = apenasDigitos(valor);
    return cpf.length === 11 ? "•••.•••.•••-" + cpf.slice(9) : "•••";
  }

  window.Validacao = Object.freeze({
    LIMITES,
    REGRAS_SENHA,
    METODOS_PAGAMENTO,
    validarEmail,
    validarUsuario,
    validarSenha,
    validarCPF,
    validarNome,
    validarTelefone,
    metodoPagamentoValido,
    apenasDigitos,
    normalizarNome,
    mascararCPF,
  });
})();
