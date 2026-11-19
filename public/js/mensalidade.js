// Mensalidade de uso do sistema: cada corretor (todo login, menos o administrador) paga um valor por mês.
// O controle é manual: o administrador marca cada mês como pago. Usado na tela Mensalidades e no servidor.

// Até o dia 28 o vencimento existe em todos os meses, inclusive fevereiro.
export const DIA_MIN = 1;
export const DIA_MAX = 28;
// "Vence em breve": faltam até estes dias para o vencimento.
export const DIAS_AVISO = 7;
// Bloqueio automático: dias de atraso até o login ser desativado (0 = não bloqueia).
export const DIAS_BLOQUEIO_MAX = 90;
export const FORMAS = ["Pix", "Transferência", "Dinheiro", "Boleto", "Cartão", "Outra"];

export const SITUACOES = {
  atrasada: "Atrasada",
  vence: "Vence em breve",
  aberta: "Em aberto",
  paga: "Paga",
  dispensada: "Dispensada",
};

const r2 = (v) => Math.round(v * 100) / 100;
const pad = (n) => String(n).padStart(2, "0");

// Data de hoje no horário do computador, como aaaa-mm-dd.
export function hojeLocal(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const validarCompetencia = (c) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(c ?? ""));
export const validarDia = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d ?? "")) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

// Mês seguinte de um aaaa-mm.
export function proximoMes(competencia) {
  const [a, m] = competencia.split("-").map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${pad(m + 1)}`;
}

export const vencimentoDe = (competencia, dia) => `${competencia}-${pad(dia)}`;

// Dias entre duas datas aaaa-mm-dd (positivo quando "ate" vem depois).
export function diasEntre(de, ate) {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
}

export function somarDias(dia, n) {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

// Meses que já devem existir de uma assinatura: do início até o mês de hoje e, perto da virada,
// também o mês seguinte, quando o vencimento dele cai nos próximos dias.
export function competenciasDevidas({ inicio, dia }, hoje) {
  const lista = [];
  const limite = somarDias(hoje, DIAS_AVISO);
  for (let c = inicio; c <= hoje.slice(0, 7) || vencimentoDe(c, dia) <= limite; c = proximoMes(c)) {
    lista.push(c);
    if (lista.length > 1200) break;
  }
  return lista;
}

// Situação de um mês: paga, atrasada (passou do vencimento), vence em breve ou em aberto.
export function situacaoDaMensalidade(m, hoje) {
  if (m.pagoEm) return "paga";
  if (m.dispensada) return "dispensada";
  if (m.vencimento < hoje) return "atrasada";
  if (diasEntre(hoje, m.vencimento) <= DIAS_AVISO) return "vence";
  return "aberta";
}

// Situação do corretor na lista: a pior entre os meses dele.
export const SITUACOES_CORRETOR = {
  atrasado: "Atrasado",
  vence: "Vence em breve",
  em_dia: "Em dia",
  sem_cobranca: "Sem cobrança",
  pausada: "Cobrança pausada",
};

export function resumoDoCorretor(assinatura, mensalidades, hoje) {
  const abertas = mensalidades.filter((m) => !m.pagoEm && !m.dispensada).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  const atrasadas = abertas.filter((m) => m.vencimento < hoje);
  const proxima = abertas.find((m) => m.vencimento >= hoje) ?? null;
  let situacao;
  if (atrasadas.length) situacao = "atrasado";
  else if (!assinatura) situacao = "sem_cobranca";
  else if (!assinatura.ativa) situacao = "pausada";
  else if (proxima && diasEntre(hoje, proxima.vencimento) <= DIAS_AVISO) situacao = "vence";
  else situacao = "em_dia";
  // Próximo vencimento: o do mês já criado ou, se ainda não existe, o do mês seguinte ao último.
  let proximoVencimento = proxima?.vencimento ?? null;
  if (!proximoVencimento && assinatura?.ativa) {
    const ultimo = mensalidades.reduce((a, m) => (m.competencia > a ? m.competencia : a), "");
    proximoVencimento = vencimentoDe(ultimo ? proximoMes(ultimo) : assinatura.inicio, assinatura.dia);
  }
  return {
    situacao,
    proximoVencimento,
    atrasadas: atrasadas.length,
    valorAtrasado: r2(atrasadas.reduce((a, m) => a + m.valor, 0)),
    diasDeAtraso: atrasadas.length ? diasEntre(atrasadas[0].vencimento, hoje) : 0,
    proxima,
  };
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const nomeDaCompetencia = (c) => `${MESES[Number(c.slice(5, 7)) - 1]} de ${c.slice(0, 4)}`;

const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDia = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

// Texto pronto para cobrar pelo WhatsApp: os meses em aberto que já venceram ou vencem em breve.
export function mensagemDeCobranca(nome, mensalidades, hoje) {
  const devidas = mensalidades.filter((m) => ["atrasada", "vence"].includes(situacaoDaMensalidade(m, hoje)))
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  const primeiro = (nome || "").trim().split(/\s+/)[0];
  const ola = primeiro ? `Olá, ${primeiro}!` : "Olá!";
  if (!devidas.length) return `${ola} Sua mensalidade do cotador está em dia. Obrigado!`;
  const linhas = devidas.map((m) => `• ${nomeDaCompetencia(m.competencia)}: R$ ${brl(m.valor)} (vencimento ${fmtDia(m.vencimento)}${m.vencimento < hoje ? ", em atraso" : ""})`);
  const total = r2(devidas.reduce((a, m) => a + m.valor, 0));
  return `${ola} Passando para lembrar da mensalidade do cotador:\n\n${linhas.join("\n")}\n\nTotal: R$ ${brl(total)}.\n\nSe já pagou, por favor desconsidere esta mensagem. Obrigado!`;
}

/* ---------- prévia da cobrança ---------- */
// Resumo do que a cobrança vai gerar, mostrado antes de salvar: valor, dia e os próximos vencimentos.
// "nova" avisa que os meses já vencidos desde o início entram na lista (numa cobrança já programada eles já existem).
export function previaDaCobranca({ valor, dia, inicio, ativa = true }, hoje, { nova = false, quantos = 3 } = {}) {
  if (!(valor > 0) || !Number.isInteger(dia) || dia < DIA_MIN || dia > DIA_MAX || !validarCompetencia(inicio)) return "";
  if (!ativa) return "Cobrança pausada: nenhum mês novo será criado e o atraso não bloqueia o login.";
  const primeiro = vencimentoDe(inicio, dia);
  const proximos = [];
  for (let c = inicio; proximos.length < quantos; c = proximoMes(c)) if (vencimentoDe(c, dia) >= hoje) proximos.push(fmtDia(vencimentoDe(c, dia)));
  let texto = `Serão cobrados R$ ${brl(valor)} todo dia ${dia}, a partir de ${fmtDia(primeiro)}. Próximos vencimentos: ${proximos.join(", ")}.`;
  if (nova && primeiro < hoje) texto += " Os meses que já venceram desde o início entram na lista como atrasados.";
  return texto;
}

/* ---------- registro de alterações ---------- */
// Frase do que mudou na cobrança de um corretor (vazia se nada mudou), para o registro de alterações.
export function descreverAlteracaoDaCobranca(antes, depois) {
  const quando = (a) => `R$ ${brl(a.valor)} todo dia ${a.dia}, a partir de ${nomeDaCompetencia(a.inicio)}`;
  if (!antes) return `Programou a cobrança: ${quando(depois)}${depois.ativa ? "" : " (pausada)"}.`;
  const partes = [];
  if (antes.valor !== depois.valor) partes.push(`valor de R$ ${brl(antes.valor)} para R$ ${brl(depois.valor)}`);
  if (antes.dia !== depois.dia) partes.push(`vencimento do dia ${antes.dia} para o dia ${depois.dia}`);
  if (antes.inicio !== depois.inicio) partes.push(`primeiro mês de ${nomeDaCompetencia(antes.inicio)} para ${nomeDaCompetencia(depois.inicio)}`);
  if ((antes.observacao ?? "") !== (depois.observacao ?? "")) partes.push(depois.observacao ? `observação para "${depois.observacao}"` : "observação apagada");
  const mudou = partes.length ? `Mudou ${partes.join("; ")}.` : "";
  if (antes.ativa && !depois.ativa) return `Pausou a cobrança.${mudou ? ` ${mudou}` : ""}`;
  if (!antes.ativa && depois.ativa) return `Reativou a cobrança.${mudou ? ` ${mudou}` : ""}`;
  return mudou;
}

// Frase de um pagamento marcado, desfeito, dispensado ou cobrado de novo.
export function descreverAlteracaoDoMes(m, { pagoEm, forma, dispensada }) {
  const mes = nomeDaCompetencia(m.competencia);
  if (dispensada === true) return `Dispensou ${mes}.`;
  if (dispensada === false) return `Voltou a cobrar ${mes}.`;
  if (pagoEm) return `Marcou ${mes} como paga em ${fmtDia(pagoEm)}${forma ? ` (${forma})` : ""}.`;
  return `Desfez o pagamento de ${mes}.`;
}

/* ---------- régua de cobrança ---------- */
// Lembretes automáticos de cada mês em aberto: alguns dias antes, no dia e alguns dias depois do vencimento.
export const REGUA_ANTES_MAX = 30;
export const REGUA_DEPOIS_MAX = 60;
export const ETAPAS_DA_REGUA = { antes: "lembrete antes do vencimento", dia: "aviso no dia do vencimento", depois: "aviso de atraso" };

// Qual lembrete o mês pede hoje (ou null). O de atraso só sai nos 7 dias seguintes ao prazo, para ligar a régua
// não disparar avisos de dívidas antigas.
export function etapaDoLembrete(m, { antes, noDia, depois }, hoje) {
  const faltam = diasEntre(hoje, m.vencimento);
  if (antes > 0 && faltam > 0 && faltam <= antes) return "antes";
  if (noDia && faltam === 0) return "dia";
  if (depois > 0 && -faltam >= depois && -faltam <= depois + DIAS_AVISO) return "depois";
  return null;
}

// Texto do lembrete, igual no WhatsApp e no e-mail. Com o bloqueio ligado, o aviso de atraso diz até quando pagar.
export function mensagemDoLembrete(etapa, m, { nome, comoPagar = "", diasBloqueio = 0, bloqueado = false } = {}) {
  const primeiro = (nome || "").trim().split(/\s+/)[0];
  const ola = primeiro ? `Olá, ${primeiro}!` : "Olá!";
  const qual = `a mensalidade do cotador de ${nomeDaCompetencia(m.competencia)}, no valor de R$ ${brl(m.valor)},`;
  let texto;
  if (etapa === "antes") texto = `${ola} Passando para lembrar que ${qual} vence em ${fmtDia(m.vencimento)}.`;
  else if (etapa === "dia") texto = `${ola} Passando para lembrar que ${qual} vence hoje (${fmtDia(m.vencimento)}).`;
  else {
    texto = `${ola} ${qual.charAt(0).toUpperCase() + qual.slice(1)} venceu em ${fmtDia(m.vencimento)} e ainda está em aberto.`;
    if (bloqueado) texto += " O acesso ao cotador está bloqueado e volta assim que o pagamento for registrado.";
    else if (diasBloqueio > 0) texto += ` Para o acesso ao cotador não ser bloqueado, faça o pagamento até ${fmtDia(somarDias(m.vencimento, diasBloqueio))}.`;
  }
  const pagar = String(comoPagar || "").trim();
  return `${texto}${pagar ? `\n\nComo pagar: ${pagar}` : ""}\n\nSe já pagou, por favor desconsidere esta mensagem. Obrigado!`;
}

export function assuntoDoLembrete(etapa, m) {
  const mes = nomeDaCompetencia(m.competencia);
  if (etapa === "antes") return `Mensalidade do cotador de ${mes} vence em ${fmtDia(m.vencimento)}`;
  if (etapa === "dia") return `Mensalidade do cotador de ${mes} vence hoje`;
  return `Mensalidade do cotador de ${mes} em atraso`;
}
