// Funções puras de cálculo e formatação. Rodam no navegador, no servidor e nos testes.
export const FAIXAS = ["0 a 18", "19 a 23", "24 a 28", "29 a 33", "34 a 38", "39 a 43", "44 a 48", "49 a 53", "54 a 58", "59 ou mais"];

export const faixaDe = (idade) => (idade <= 18 ? 0 : idade >= 59 ? 9 : Math.floor((idade - 19) / 5) + 1);
export const r2 = (x) => Math.round(x * 100) / 100;
export const hasFaixas = (p) => [p.faixasEnf, p.faixasApto].some((a) => Array.isArray(a) && a.some((x) => x != null));
export const totalVidas = (vidas) => vidas.reduce((a, b) => a + b, 0);

export const brl = (n) => (n == null || isNaN(n) ? "" : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function parseBRL(s) {
  if (s == null) return null;
  s = String(s).replace(/[^\d,.-]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

export const lines = (s) => String(s || "").split("\n").map((x) => x.trim()).filter(Boolean);

// "35, 32, 7" vira as contagens das 10 faixas.
export function idadesParaVidas(texto) {
  const vidas = Array(10).fill(0);
  const idades = (String(texto).match(/\d+/g) || []).map(Number).filter((a) => a <= 120);
  for (const a of idades) vidas[faixaDe(a)]++;
  return vidas;
}

// Tabela de 3 faixas: as idades continuam informadas nas 10 faixas e são somadas nestes grupos.
const GRUPOS_3_FAIXAS = [
  { faixa: "0 a 18", indices: [0] },
  { faixa: "19 a 58", indices: [1, 2, 3, 4, 5, 6, 7, 8] },
  { faixa: "59 ou mais", indices: [9] },
];

function agruparLinhas(linhas, modelo) {
  if (modelo !== "3") return linhas;
  return GRUPOS_3_FAIXAS.flatMap((g) => {
    const doGrupo = linhas.filter((l) => g.indices.includes(l.i));
    if (!doGrupo.length) return [];
    return [{ ...doGrupo[0], faixa: g.faixa, n: doGrupo.reduce((a, l) => a + l.n, 0) }];
  });
}

export function planPrices(p, vidas, over = {}) {
  if (hasFaixas(p) && totalVidas(vidas) > 0) {
    // Alguns planos têm preço menor para titular com 2 ou mais dependentes (3 vidas ou mais).
    const familia = totalVidas(vidas) >= 3;
    const tabelaEnf = familia && p.faixasEnfFamilia ? p.faixasEnfFamilia : p.faixasEnf;
    const tabelaApto = familia && p.faixasAptoFamilia ? p.faixasAptoFamilia : p.faixasApto;
    const linhas = [];
    let enf = 0, apto = 0, eOk = true, aOk = true;
    vidas.forEach((n, i) => {
      if (!n) return;
      const e = tabelaEnf?.[i] ?? null, a = tabelaApto?.[i] ?? null;
      if (e == null) eOk = false; else enf += e * n;
      if (a == null) aOk = false; else apto += a * n;
      linhas.push({ i, n, enf: e, apto: a, faixa: FAIXAS[i] });
    });
    return { porFaixa: true, linhas: agruparLinhas(linhas, p.faixasModelo), enf: eOk ? r2(enf) : null, apto: aOk ? r2(apto) : null };
  }
  const o = over[p.id] || {};
  return { porFaixa: false, linhas: [], enf: o.enf !== undefined ? o.enf : p.enfermaria, apto: o.apto !== undefined ? o.apto : p.apartamento };
}

export function normFone(s) {
  let d = String(s || "").replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  return d;
}

export const fmtFone = (d) =>
  d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d;

// "Colar da planilha": os dois últimos valores de cada linha são Enfermaria e Apartamento.
export function colarPlanilha(texto) {
  return String(texto)
    .split(/\r?\n/)
    .map((l) => l.match(/\d{1,3}(?:\.\d{3})*,\d{2}/g))
    .filter(Boolean)
    .slice(0, 10)
    .map((m) => (m.length >= 2 ? { enf: m[m.length - 2], apto: m[m.length - 1] } : { enf: m[0], apto: "" }));
}
