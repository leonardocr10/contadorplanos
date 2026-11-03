// Página HTML da proposta, aberta pelo cliente no celular. Segue os mesmos blocos da imagem em canvas.
import { FAIXAS, brl, lines, normFone, planPrices, r2, totalVidas } from "../public/js/calculo.js";
import { linkWhatsApp } from "../public/js/mensagem.js";
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
      nome: p.nome, subtitulo: p.subtitulo, categoria: p.categoria, cidade: p.cidade, taxa: p.taxa, odonto: p.odonto, fidelidade: p.fidelidade,
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

// Acomodações que o cliente pode aceitar: só as que têm valor nesta proposta.
export function opcoesDeAceite(s) {
  const o = [];
  if (s.precos.enf != null) o.push({ nome: "Enfermaria", valor: s.precos.enf });
  if (s.precos.apto != null) o.push({ nome: "Apartamento", valor: s.precos.apto });
  return o;
}

function blocoAceite(s, { token, aceite, documentos = [] }) {
  if (aceite?.aceitoEm) {
    const data = new Date(aceite.aceitoEm).toLocaleDateString("pt-BR");
    const fone = normFone(s.corretor.fone);
    const contato = fone.length >= 10
      ? `<a class="botao" href="${esc(linkWhatsApp(fone, `Olá! Aceitei a proposta do plano ${s.plano.nome}. Seguem os meus documentos.`))}">Enviar documentos pelo WhatsApp</a>`
      : "";
    return `<section class="aceite feito"><h2>Proposta aceita</h2><p>Você aceitou esta proposta em ${esc(data)}: <b>${esc(aceite.acomodacao)}, R$ ${brl(aceite.valor)} por mês</b>.</p>${documentos.length
      ? `<h3>Documentos necessários</h3><p>Para dar andamento, precisamos que você nos envie:</p><ul>${documentos.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>${contato}`
      : "<p>Em breve entraremos em contato com os próximos passos.</p>"}</section>`;
  }
  const opcoes = opcoesDeAceite(s);
  if (!token || !opcoes.length) return "";
  const unica = opcoes.length === 1;
  return `<section class="aceite" id="aceite"><h2>Aceitar esta proposta</h2>
<form method="post" action="/p/${esc(token)}/aceite">
<fieldset><legend>Escolha a acomodação</legend>${opcoes.map((o) =>
    `<label class="opcao"><input type="radio" name="acomodacao" value="${o.nome}" required${unica ? " checked" : ""}> <span>${o.nome}</span> <b>R$ ${brl(o.valor)}</b></label>`).join("")}</fieldset>
<label class="confirma"><input type="checkbox" name="confirmo" value="1" required> Li as condições desta proposta e quero seguir com a contratação.</label>
<button class="botao" type="submit">Aceitar proposta</button>
</form></section>`;
}

export function renderizarProposta(s, aceitacao = {}) {
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
  const aceite = blocoAceite(s, aceitacao);
  // Depois de aceitar, a confirmação e os documentos ficam no topo; antes, o formulário fecha a página.
  if (aceitacao.aceite?.aceitoEm) blocos.unshift(aceite);
  else if (aceite) blocos.push(aceite);
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
.aceite{background:${T.white};border-radius:16px;padding:18px;box-shadow:0 0 0 2px ${T.thead}}
.aceite h3{font:700 17px/1.3 "Bricolage Grotesque",Figtree,sans-serif;margin:16px 0 6px}
fieldset{border:0;margin:0 0 12px;padding:0}
legend{font-weight:700;padding:0;margin-bottom:8px}
.opcao{display:flex;align-items:center;gap:10px;border:1px solid ${T.line};border-radius:12px;padding:12px;margin-bottom:8px;cursor:pointer}
.opcao span{flex:1;font-weight:600}
.opcao b{font-variant-numeric:tabular-nums;color:${T.val}}
.confirma{display:flex;gap:10px;align-items:flex-start;font-size:14.5px;margin-bottom:14px;cursor:pointer}
input[type=radio],input[type=checkbox]{width:20px;height:20px;flex:none;accent-color:${T.thead}}
.botao{display:block;width:100%;border:0;border-radius:12px;background:${T.thead};color:${T.white};font:700 17px Figtree,sans-serif;padding:15px;margin-top:12px;text-align:center;text-decoration:none;cursor:pointer}
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
