// Cálculo da comissão de um contrato vendido. Usado na tela Financeiro e nos testes do servidor.
// A regra tem a taxa de angariação (em % sobre o valor da adesão, nos coletivos por adesão) e as
// parcelas (em % sobre a mensalidade do contrato, uma por mês a partir da ativação).

export const SEGMENTOS = ["PF", "PME", "PF e PME", "Adesão PF", "Adesão PME", "Adesão"];
export const MAX_PARCELAS = 24;

const r2 = (v) => Math.round(v * 100) / 100;

// "100, 100, 50" ou "100; 100; 50" ou "10x30" (10 parcelas de 30%). Vazio vale "sem parcelas".
export function lerParcelas(texto) {
  const t = String(texto ?? "").trim().replace(/%/g, "");
  if (!t) return [];
  const repetida = /^(\d{1,2})\s*[x×]\s*(\d+(?:[.,]\d+)?)$/i.exec(t);
  if (repetida) {
    const n = Number(repetida[1]), p = Number(repetida[2].replace(",", "."));
    return n >= 1 && n <= MAX_PARCELAS && p >= 0 && p <= 1000 ? Array(n).fill(p) : null;
  }
  // "100,100,50" sem espaços: com duas ou mais vírgulas, a vírgula separa as parcelas.
  if (/^\d+(?:,\d+){2,}$/.test(t)) return lerParcelas(t.replace(/,/g, "; "));
  const partes = t.split(/\s*[;|]\s*|\s*,\s+|\s+/).filter(Boolean).map((x) => (x === "-" || x === "--" ? "0" : x));
  const nums = partes.map((x) => Number(x.replace(",", ".")));
  if (!nums.length || nums.length > MAX_PARCELAS || nums.some((n) => !Number.isFinite(n) || n < 0 || n > 1000)) return null;
  return nums;
}

const pct = (n) => `${String(r2(n)).replace(".", ",")}%`;

// Texto curto das parcelas: "100% · 100% · 50%" ou "10 × 30%".
export function textoDasParcelas(parcelas) {
  if (!parcelas?.length) return "—";
  if (parcelas.length > 3 && parcelas.every((p) => p === parcelas[0])) return `${parcelas.length} × ${pct(parcelas[0])}`;
  return parcelas.map((p) => (p ? pct(p) : "—")).join(" · ");
}

export const totalDaRegra = (regra) => r2((regra?.angariacao || 0) + (regra?.parcelas || []).reduce((a, b) => a + b, 0));
export const usaAdesao = (regra) => (regra?.angariacao || 0) > 0;

// Soma meses a uma data aaaa-mm-dd, ficando no último dia quando o mês é mais curto.
export function somarMeses(iso, n) {
  const [a, m, d] = String(iso).split("-").map(Number);
  if (!a || !m || !d) return "";
  const alvo = new Date(Date.UTC(a, m - 1 + n, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

// Detalhamento: a angariação no ato da venda e cada parcela no mês correspondente.
export function calcularComissao({ valor, ativacao, adesao }, regra) {
  if (!regra) return { itens: [], total: 0 };
  const itens = [];
  if (usaAdesao(regra)) {
    const base = Number(adesao) || 0;
    itens.push({ rotulo: "Taxa de angariação", percentual: regra.angariacao, base, tipoBase: "adesão", data: ativacao, valor: r2(base * regra.angariacao / 100) });
  }
  regra.parcelas.forEach((p, i) => {
    if (!p) return;
    itens.push({ rotulo: `${i + 1}ª parcela`, percentual: p, base: valor, tipoBase: "mensalidade", data: somarMeses(ativacao, i), valor: r2(valor * p / 100) });
  });
  return { itens, total: r2(itens.reduce((a, x) => a + x.valor, 0)) };
}
