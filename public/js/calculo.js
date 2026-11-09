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

/* ---------- preço pelo total de vidas ---------- */
// Alguns planos de empresa mudam de preço com o tamanho do grupo (ex.: 2 a 4, 5 a 29 e 30 vidas ou mais).
// A tabela principal vale até a primeira de tabelasPorVidas; cada uma vale a partir do seu número de vidas.
const tabelasPorVidasDe = (p) => (Array.isArray(p.tabelasPorVidas) ? [...p.tabelasPorVidas].sort((a, b) => a.aPartirDe - b.aPartirDe) : []);

export function tabelaPorVidas(p, total) {
  return tabelasPorVidasDe(p).filter((t) => total >= t.aPartirDe).pop() ?? null;
}

const faixaDeVidas = (de, ate) => (ate == null ? `${de} vidas ou mais` : de === ate ? `${de} ${de === 1 ? "vida" : "vidas"}` : `${de} a ${ate} vidas`);

// Os grupos de vidas do plano, na ordem: [{ de, ate, faixasEnf, faixasApto }].
export function gruposDeVidas(p) {
  const tabelas = tabelasPorVidasDe(p);
  if (!tabelas.length) return [];
  const grupos = [{ de: p.vidasMinimas || 1, faixasEnf: p.faixasEnf, faixasApto: p.faixasApto }, ...tabelas.map((t) => ({ de: t.aPartirDe, faixasEnf: t.faixasEnf, faixasApto: t.faixasApto }))];
  // A última tabela pode ter um limite de vidas (ex.: 30 a 99 vidas).
  const limite = tabelas.at(-1).ate ?? null;
  return grupos.map((g, i) => {
    const ate = grupos[i + 1] ? grupos[i + 1].de - 1 : limite;
    return { ...g, ate, nome: faixaDeVidas(g.de, ate) };
  });
}

// Nome do grupo de vidas usado no preço, como "5 a 29 vidas". Vazio quando o plano tem uma tabela só.
export function nomeDoGrupoDeVidas(p, total) {
  return gruposDeVidas(p).filter((g) => total >= g.de).pop()?.nome ?? "";
}

export function planPrices(p, vidas, over = {}) {
  if (hasFaixas(p) && totalVidas(vidas) > 0) {
    const total = totalVidas(vidas);
    // Abaixo do mínimo de vidas o plano não tem preço.
    if (p.vidasMinimas && total < p.vidasMinimas) return { porFaixa: true, linhas: [], enf: null, apto: null, minimo: p.vidasMinimas, tabelaVidas: "" };
    // Acima do limite da última tabela também não: o preço é negociado direto com a operadora.
    const maximo = gruposDeVidas(p).at(-1)?.ate;
    if (maximo && total > maximo) return { porFaixa: true, linhas: [], enf: null, apto: null, maximo, tabelaVidas: "" };
    const porVidas = tabelaPorVidas(p, total);
    // Alguns planos têm preço menor para titular com 2 ou mais dependentes (3 vidas ou mais).
    const familia = !porVidas && total >= 3;
    const tabelaEnf = porVidas ? porVidas.faixasEnf : familia && p.faixasEnfFamilia ? p.faixasEnfFamilia : p.faixasEnf;
    const tabelaApto = porVidas ? porVidas.faixasApto : familia && p.faixasAptoFamilia ? p.faixasAptoFamilia : p.faixasApto;
    const linhas = [];
    let enf = 0, apto = 0, eOk = true, aOk = true;
    vidas.forEach((n, i) => {
      if (!n) return;
      const e = tabelaEnf?.[i] ?? null, a = tabelaApto?.[i] ?? null;
      if (e == null) eOk = false; else enf += e * n;
      if (a == null) aOk = false; else apto += a * n;
      linhas.push({ i, n, enf: e, apto: a, faixa: FAIXAS[i] });
    });
    return { porFaixa: true, linhas: agruparLinhas(linhas, p.faixasModelo), enf: eOk ? r2(enf) : null, apto: aOk ? r2(apto) : null, tabelaVidas: nomeDoGrupoDeVidas(p, total) };
  }
  const o = over[p.id] || {};
  return { porFaixa: false, linhas: [], enf: o.enf !== undefined ? o.enf : p.enfermaria, apto: o.apto !== undefined ? o.apto : p.apartamento };
}

/* ---------- carências ---------- */
// Toda tabela de carências traz terapias e preexistência; as linhas que já existem não mudam.
export function completarCarencias(tabela) {
  const linhas = lines(tabela);
  if (linhas.length < 2) return String(tabela ?? "").trim();
  const colunas = linhas[0].split("|").length - 1;
  const novaLinha = (nome, prazo) => [nome, ...Array(colunas).fill(prazo)].join(" | ");
  const nomes = linhas.slice(1).map((l) => l.split("|")[0].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());
  const temPreexistencia = nomes.some((n) => /preexist|cobertura parcial|\bcpt\b/.test(n) && !/nao relacionad/.test(n));
  const temTerapias = nomes.some((n) => /\bterapias?\b|fisioterapia/.test(n) && !/exceto/.test(n));
  if (!temTerapias) {
    // Fica antes da preexistência, que costuma ser a última linha da tabela.
    const posicao = temPreexistencia ? linhas.length - 1 : linhas.length;
    linhas.splice(posicao, 0, novaLinha("Terapias", "180 dias"));
  }
  if (!temPreexistencia) linhas.push(novaLinha("Doenças e lesões preexistentes", "24 meses"));
  return linhas.join("\n");
}

/* ---------- área de comercialização ---------- */
const semAcento = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export const ESTADOS = {
  AC: "Acre", AL: "Alagoas", AM: "Amazonas", AP: "Amapá", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás",
  MA: "Maranhão", MG: "Minas Gerais", MS: "Mato Grosso do Sul", MT: "Mato Grosso", PA: "Pará", PB: "Paraíba", PE: "Pernambuco", PI: "Piauí", PR: "Paraná",
  RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RO: "Rondônia", RR: "Roraima", RS: "Rio Grande do Sul", SC: "Santa Catarina", SE: "Sergipe", SP: "São Paulo", TO: "Tocantins",
};

// A cotação confere a área de todos os planos a cada clique: a leitura de cada texto é guardada (e congelada,
// para ninguém alterar o resultado compartilhado), com as cidades já normalizadas para comparar.
const areasLidas = new Map();
function areaLida(texto) {
  const chave = String(texto ?? "");
  let r = areasLidas.get(chave);
  if (!r) {
    const { estados, invalidas } = lerAreaSemCache(chave);
    r = {
      area: Object.freeze({ estados: Object.freeze(estados.map((e) => Object.freeze({ uf: e.uf, cidades: Object.freeze(e.cidades) }))), invalidas: Object.freeze(invalidas) }),
      normalizadas: new Map(estados.map((e) => [e.uf, new Set(e.cidades.map(semAcento))])),
    };
    if (areasLidas.size > 500) areasLidas.clear();
    areasLidas.set(chave, r);
  }
  return r;
}
export const lerArea = (texto) => areaLida(texto).area;

// "MG: Uberlândia, Araguari", com um estado por linha. Devolve também as linhas que não seguem o formato.
function lerAreaSemCache(texto) {
  const estados = [], invalidas = [];
  for (const linha of lines(texto)) {
    const m = linha.match(/^([A-Za-z]{2})\s*:\s*(.*)$/);
    const uf = m?.[1].toUpperCase();
    if (!m || !ESTADOS[uf]) { invalidas.push(linha); continue; }
    const cidades = m[2].split(",").map((c) => c.trim().replace(/\.$/, "")).filter(Boolean);
    if (!cidades.length) { invalidas.push(linha); continue; }
    const existente = estados.find((e) => e.uf === uf);
    if (existente) existente.cidades.push(...cidades);
    else estados.push({ uf, cidades });
  }
  return { estados, invalidas };
}

// Plano sem área cadastrada continua aparecendo: não dá para afirmar que ele não é vendido na cidade.
export function vendidoEm(plano, uf, cidade) {
  if (!uf) return true;
  const { area, normalizadas } = areaLida(plano.areaComercializacao);
  if (!area.estados.length) return true;
  const cidades = normalizadas.get(uf);
  if (!cidades) return false;
  return !cidade || cidades.has(semAcento(cidade));
}

// A rede que vale na cidade. "Hospital – Araxá" é de Araxá; a linha sem cidade é da cidade do plano.
// O traço só indica cidade quando ela está na área: "LABAC – Laboratório" é parte do nome.
export function redeDaCidade(plano, cidade) {
  const linhas = lines(plano.rede);
  const naArea = new Set(lerArea(plano.areaComercializacao).estados.flatMap((e) => e.cidades).map(semAcento));
  const cidadeDoPlano = semAcento(plano.cidade);
  // Sem cidade escolhida vale a cidade do plano: a rede completa pode ter centenas de prestadores.
  const alvo = semAcento(cidade) || (naArea.has(cidadeDoPlano) ? cidadeDoPlano : "");
  if (!alvo) return linhas;
  const rede = [];
  for (const linha of linhas) {
    const m = linha.match(/^(.*\S)\s+[–-]\s+(\S.*)$/);
    if (m && naArea.has(semAcento(m[2]))) {
      if (semAcento(m[2]) === alvo) rede.push(m[1]);
    } else if (!naArea.has(cidadeDoPlano) || cidadeDoPlano === alvo) {
      // Plano sem área ou com região no lugar da cidade ("Triângulo Mineiro"): não dá para separar.
      rede.push(linha);
    }
  }
  return rede;
}

// Quantos prestadores cada cidade recebe, para conferir a rede antes de salvar.
export function resumoDaRede(plano) {
  const naArea = new Map(lerArea(plano.areaComercializacao).estados.flatMap((e) => e.cidades).map((c) => [semAcento(c), c]));
  const porCidade = new Map();
  let semCidade = 0;
  for (const linha of lines(plano.rede)) {
    const m = linha.match(/^(.*\S)\s+[–-]\s+(\S.*)$/);
    const cidade = m && naArea.get(semAcento(m[2]));
    if (cidade) porCidade.set(cidade, (porCidade.get(cidade) || 0) + 1);
    else semCidade++;
  }
  return {
    cidades: [...porCidade.entries()].map(([cidade, total]) => ({ cidade, total })).sort((a, b) => a.cidade.localeCompare(b.cidade, "pt-BR")),
    semCidade,
    // A linha sem cidade da área fica na cidade do plano; sem ela na área, aparece em todas.
    destinoSemCidade: naArea.get(semAcento(plano.cidade)) || "",
  };
}

// Estados e cidades que têm algum plano, em ordem alfabética.
// Recalculada só quando a lista de planos muda (a cotação pede a cada clique).
let locaisGuardados = { chave: null, valor: null };
export function locaisDosPlanos(planos) {
  const chave = planos.map((p) => `${p.id}|${p.atualizadoEm ?? p.areaComercializacao}`).join("\n");
  if (locaisGuardados.chave !== chave) locaisGuardados = { chave, valor: calcularLocais(planos) };
  return locaisGuardados.valor;
}

function calcularLocais(planos) {
  const porUf = new Map();
  for (const p of planos) {
    for (const { uf, cidades } of lerArea(p.areaComercializacao).estados) {
      if (!porUf.has(uf)) porUf.set(uf, new Map());
      for (const c of cidades) if (!porUf.get(uf).has(semAcento(c))) porUf.get(uf).set(semAcento(c), c);
    }
  }
  return [...porUf.entries()]
    .map(([uf, cidades]) => ({ uf, nome: ESTADOS[uf], cidades: [...cidades.values()].sort((a, b) => a.localeCompare(b, "pt-BR")) }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
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
