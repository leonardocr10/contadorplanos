// Cálculo da comissão de um contrato vendido. Usado na tela Financeiro e nos testes do servidor.
// A regra tem até 4 parcelas, em % sobre a mensalidade do contrato, uma por mês a partir da ativação.

export const SEGMENTOS = ["PF", "PME"];
export const ROTULO_SEGMENTO = { PF: "Pessoa física", PME: "PME" };
export const rotuloDoSegmento = (s) => ROTULO_SEGMENTO[s] ?? s;
export const MAX_PARCELAS = 4;

const r2 = (v) => Math.round(v * 100) / 100;

// Parcela de uma posição (1ª a 4ª); a que não foi informada vale zero.
export const parcelaDe = (regra, i) => Number(regra?.parcelas?.[i]) || 0;

export const totalDaRegra = (regra) => r2((regra?.parcelas || []).reduce((a, b) => a + (Number(b) || 0), 0));

// Soma meses a uma data aaaa-mm-dd, ficando no último dia quando o mês é mais curto.
export function somarMeses(iso, n) {
  const [a, m, d] = String(iso).split("-").map(Number);
  if (!a || !m || !d) return "";
  const alvo = new Date(Date.UTC(a, m - 1 + n, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

// Detalhamento: cada parcela no mês correspondente, sobre a mensalidade.
export function calcularComissao({ valor, ativacao }, regra) {
  if (!regra) return { itens: [], total: 0 };
  const itens = [];
  regra.parcelas.forEach((p, i) => {
    if (!p) return;
    itens.push({ rotulo: `${i + 1}ª parcela`, percentual: p, base: valor, data: somarMeses(ativacao, i), valor: r2(valor * p / 100) });
  });
  return { itens, total: r2(itens.reduce((a, x) => a + x.valor, 0)) };
}
