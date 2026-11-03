// Página HTML da proposta, aberta pelo cliente no celular. Segue os mesmos blocos da imagem em canvas.
import { FAIXAS, brl, lines, planPrices, r2, totalVidas } from "../public/js/calculo.js";
import { themeFor } from "../public/js/proposta.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const temTabela = (t) => String(t || "").includes("|");

export function montarSnapshot(p, { vidas, over, cliente, opts }, corretor, agora = new Date()) {
  const v = planPrices(p, vidas, over);
  return {
    cliente,
    corretor: { nome: corretor.nome, fone: corretor.fone, empresa: corretor.empresa },
    data: agora.toLocaleDateString("pt-BR"),
    vidas: totalVidas(vidas),
    precos: {
      porFaixa: v.porFaixa, enf: v.enf ?? null, apto: v.apto ?? null,
      linhas: v.linhas.map((l) => ({
        faixa: FAIXAS[l.i], n: l.n,
        enf: l.enf != null ? r2(l.enf * l.n) : null,
        apto: l.apto != null ? r2(l.apto * l.n) : null,
      })),
    },
    plano: {
      nome: p.nome, subtitulo: p.subtitulo, cidade: p.cidade, taxa: p.taxa, odonto: p.odonto, fidelidade: p.fidelidade,
      corPrimaria: p.corPrimaria, corEscura: p.corEscura,
      beneficios: p.mostrarExtras ? lines(p.extras) : [],
      copartTexto: opts.copart ? p.copartTexto : "",
      copartTabela: temTabela(p.copartTabela) ? p.copartTabela : "", copartNota: p.copartNota,
      carenciaTabela: temTabela(p.carenciaTabela) ? p.carenciaTabela : "", carenciaNota: p.carenciaNota,
      imgCopart: temTabela(p.copartTabela) ? "" : p.imgCopart,
      imgCarencia: temTabela(p.carenciaTabela) ? "" : p.imgCarencia,
      rede: opts.rede ? lines(p.rede) : [],
    },
    legendaAcomodacao: !!opts.acom,
  };
}

function tabela(txt, nota) {
  const rows = String(txt).split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((r) => r.some(Boolean));
  if (rows.length < 2) return "";
  const n = Math.max(...rows.map((r) => r.length)), head = rows[0], colunas = [...Array(n).keys()];
  // Com 3 colunas ou mais, cada linha vira um cartão no celular, sem rolagem lateral.
  return `<table class="tab${n >= 3 ? " larga" : ""}"><thead><tr>${colunas.map((i) => `<th>${esc(head[i])}</th>`).join("")}</tr></thead><tbody>${rows.slice(1).map((r) =>
    `<tr>${colunas.map((i) => `<td data-rotulo="${esc(head[i])}">${esc(r[i])}</td>`).join("")}</tr>`).join("")}</tbody></table>${nota ? `<p class="nota">${esc(nota)}</p>` : ""}`;
}

const imagem = (caminho, alt) => (/^(img|uploads)\/[\w.-]+$/.test(caminho || "") ? `<img class="tabimg" src="/${esc(caminho)}" alt="${esc(alt)}">` : "");

function blocoValores({ precos: v, vidas, plano: p }) {
  const temE = v.enf != null, temA = v.apto != null;
  const total = (rotulo, valor) => `<div><span>${rotulo}</span><strong>R$ ${brl(valor)}</strong></div>`;
  const totais = temE || temA
    ? `<div class="totais">${temE ? total("Enfermaria", v.enf) : ""}${temA ? total("Apartamento", v.apto) : ""}</div>`
    : `<p class="consulta">Valores sob consulta</p>`;
  const faixas = v.porFaixa
    ? `<table class="fx"><thead><tr><th>Faixa etária</th><th>Vidas</th>${temE ? "<th>Enfermaria</th>" : ""}${temA ? "<th>Apartamento</th>" : ""}</tr></thead><tbody>${v.linhas.map((l) =>
      `<tr><td>${esc(l.faixa)} anos</td><td>${l.n}</td>${temE ? `<td>R$ ${brl(l.enf)}</td>` : ""}${temA ? `<td>R$ ${brl(l.apto)}</td>` : ""}</tr>`).join("")}</tbody></table>`
    : "";
  const extras = [p.taxa ? `+ R$ ${brl(p.taxa)} de taxa associativa` : "", p.odonto ? "12 meses de odontológico incluso" : ""].filter(Boolean).join(" · ");
  const titulo = v.porFaixa ? `Valor mensal total · ${vidas} ${vidas === 1 ? "vida" : "vidas"}` : "Valor da mensalidade";
  return `<section class="valores"><h2 class="sobre">${titulo}</h2>${totais}${faixas}${extras ? `<p class="extras">${esc(extras)}</p>` : ""}</section>`;
}

export function renderizarProposta(s) {
  const p = s.plano, c = s.corretor, T = themeFor(p);
  const sec = (titulo, corpo) => `<section><h2>${esc(titulo)}</h2>${corpo}</section>`;
  const blocos = [`<p class="ola">${s.cliente ? `Olá, ${esc(s.cliente)}! ` : "Olá! "}Preparamos esta proposta para que você conheça as condições do plano ${esc(p.nome)}.</p>`, blocoValores(s)];
  if (p.beneficios.length) blocos.push(sec("Benefícios do plano", `<ul class="livre">${p.beneficios.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`));
  const copTab = p.copartTabela ? tabela(p.copartTabela, p.copartNota) : imagem(p.imgCopart, "Tabela de coparticipação");
  if (p.copartTexto || copTab) blocos.push(sec(p.copartTexto ? "Como funciona a coparticipação?" : "Tabela de coparticipação", `${p.copartTexto ? `<p>${esc(p.copartTexto)}</p>` : ""}${copTab}`));
  const carTab = p.carenciaTabela ? tabela(p.carenciaTabela, p.carenciaNota) : imagem(p.imgCarencia, "Tabela de carências");
  if (carTab) blocos.push(sec("Carências", carTab));
  if (p.rede.length) blocos.push(sec(`Rede credenciada – ${p.cidade || "Uberlândia"}`, `<ul>${p.rede.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>`));
  if (p.fidelidade) blocos.push(`<p class="fidelidade">⚠️ Planos CNPJ geram fidelidade de 1 ano.</p>`);
  if (s.legendaAcomodacao) blocos.push(`<p class="nota">*Enfermaria: acomodação compartilhada. *Apartamento: acomodação individual.</p>`);
  const contato = [c.empresa, c.fone].filter(Boolean).join(" · ");
  const titulo = `Proposta ${p.nome}`;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="Valores, coparticipação, carências e rede credenciada.">
<title>${esc(titulo)}</title>
<style>
@font-face{font-family:Figtree;font-weight:300 900;font-display:swap;src:url(/fonts/figtree-latin-wght-normal.woff2) format("woff2")}
@font-face{font-family:"Bricolage Grotesque";font-weight:200 800;font-display:swap;src:url(/fonts/bricolage-grotesque-latin-wght-normal.woff2) format("woff2")}
*{box-sizing:border-box}
body{margin:0;background:${T.bg};color:${T.ink};font:500 16px/1.5 Figtree,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
header,footer{background:${T.band};color:${T.white};padding:24px 20px}
header small{display:block;color:${T.eyebrow};font-weight:700;font-size:13px;letter-spacing:.04em;text-transform:uppercase}
h1{font:700 30px/1.15 "Bricolage Grotesque",Figtree,sans-serif;margin:6px 0}
header p{margin:0;color:${T.sub}}
main{max-width:760px;margin:0 auto;padding:20px 16px}
section{margin:0 0 26px}
h2{font:700 21px/1.25 "Bricolage Grotesque",Figtree,sans-serif;color:${T.accent};margin:0 0 10px}
h2.sobre{font:700 12.5px/1.3 Figtree,sans-serif;color:${T.muted};letter-spacing:.04em;text-transform:uppercase}
p{margin:0 0 12px}
.valores{background:${T.white};border-radius:16px;padding:18px}
.totais{display:flex;flex-wrap:wrap;gap:12px 28px}
.totais span{display:block;color:${T.muted};font-weight:600;font-size:14px}
.totais strong{font:700 27px/1.2 "Bricolage Grotesque",Figtree,sans-serif;font-variant-numeric:tabular-nums}
.consulta{font:700 24px "Bricolage Grotesque",Figtree,sans-serif;margin:0}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.fx{margin-top:14px;font-size:14px;font-weight:600}
.fx th{color:${T.muted};font-size:11px;font-weight:700;text-align:left;text-transform:uppercase;padding:6px}
.fx td{padding:8px 6px}
.fx tbody tr:nth-child(odd){background:${T.soft}}
.extras{color:${T.accent};font-weight:700;font-size:14px;margin:12px 0 0}
.tab{background:${T.white};border-radius:14px;overflow:hidden;box-shadow:0 0 0 1px ${T.line};font-size:15px}
.tab th{background:${T.thead};color:${T.white};font-size:13px;font-weight:700;padding:11px 12px;text-align:center}
.tab td{padding:11px 12px;text-align:center;font-weight:700;color:${T.val};border-top:1px solid ${T.line}}
.tab th:first-child,.tab td:first-child{text-align:left}
.tab td:first-child{color:${T.ink};font-weight:600}
.tab tbody tr:nth-child(even){background:${T.soft2}}
.nota{color:${T.muted};font-size:13.5px;margin-top:10px}
.tabimg{display:block;width:100%;height:auto;background:${T.white};border-radius:10px}
ul{margin:0;padding-left:20px}
ul.livre{list-style:none;padding:0}
li{margin:5px 0;font-weight:600}
.fidelidade{color:${T.danger};font-weight:700}
footer{display:flex;flex-wrap:wrap;gap:6px 20px;justify-content:space-between}
footer b{display:block;font-size:17px}
footer span{color:${T.sub};font-size:14px}
footer time{color:${T.eyebrow};font-size:14px}
@media (max-width:640px){
  .larga thead{display:none}
  .larga,.larga tbody,.larga tr,.larga td{display:block;width:100%}
  .larga tr{padding:8px 0;border-top:1px solid ${T.line}}
  .larga tr:first-child{border-top:0}
  .larga td{display:flex;justify-content:space-between;gap:16px;border:0;padding:5px 12px;text-align:right}
  .larga td::before{content:attr(data-rotulo);flex:1 1 0;color:${T.muted};font-size:13px;font-weight:600;text-align:left}
  .larga td:first-child{display:block;font-size:15.5px;font-weight:700;text-align:left}
  .larga td:first-child::before{content:none}
  .larga td:empty{display:none}
}
</style>
</head>
<body>
<header><small>${s.cliente ? `Proposta para ${esc(s.cliente)}` : "Proposta de plano de saúde"}</small><h1>${esc(p.nome)}</h1>${p.subtitulo ? `<p>${esc(p.subtitulo)}</p>` : ""}</header>
<main>${blocos.join("\n")}</main>
<footer><div><b>${esc(c.nome || "Cotação de plano de saúde")}</b><span>${esc(contato || "Valores sujeitos a confirmação da operadora")}</span></div><time>Cotação de ${esc(s.data)}</time></footer>
</body>
</html>`;
}
