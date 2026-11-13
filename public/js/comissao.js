// Cálculo da comissão de um contrato vendido. Usado na tela Financeiro e nos testes do servidor.
// A regra tem a angariação (paga no ato da venda) e até 4 parcelas (uma por mês a partir da ativação),
// todas em % sobre a mensalidade do contrato.

export const SEGMENTOS = ["PF", "PME"];
export const ROTULO_SEGMENTO = { PF: "Pessoa física", PME: "PME" };
export const rotuloDoSegmento = (s) => ROTULO_SEGMENTO[s] ?? s;
// Planos de cada segmento: Pessoa física usa os planos PF e PME os planos CNPJ.
export const CATEGORIA_DO_SEGMENTO = { PF: "PF", PME: "CNPJ" };
export const MAX_PARCELAS = 4;

const r2 = (v) => Math.round(v * 100) / 100;

// Parcela de uma posição (1ª a 4ª); a que não foi informada vale zero.
export const parcelaDe = (regra, i) => Number(regra?.parcelas?.[i]) || 0;

export const totalDaRegra = (regra) => r2((Number(regra?.angariacao) || 0) + (regra?.parcelas || []).reduce((a, b) => a + (Number(b) || 0), 0));

// Soma meses a uma data aaaa-mm-dd, ficando no último dia quando o mês é mais curto.
export function somarMeses(iso, n) {
  const [a, m, d] = String(iso).split("-").map(Number);
  if (!a || !m || !d) return "";
  const alvo = new Date(Date.UTC(a, m - 1 + n, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

// Detalhamento: a angariação no ato da venda e cada parcela no mês correspondente, tudo sobre a mensalidade.
export function calcularComissao({ valor, ativacao }, regra) {
  if (!regra) return { itens: [], total: 0 };
  const itens = [];
  if (regra.angariacao > 0) itens.push({ rotulo: "Angariação", percentual: regra.angariacao, base: valor, data: ativacao, valor: r2(valor * regra.angariacao / 100) });
  regra.parcelas.forEach((p, i) => {
    if (!p) return;
    itens.push({ rotulo: `${i + 1}ª parcela`, percentual: p, base: valor, data: somarMeses(ativacao, i), valor: r2(valor * p / 100) });
  });
  return { itens, total: r2(itens.reduce((a, x) => a + x.valor, 0)) };
}
