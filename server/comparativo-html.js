// Página do comparativo: vários planos lado a lado, para virar imagem e PDF.
// Cada operadora escreve as tabelas do seu jeito, por isso as linhas são localizadas pelo assunto.
import { r2 } from "../public/js/calculo.js";
import { FONTE, esc, logoDoPlano, moeda, paletaProposta, paraProposta } from "./proposta-html.js";

export const MAX_PLANOS_COMPARATIVO = 4;
const VAZIO = "—";

const normalizar = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// A primeira linha que tem o assunto e não tem as palavras de exceção.
const achar = (linhas, nomeDe, tem, exceto) => linhas.find((l) => {
  const nome = normalizar(nomeDe(l));
  return tem.test(nome) && !(exceto && exceto.test(nome));
});

const COPARTICIPACAO = [
  { titulo: "Consulta", tem: /consulta/, exceto: /pronto|\bps\b|hospita|familia/ },
  { titulo: "Pronto-socorro", tem: /pronto|consultas? ps|\(ps\)|consultas? em hospita/ },
  { titulo: "Terapias", tem: /^terapias?\b|fisioterapia/ },
  // "Internações, exceto psiquiátricas" é a linha geral; só a internação psiquiátrica fica de fora.
  { titulo: "Internação em enfermaria", tem: /interna/, exceto: /apart|(?<!exceto )psiqui/, preferir: /enferm/ },
  { titulo: "Internação em apartamento", tem: /interna/, exceto: /enferm|(?<!exceto )psiqui/, preferir: /apart/ },
];

const CARENCIAS = [
  { titulo: "Urgência e emergência", tem: /urgencia|pronto.?socorro/ },
  { titulo: "Consulta", tem: /consulta/, exceto: /pronto/ },
  { titulo: "Exames básicos", tem: /exames.*basicos|exames laboratoriais/ },
  { titulo: "Terapias", tem: /\bterapias?\b|fisioterapia/, exceto: /exceto|quimio/ },
  { titulo: "Internação", tem: /interna|ambiente hospitalar/, exceto: /obstetr|psiqui/ },
  { titulo: "Parto", tem: /parto|obstetr/ },
  { titulo: "Preexistência", tem: /preexist|^cpt\b|cobertura parcial/, exceto: /nao relacionad/ },
];

function textoCoparticipacao(l) {
  if (!l) return VAZIO;
  if (l.tipo === "isento") return "Isento";
  if (l.tipo === "fixo") return moeda(l.valor);
  if (l.tipo === "pct") return l.teto != null ? `${l.pct}%, até ${moeda(l.teto)}` : `${l.pct}%`;
  return l.texto || VAZIO;
}

function linhaDeCoparticipacao(regra, P) {
  const nomeDe = (l) => l.nome;
  const exata = regra.preferir && achar(P.coparticipacao, nomeDe, regra.preferir, /psiqui/);
  return textoCoparticipacao(exata || achar(P.coparticipacao, nomeDe, regra.tem, regra.exceto));
}

function linhaDeCarencia(regra, P) {
  const achada = achar(P.carencias, (c) => c.nome, regra.tem, regra.exceto);
  return achada?.prazos[0]?.texto || VAZIO;
}

// O mesmo hospital aparece com nomes diferentes nas tabelas das operadoras.
const APELIDOS = { "uberlandia medical center": "umc", "orthomed center": "orthomed", "clinicas do triangulo": "triangulo" };
const semCidade = (nome) => nome.replace(/\s+[–-]\s+(Uberlândia|Ituiutaba|Araguari|Tupaciguara|Araxá)$/i, "").trim();
function chaveDaRede(nome) {
  const limpo = normalizar(semCidade(nome)).replace(/\bhospital\b/g, "").replace(/\s+/g, " ").trim().replace(/^(de|do|da) /, "");
  return APELIDOS[limpo] ?? limpo;
}

export function montarRede(propostas) {
  const itens = new Map();
  propostas.forEach((P, i) => {
    for (const nome of P.rede.hospitais) {
      const chave = chaveDaRede(nome);
      if (!itens.has(chave)) itens.set(chave, { nome: semCidade(nome), planos: new Set() });
      const item = itens.get(chave);
      // Entre os nomes do mesmo lugar, fica o que diz que é um hospital.
      if (/^hospital\b/i.test(nome) && !/^hospital\b/i.test(item.nome)) item.nome = semCidade(nome);
      item.planos.add(i);
    }
  });
  return [...itens.values()].sort((a, b) => b.planos.size - a.planos.size);
}

// Destaca o menor valor, a não ser que todos sejam iguais ou que só um plano tenha valor.
function menoresValores(valores) {
  const existentes = valores.filter((v) => v != null);
  if (existentes.length < 2) return [];
  const menor = Math.min(...existentes);
  return existentes.every((v) => v === menor) ? [] : valores.map((v, i) => (v === menor ? i : -1)).filter((i) => i >= 0);
}

const valorDe = (P, rotulo) => P.precos.find((p) => p.label === rotulo)?.valor ?? null;

const linhaTexto = (titulo, celulas) => `<tr><th scope="row">${esc(titulo)}</th>${celulas.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`;
const secao = (titulo, colunas) => `<tr class="secao"><th colspan="${colunas + 1}" scope="colgroup">${esc(titulo)}</th></tr>`;

// Algumas tabelas agrupam idades ("19 a 58"), então a faixa de cada linha é localizada pelas idades que cobre.
function idadesDaFaixa(faixa) {
  const [de, ate] = String(faixa).match(/\d+/g).map(Number);
  return { de, ate: ate ?? Infinity };
}

// As linhas do comparativo vêm do plano com as faixas mais detalhadas.
function propostaMaisDetalhada(propostas) {
  const amplitude = (P) => P.faixas.linhas.reduce((soma, l) => { const { de, ate } = idadesDaFaixa(l.faixa); return soma + Math.min(ate, 120) - de; }, 0);
  return [...propostas].sort((a, b) => b.faixas.linhas.length - a.faixas.linhas.length || amplitude(a) - amplitude(b))[0];
}

// Valor por pessoa em cada faixa, igual à proposta de cada plano, e o total da cotação na última linha.
// A snapshot guarda o subtotal da faixa.
function blocoValores(propostas) {
  const n = propostas.length, linhas = propostaMaisDetalhada(propostas).faixas.linhas;
  const totaisEnf = propostas.map((P) => valorDe(P, "Enfermaria")), totaisApto = propostas.map((P) => valorDe(P, "Apartamento"));
  const temEnf = totaisEnf.some((v) => v != null), temApto = totaisApto.some((v) => v != null);
  const titulo = secao(linhas.length ? "Valor por pessoa, por faixa etária" : "Valor mensal", n);
  if (!temEnf && !temApto) return titulo;

  // Enfermaria e apartamento lado a lado em cada plano; os nomes aparecem uma vez só, no alto da seção.
  const par = (a, b) => `<div class="par">${temEnf ? a : ""}${temApto ? b : ""}</div>`;
  const coluna = (valores) => {
    const menores = menoresValores(valores);
    return valores.map((v, i) => `<span${menores.includes(i) ? ' class="menor"' : ""}>${v != null ? moeda(v) : VAZIO}</span>`);
  };
  const linha = (classe, rotulo, enf, apto) => {
    const colunaEnf = coluna(enf), colunaApto = coluna(apto);
    return `<tr class="${classe}"><th scope="row">${esc(rotulo)}</th>${propostas.map((_, i) => `<td>${par(colunaEnf[i], colunaApto[i])}</td>`).join("")}</tr>`;
  };
  const nomes = `<tr class="acomodacoes"><th scope="row"></th>${propostas.map(() => `<td>${par("<span>Enfermaria</span>", "<span>Apartamento</span>")}</td>`).join("")}</tr>`;
  const porPessoa = (P, faixa, campo, tem) => {
    const idades = idadesDaFaixa(faixa);
    const l = P.faixas.linhas.find((x) => { const { de, ate } = idadesDaFaixa(x.faixa); return de <= idades.de && ate >= idades.ate; });
    return tem && l?.[campo] != null ? r2(l[campo] / l.n) : null;
  };
  const faixas = linhas.map((l) => linha(
    "faixa",
    `${l.faixa} anos · ${l.n} ${l.n === 1 ? "vida" : "vidas"}`,
    propostas.map((P) => porPessoa(P, l.faixa, "enf", P.faixas.temEnf)),
    propostas.map((P) => porPessoa(P, l.faixa, "apto", P.faixas.temApto)),
  ));
  return titulo + nomes + faixas.join("") + linha("faixa total", "Total mensal", totaisEnf, totaisApto);
}

const MARCA = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Sim"><path d="M20 6 9 17l-5-5"/></svg>';

function blocoRede(propostas) {
  const rede = montarRede(propostas);
  if (!rede.length) return "";
  return secao("Rede credenciada", propostas.length) + rede.map((item) => `<tr class="rede"><th scope="row">${esc(item.nome)}</th>${propostas.map((P, i) => `<td>${
    !P.rede.hospitais.length ? "Não informada" : item.planos.has(i) ? `<span class="sim">${MARCA}</span>` : VAZIO
  }</td>`).join("")}</tr>`).join("");
}

const CSS = `${FONTE}
*{box-sizing:border-box}
:root{--ink:#10243a;--muted:#4a5d70;--navy:#12324a;--line:#d9e2e8;--zebra:#f6f9fa;--verde:#0a6b3d;--verde-claro:#e4f4ea}
body{margin:0;background:#fff;color:var(--ink);font-family:Manrope,system-ui,sans-serif}
.page{min-height:100vh;display:flex;flex-direction:column;gap:20px;padding:32px 40px}
header{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;padding-bottom:16px;border-bottom:2px solid var(--navy)}
h1{margin:0;font-size:32px;font-weight:800;letter-spacing:-.02em;color:var(--navy)}
.cliente{font-size:15px;font-weight:700;margin-top:4px}
.dados{font-size:13px;color:var(--muted);margin-top:2px}
.consultor{text-align:right;font-size:13px;line-height:1.4;color:var(--muted)}
.consultor b{display:block;font-size:15px;font-weight:800;color:var(--navy)}
table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:14px;font-variant-numeric:tabular-nums}
col.rotulos{width:25%}
thead th{padding:14px 12px;vertical-align:top;font-weight:800;border-top:5px solid var(--cor)}
thead th:first-child{border-top:0}
.logo-plano{display:block;height:44px;width:auto;max-width:170px;object-fit:contain;margin:0 auto 10px}
.nome{display:block;font-size:16px;line-height:1.2;color:var(--cor)}
.tipo{display:inline-block;margin-top:6px;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:800;line-height:1.4;color:#fff;background:var(--cor)}
.sub{display:block;margin-top:4px;font-size:12px;font-weight:500;line-height:1.3;color:var(--muted)}
tbody th{padding:7px 12px;font-weight:600;text-align:left;border-bottom:1px solid var(--line)}
tbody td{padding:7px 12px;text-align:center;border-bottom:1px solid var(--line);border-left:1px solid var(--line);overflow-wrap:anywhere}
tbody tr:not(.secao):nth-child(even){background:var(--zebra)}
.secao th{padding:16px 12px 6px;font-size:15px;font-weight:800;color:var(--navy);border-bottom:2px solid var(--navy)}
.acomodacoes td,.faixa td{padding-left:4px;padding-right:4px}
.par{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:2px;align-items:center;justify-items:center;white-space:nowrap}
.par span{padding:1px 5px;border-radius:6px}
.acomodacoes td{font-size:12px;font-weight:700;color:var(--muted)}
.faixa td{font-weight:700}
.faixa .menor{background:var(--verde-claro);color:var(--verde)}
.total th{font-weight:800}
.total td{font-size:15px;font-weight:800}
.sim{display:inline-flex;color:var(--verde);vertical-align:middle}
footer{font-size:12px;line-height:1.5;color:var(--muted)}
`;

export function renderizarComparativo(snapshots) {
  const propostas = snapshots.map(paraProposta);
  const n = propostas.length, base = propostas[0];
  const faixaEtaria = propostaMaisDetalhada(propostas).faixaEtaria;
  const vidas = base.vidas ? `${base.vidas} ${base.vidas === 1 ? "vida" : "vidas"}${faixaEtaria ? ` · ${faixaEtaria}` : ""}` : "";
  // Só quando há os dois tipos na comparação: aí o tipo é o que separa as colunas.
  const misturados = new Set(snapshots.map((s) => s.plano.categoria)).size > 1;
  const colunas = snapshots.map((s, i) => {
    const cores = paletaProposta(s.plano);
    const tipo = misturados ? `<span class="tipo">${s.plano.categoria === "CNPJ" ? "CNPJ" : "Pessoa física"}</span>` : "";
    return `<th scope="col" style="--cor:${cores.navy}">${logoDoPlano(propostas[i].plano)}<span class="nome">${esc(propostas[i].plano)}</span>${tipo}${propostas[i].subtitulo ? `<span class="sub">${esc(propostas[i].subtitulo)}</span>` : ""}</th>`;
  }).join("");

  const taxas = snapshots.map((s) => s.plano.taxa || null);
  const temFidelidade = propostas.some((P) => P.fidelidade);
  const temCoparticipacao = propostas.some((P) => P.coparticipacao.length);
  const temCarencias = propostas.some((P) => P.carencias.length);
  // Tabela de uma coluna só traz o título "Período", que não é uma situação do plano anterior.
  const situacoes = propostas.map((P) => (!P.situacoes[0] || /^per[ií]odo$/i.test(P.situacoes[0]) ? "Padrão" : P.situacoes[0]));

  const corpo = [
    blocoValores(propostas),
    taxas.some(Boolean) ? linhaTexto("Taxa associativa", taxas.map((t) => (t ? moeda(t) : VAZIO))) : "",
    temFidelidade ? linhaTexto("Fidelidade", propostas.map((P) => (P.fidelidade ? "12 meses" : VAZIO))) : "",
    temCoparticipacao ? secao("Coparticipação", n) : "",
    temCoparticipacao ? COPARTICIPACAO.map((r) => linhaTexto(r.titulo, propostas.map((P) => (P.coparticipacao.length ? linhaDeCoparticipacao(r, P) : "Ver proposta")))).join("") : "",
    temCarencias ? secao("Carências", n) : "",
    temCarencias ? linhaTexto("Situação considerada", situacoes) : "",
    temCarencias ? CARENCIAS.map((r) => linhaTexto(r.titulo, propostas.map((P) => (P.carencias.length ? linhaDeCarencia(r, P) : "Ver proposta")))).join("") : "",
    blocoRede(propostas),
  ].join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Comparativo de planos</title>
<style>${CSS}</style>
</head>
<body>
<div class="page">
  <header>
    <div>
      <h1>Comparativo de planos</h1>
      ${base.cliente ? `<div class="cliente">${esc(base.cliente)}</div>` : ""}
      <div class="dados">Cotação de ${esc(base.cotacao)}${vidas ? ` · ${esc(vidas)}` : ""}</div>
    </div>
    <div class="consultor"><b>${esc(base.consultor.nome)}</b>${esc(base.consultor.corretora)}<br>${esc(base.consultor.telefone)}</div>
  </header>
  <table>
    <colgroup><col class="rotulos">${snapshots.map(() => "<col>").join("")}</colgroup>
    <thead><tr><th></th>${colunas}</tr></thead>
    <tbody>${corpo}</tbody>
  </table>
  <footer>Em verde, o menor valor. Resumo para comparação: os detalhes e as condições completas estão na proposta de cada plano.</footer>
</div>
</body>
</html>`;
}
