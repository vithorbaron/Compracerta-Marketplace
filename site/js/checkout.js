/**
 * checkout.js
 * Controla as 3 etapas do checkout. O pedido é enviado (via js/api.js)
 * quando o usuário clica em "Realizar transferência".
 *
 * Depende de:
 *  - js/validacao.js (Validacao)
 *  - js/dom.js       (el)
 *  - js/carrinho.js  (obterCarrinho, itensDetalhados, calcularResumoCarrinho, limparCarrinho, formatarCentavos)
 *  - js/api.js       (realizarTransferencia, ErroApi)
 *
 * Regras (A05, A06, A08, A10):
 *  - Tudo é revalidado imediatamente antes do envio; nada depende de o
 *    usuário ter passado pelas etapas na ordem.
 *  - O pedido leva só {id, quantidade} dos itens e o total esperado em
 *    centavos. Preço, frete e total cobrados são decididos pelo servidor.
 *  - A resposta da API é tratada como não confiável e validada campo a campo.
 *
 * Dados pessoais (LGPD): nome, CPF, e-mail e telefone ficam só nos campos do
 * formulário e em memória durante o envio. Não vão para localStorage,
 * sessionStorage nem para o console, e o formulário é limpo ao concluir ou
 * sair da página.
 */

const CHAVE_IDEMPOTENCIA = "compracerta_checkout_idem";
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RE_TRANSACAO_ID = /^[A-Za-z0-9_-]{1,64}$/;
const STATUS_EXIBICAO = Object.freeze({
  aprovado: "Aprovado",
  aprovada: "Aprovado",
  pendente: "Pendente",
  processado: "Processado",
  processando: "Em processamento",
  recebido: "Recebido",
});
const STATUS_RECUSADO = ["recusado", "recusada", "negado", "negada"];

const CAMPOS_COMPRADOR = [
  { id: "comprador-nome", erro: "erro-comprador-nome", validar: (v) => Validacao.validarNome(v) },
  { id: "comprador-cpf", erro: "erro-comprador-cpf", validar: (v) => Validacao.validarCPF(v) },
  { id: "comprador-email", erro: "erro-comprador-email", validar: (v) => Validacao.validarEmail(v) },
  { id: "comprador-telefone", erro: "erro-comprador-telefone", validar: (v) => Validacao.validarTelefone(v) },
];

let etapaAtual = 1;
let carrinhoCheckout = [];
let resumoCheckout = calcularResumoCarrinho([]);
let envioEmAndamento = false;

function registrarFalha(etapa, campo) {
  if (window.SegurancaLog) SegurancaLog.registrar("validacao_falhou", { etapa: etapa, campo: campo });
}

// ---------- Etapa 1: resumo da compra ----------

function atualizarCarrinhoCheckout() {
  carrinhoCheckout = obterCarrinho();
  resumoCheckout = calcularResumoCarrinho(carrinhoCheckout);
}

function renderizarResumoCompra() {
  const lista = document.getElementById("resumo-compra-lista");
  lista.replaceChildren(...itensDetalhados(carrinhoCheckout).map((item) =>
    el("div", { className: "summary-row" },
      el("span", { className: "summary-item-nome" },
        item.produto.nome + " ",
        el("small", { text: "x" + item.quantidade })
      ),
      el("span", { className: "summary-item-preco", text: formatarCentavos(item.produto.precoCentavos * item.quantidade) })
    )
  ));

  document.getElementById("resumo-subtotal").textContent = formatarCentavos(resumoCheckout.subtotalCentavos);
  document.getElementById("resumo-frete").textContent =
    resumoCheckout.freteCentavos === 0 ? "Grátis" : formatarCentavos(resumoCheckout.freteCentavos);
  document.getElementById("resumo-total").textContent = formatarCentavos(resumoCheckout.totalCentavos);
}

// ---------- Etapa 2: dados do comprador ----------

function valorDoCampo(id) {
  const campo = document.getElementById(id);
  return campo ? String(campo.value) : "";
}

function limparErrosComprador() {
  CAMPOS_COMPRADOR.forEach((campo) => {
    document.getElementById(campo.erro).textContent = "";
  });
}

/** Valida e mostra erros por campo. Retorna true quando todos são válidos. */
function validarDadosComprador() {
  limparErrosComprador();
  let valido = true;
  CAMPOS_COMPRADOR.forEach((campo) => {
    const erro = campo.validar(valorDoCampo(campo.id));
    if (erro) {
      document.getElementById(campo.erro).textContent = erro;
      registrarFalha("dados", campo.id.replace("comprador-", ""));
      valido = false;
    }
  });
  return valido;
}

function obterDadosComprador() {
  return {
    nome: Validacao.normalizarNome(valorDoCampo("comprador-nome")),
    cpf: Validacao.apenasDigitos(valorDoCampo("comprador-cpf")),
    email: valorDoCampo("comprador-email").trim(),
    telefone: Validacao.apenasDigitos(valorDoCampo("comprador-telefone")),
  };
}

function limparDadosComprador() {
  const form = document.getElementById("form-comprador");
  if (form) form.reset();
  limparErrosComprador();
}

// ---------- Etapa 3: pagamento ----------

function obterMetodoPagamento() {
  const selecionado = document.querySelector('input[name="metodoPagamento"]:checked');
  return selecionado ? selecionado.value : null;
}

function sincronizarSelecaoPagamento() {
  document.querySelectorAll(".payment-option").forEach((opcao) => {
    const input = opcao.querySelector('input[name="metodoPagamento"]');
    opcao.classList.toggle("selected", !!input && input.checked);
  });
}

function mostrarErroPagamento(mensagem) {
  const aviso = document.getElementById("erro-pagamento");
  aviso.textContent = mensagem || "";
  aviso.hidden = !mensagem;
}

// ---------- Navegação entre etapas ----------

function atualizarUIEtapas() {
  document.querySelectorAll(".checkout-step").forEach((secao) => {
    secao.hidden = Number(secao.dataset.etapa) !== etapaAtual;
  });

  document.querySelectorAll("#indicador-etapas [data-etapa-indicador]").forEach((indicador) => {
    const numero = Number(indicador.dataset.etapaIndicador);
    indicador.classList.toggle("active", numero === etapaAtual);
    indicador.classList.toggle("done", numero < etapaAtual);
  });
}

function mostrarEtapa(numero) {
  etapaAtual = numero;
  atualizarUIEtapas();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function irParaEtapa(numero) {
  if (numero >= 2 && carrinhoCheckout.length === 0) return;
  if (numero === 3 && !validarDadosComprador()) return;
  mostrarEtapa(numero);
}

// ---------- Modal de processando / sucesso / erro ----------

function mostrarModal(nomeEstado) {
  document.getElementById("modal-checkout").hidden = false;
  document.getElementById("modal-processando").hidden = nomeEstado !== "processando";
  document.getElementById("modal-sucesso").hidden = nomeEstado !== "sucesso";
  document.getElementById("modal-erro").hidden = nomeEstado !== "erro";
}

function fecharModal() {
  document.getElementById("modal-checkout").hidden = true;
}

// ---------- Idempotência ----------

function gerarUUID() {
  if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Uma chave por pedido: reaproveitada em "Tentar novamente" e cliques
 * repetidos enquanto itens, método e total forem os mesmos. A assinatura
 * guardada junto não contém dados pessoais.
 */
function obterChaveIdempotencia(assinatura) {
  const salvo = Armazenamento.lerJSON("sessao", CHAVE_IDEMPOTENCIA, null);
  if (salvo && typeof salvo.chave === "string" && RE_UUID.test(salvo.chave) && salvo.assinatura === assinatura) {
    return salvo.chave;
  }
  const chave = gerarUUID();
  Armazenamento.gravarJSON("sessao", CHAVE_IDEMPOTENCIA, { chave: chave, assinatura: assinatura });
  return chave;
}

function descartarChaveIdempotencia() {
  Armazenamento.remover("sessao", CHAVE_IDEMPOTENCIA);
}

// ---------- Revalidação e montagem do pedido ----------

/**
 * Revalida tudo a partir do estado atual da página e do storage.
 * Em falha, leva o usuário à etapa do problema e devolve null.
 */
function revalidarAntesDoEnvio() {
  atualizarCarrinhoCheckout();
  renderizarResumoCompra();
  if (carrinhoCheckout.length === 0) {
    registrarFalha("carrinho", "itens");
    exibirErro("Seu carrinho está vazio ou foi alterado. Revise os itens antes de pagar.");
    return null;
  }

  if (!validarDadosComprador()) {
    mostrarEtapa(2);
    return null;
  }

  const metodo = obterMetodoPagamento();
  if (!Validacao.metodoPagamentoValido(metodo)) {
    registrarFalha("pagamento", "metodo");
    mostrarEtapa(3);
    mostrarErroPagamento("Selecione uma forma de pagamento válida.");
    return null;
  }
  mostrarErroPagamento("");

  const itens = carrinhoCheckout.map((item) => ({ id: item.id, quantidade: item.quantidade }));
  const totalEsperadoCentavos = resumoCheckout.totalCentavos;
  const assinatura = JSON.stringify([itens, metodo, totalEsperadoCentavos]);

  return {
    comprador: obterDadosComprador(),
    itens: itens,
    metodoPagamento: metodo,
    totalEsperadoCentavos: totalEsperadoCentavos,
    idempotencyKey: obterChaveIdempotencia(assinatura),
  };
}

// ---------- Resposta da API (não confiável) ----------

function interpretarResposta(resposta, totalEsperadoCentavos) {
  const transacaoId = typeof resposta.transacaoId === "string" && RE_TRANSACAO_ID.test(resposta.transacaoId)
    ? resposta.transacaoId
    : null;

  const statusBruto = typeof resposta.status === "string" ? resposta.status.trim().toLowerCase().slice(0, 20) : "";
  const recusado = STATUS_RECUSADO.includes(statusBruto);
  const status = STATUS_EXIBICAO[statusBruto] || null;

  const totalServidor = Number.isSafeInteger(resposta.totalCentavos) && resposta.totalCentavos >= 0
    ? resposta.totalCentavos
    : null;

  if (!transacaoId || (!status && !recusado) || totalServidor === null) {
    if (window.SegurancaLog) SegurancaLog.registrar("resposta_suspeita", { motivo: "campos_invalidos" });
  }
  return {
    transacaoId: transacaoId,
    status: status,
    recusado: recusado,
    totalServidor: totalServidor,
    divergente: totalServidor !== null && totalServidor !== totalEsperadoCentavos,
  };
}

function exibirSucesso(resultado, pedido) {
  const avisoTotal = document.getElementById("sucesso-aviso");
  document.getElementById("sucesso-transacao-id").textContent = resultado.transacaoId || "—";
  document.getElementById("sucesso-cpf").textContent = Validacao.mascararCPF(pedido.comprador.cpf);
  document.getElementById("sucesso-status").textContent = resultado.status || "Recebido";

  if (resultado.totalServidor !== null) {
    document.getElementById("sucesso-valor").textContent = formatarCentavos(resultado.totalServidor);
    avisoTotal.textContent = resultado.divergente
      ? `Atenção: o valor confirmado pelo servidor é diferente do exibido no carrinho (${formatarCentavos(pedido.totalEsperadoCentavos)}).`
      : "";
  } else {
    document.getElementById("sucesso-valor").textContent = formatarCentavos(pedido.totalEsperadoCentavos) + " (estimado)";
    avisoTotal.textContent = "O servidor não confirmou o valor. Confira o pedido antes de considerar o pagamento concluído.";
  }
  avisoTotal.hidden = avisoTotal.textContent === "";

  mostrarModal("sucesso");
  descartarChaveIdempotencia();
  limparCarrinho();
  limparDadosComprador();
}

function exibirErro(mensagem) {
  document.getElementById("erro-mensagem").textContent = mensagem || "Não foi possível processar sua compra.";
  mostrarModal("erro");
}

async function aoClicarRealizarTransferencia() {
  if (envioEmAndamento) return; // impede clique duplo / envio duplicado

  const botao = document.getElementById("btn-realizar-transferencia");
  envioEmAndamento = true;
  botao.disabled = true;

  try {
    let pedido = revalidarAntesDoEnvio();
    if (!pedido) return;

    mostrarModal("processando");
    const resposta = await realizarTransferencia(pedido);
    const resultado = interpretarResposta(resposta, pedido.totalEsperadoCentavos);
    if (resultado.recusado) {
      descartarChaveIdempotencia();
      exibirErro("O pagamento foi recusado. Escolha outra forma de pagamento e tente novamente.");
    } else {
      exibirSucesso(resultado, pedido);
    }
    pedido = null;
  } catch (erro) {
    exibirErro(erro instanceof ErroApi ? erro.mensagemUsuario : "Não foi possível processar sua compra. Tente novamente.");
  } finally {
    envioEmAndamento = false;
    botao.disabled = false;
  }
}

// ---------- Inicialização ----------

document.addEventListener("DOMContentLoaded", () => {
  atualizarCarrinhoCheckout();

  const vazio = document.getElementById("checkout-vazio");
  const conteudo = document.getElementById("checkout-conteudo");

  if (carrinhoCheckout.length === 0) {
    vazio.hidden = false;
    conteudo.hidden = true;
    return;
  }

  vazio.hidden = true;
  conteudo.hidden = false;

  renderizarResumoCompra();
  atualizarUIEtapas();
  sincronizarSelecaoPagamento();

  document.querySelectorAll('input[name="metodoPagamento"]').forEach((input) => {
    input.addEventListener("change", () => {
      sincronizarSelecaoPagamento();
      mostrarErroPagamento("");
    });
  });

  document.getElementById("btn-avancar-1").addEventListener("click", () => irParaEtapa(2));
  document.getElementById("btn-voltar-2").addEventListener("click", () => irParaEtapa(1));
  document.getElementById("btn-avancar-2").addEventListener("click", () => irParaEtapa(3));
  document.getElementById("btn-voltar-3").addEventListener("click", () => irParaEtapa(2));

  document
    .getElementById("btn-realizar-transferencia")
    .addEventListener("click", aoClicarRealizarTransferencia);

  document.getElementById("btn-tentar-novamente").addEventListener("click", () => {
    fecharModal();
    aoClicarRealizarTransferencia();
  });

  document.getElementById("btn-fechar-erro").addEventListener("click", fecharModal);

  // Ao sair da página, os dados pessoais digitados não ficam no formulário.
  window.addEventListener("pagehide", limparDadosComprador);
});
