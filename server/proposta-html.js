// Página HTML da proposta, aberta pelo cliente: layout com painel lateral, sem rolagem no computador.
import { FAIXAS, brl, lines, normFone, parseBRL, planPrices, r2, totalVidas } from "../public/js/calculo.js";
import { linkWhatsApp } from "../public/js/mensagem.js";
import { hex2rgb, lumRGB, mixRGB, toHex } from "../public/js/cores.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const temTabela = (t) => String(t || "").includes("|");
const moeda = (v) => `R$ ${brl(v)}`;

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
      id: p.id, nome: p.nome, subtitulo: p.subtitulo, categoria: p.categoria, cidade: p.cidade, taxa: p.taxa, odonto: p.odonto, fidelidade: p.fidelidade,
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

// Acomodações que o cliente pode aceitar: só as que têm valor nesta proposta.
export function opcoesDeAceite(s) {
  const o = [];
  if (s.precos.enf != null) o.push({ nome: "Enfermaria", valor: s.precos.enf });
  if (s.precos.apto != null) o.push({ nome: "Apartamento", valor: s.precos.apto });
  return o;
}

/* ---------- adaptador: dados da proposta para o formato do layout ---------- */
const celulas = (txt) => String(txt || "").split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((r) => r.some(Boolean));
const semParenteses = (s) => s.trim().replace(/^\((.*)\)$/, "$1");

// Texto que o layout não sabe separar em % e teto aparece como está na tabela da operadora.
export function linhaCoparticipacao(colunas) {
  const [nome, ...valores] = colunas;
  const original = valores.filter(Boolean).join(" · ");
  if (valores.length === 2) {
    const pct = valores[0].match(/^(\d+(?:[.,]\d+)?)\s*%$/);
    const limite = /^[\d.]+,\d{2}$/.test(valores[1].replace(/^R\$\s*/, "")) ? parseBRL(valores[1]) : null;
    if (pct && limite != null) return { nome, tipo: "pct", pct: pct[1], teto: limite };
    if (/^[–—-]?$/.test(valores[0]) && limite != null) return { nome, tipo: "fixo", valor: limite };
    return { nome, tipo: "texto", texto: original };
  }
  if (valores.length !== 1) return { nome, tipo: "texto", texto: original };
  const v = valores[0];
  if (/^isento$/i.test(v)) return { nome, tipo: "isento" };
  const pct = v.match(/^(\d+(?:[.,]\d+)?)\s*%(?:\s+limitado a\s+R\$\s*([\d.]+,\d{2}))?(.*)$/i);
  if (pct) return { nome, tipo: "pct", pct: pct[1], teto: pct[2] ? parseBRL(pct[2]) : null, detalhe: semParenteses(pct[3]) };
  const fixo = v.match(/^R\$\s*([\d.]+,\d{2})(.*)$/);
  if (fixo) return { nome, tipo: "fixo", valor: parseBRL(fixo[1]), detalhe: semParenteses(fixo[2]) };
  return { nome, tipo: "texto", texto: original };
}

export const fmtDias = (d) => (d >= 720 && d % 30 === 0 ? `${d / 30} meses` : d <= 1 ? `${d} dia` : `${d} dias`);
export const nivelPrazo = (d) => (d == null ? "neutro" : d === 0 ? "ok" : d <= 30 ? "low" : d < 180 ? "mid" : "high");

// Prazos em dias seguem o padrão do layout; "24 horas" e "24 meses" ficam como na tabela da operadora.
export function prazo(texto) {
  const m = String(texto).match(/^(\d+)\s*(hora|dia|m[eê]s|mes|ano)/i);
  if (!m) return { texto, dias: null };
  const n = Number(m[1]), unidade = m[2].toLowerCase();
  if (unidade === "dia") return { texto: fmtDias(n), dias: n };
  const dias = unidade === "hora" ? Math.ceil(n / 24) : unidade === "ano" ? n * 365 : n * 30;
  return { texto, dias };
}

function nomeSituacao(titulo) {
  const m = titulo.match(/^(.*?)\s*\((PRC\s*\d+)\)$/i);
  return m ? `${m[1]} · ${m[2]}` : titulo;
}

const ICONE_POR_EMOJI = { "🦷": "smile", "📱": "phone", "✈": "plane", "💊": "pill" };

function beneficio(linha) {
  const inicio = linha.match(/^[^\p{L}\p{N}(]+/u)?.[0] ?? "";
  const icone = Object.entries(ICONE_POR_EMOJI).find(([e]) => inicio.includes(e))?.[1] ?? "check";
  const m = linha.slice(inicio.length).match(/^(.*?)\s*(\([^()]*\))?$/);
  return { icone, texto: m[1], detalhe: m[2] ?? "" };
}

function listaFaixas(linhas) {
  const f = linhas.map((l) => l.faixa);
  if (!f.length) return "";
  const lista = f.length > 1 ? `${f.slice(0, -1).join(", ")} e ${f.at(-1)}` : f[0];
  return `${lista} anos`;
}

export function paraProposta(s) {
  const p = s.plano, c = s.corretor;
  const tabelaCop = celulas(p.copartTabela), tabelaCar = celulas(p.carenciaTabela);
  const opcoes = opcoesDeAceite(s);
  const nColunas = Math.max(0, ...tabelaCar.map((r) => r.length));
  const beneficios = p.beneficios.map(beneficio);
  if (p.odonto && !beneficios.some((b) => b.icone === "smile")) beneficios.unshift({ icone: "smile", texto: "12 meses de odontológico incluso", detalhe: "" });
  return {
    cliente: s.cliente,
    vidas: s.vidas,
    faixaEtaria: listaFaixas(s.precos.linhas),
    // Subtotal de cada faixa. Acomodação sem valor em alguma faixa fica de fora, como nos totais.
    faixas: {
      temEnf: s.precos.enf != null,
      temApto: s.precos.apto != null,
      linhas: s.precos.linhas,
    },
    plano: p.nome,
    subtitulo: p.subtitulo,
    taxa: p.taxa ? `+ ${moeda(p.taxa)} de taxa associativa` : "",
    cotacao: s.data,
    precos: opcoes.map((o, i) => ({ label: o.nome, valor: o.valor, destaque: i === opcoes.length - 1 })),
    beneficios,
    rede: { cidade: p.cidade || "Uberlândia", hospitais: p.rede },
    consultor: { nome: c.nome, corretora: c.empresa, telefone: c.fone },
    copartTexto: p.copartTexto,
    coparticipacao: tabelaCop.slice(1).map(linhaCoparticipacao),
    imagemCoparticipacao: p.imgCopart,
    situacoes: (tabelaCar[0] ?? []).slice(1, Math.max(nColunas, 1)).map(nomeSituacao),
    carencias: tabelaCar.slice(1).map((r) => ({ nome: r[0], prazos: Array.from({ length: nColunas - 1 }, (_, i) => prazo(r[i + 1] ?? "")) })),
    imagemCarencia: p.imgCarencia,
    fidelidade: !!p.fidelidade,
    rodape: [p.copartNota, p.carenciaNota, s.legendaAcomodacao ? "Enfermaria: acomodação compartilhada. Apartamento: acomodação individual." : ""].filter(Boolean),
  };
}

/* ---------- cores da página, a partir da cor do plano ---------- */
const BRANCO = [255, 255, 255], PRETO = [0, 0, 0];
export const contraste = (a, b) => {
  const [x, y] = [lumRGB(a), lumRGB(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

// Cor de operadora clara demais é escurecida até ficar legível sobre o fundo, e o texto claro é clareado.
function ajustarContraste(cor, fundo, direcao) {
  let c = cor;
  // O arredondamento pode parar antes do branco ou do preto puros; por isso o limite de passos.
  for (let i = 0; i < 60; i++) {
    if (contraste(c, fundo) >= 4.5) return c;
    c = mixRGB(c, direcao, 0.05);
  }
  return direcao;
}
const legivelComBranco = (cor) => ajustarContraste(cor, BRANCO, PRETO);

export function paletaProposta(p) {
  const principal = hex2rgb(p.corPrimaria) ?? hex2rgb(p.corEscura) ?? [0, 103, 179];
  const escura = hex2rgb(p.corEscura) ?? mixRGB(principal, PRETO, 0.45);
  const accent = legivelComBranco(principal), navy = legivelComBranco(escura);
  const side = mixRGB(principal, BRANCO, 0.95);
  return {
    navy: toHex(navy),
    accent: toHex(accent),
    accentNaBarra: toHex(ajustarContraste(accent, side, PRETO)),
    side: toHex(side),
    zebra: toHex(mixRGB(principal, BRANCO, 0.98)),
    line: toHex(mixRGB(principal, BRANCO, 0.84)),
    lineSoft: toHex(mixRGB(principal, BRANCO, 0.93)),
    sobreNavy: toHex(ajustarContraste(mixRGB(navy, BRANCO, 0.8), navy, BRANCO)),
    rotuloNavy: toHex(ajustarContraste(mixRGB(navy, BRANCO, 0.68), navy, BRANCO)),
    sobreAccent: toHex(ajustarContraste(mixRGB(accent, BRANCO, 0.88), accent, BRANCO)),
  };
}

const variaveisDeCor = (c) => `:root{--navy:${c.navy};--accent:${c.accent};--accent-barra:${c.accentNaBarra};--side:${c.side};--zebra:${c.zebra};--line:${c.line};--line-soft:${c.lineSoft};--sobre-navy:${c.sobreNavy};--rotulo-navy:${c.rotuloNavy};--sobre-accent:${c.sobreAccent}}`;

/* ---------- blocos da página ---------- */
const ICONES = {
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01"/><path d="M15 9h.01"/>',
  phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  pill: '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};
const svg = (n, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="color:var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[n]}</svg>`;
const SVG_TELEFONE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
const contagem = (lista) => `· ${lista.length} ${lista.length === 1 ? "item" : "itens"}`;
const imagem = (caminho, alt) => (/^(img|uploads)\/[\w.-]+$/.test(caminho || "") ? `<img class="tabimg" src="/${esc(caminho)}" alt="${esc(alt)}">` : "");

function blocoFaixas({ temEnf, temApto, linhas }) {
  if (!linhas.length || (!temEnf && !temApto)) return "";
  return `<section class="faixas">
      <h2 class="eyebrow">Valor por faixa etária</h2>
      <ul>${linhas.map((l) => `<li>
        <b>${esc(l.faixa)} anos${l.n > 1 ? ` <span class="vezes">× ${l.n}</span>` : ""}</b>
        ${temEnf ? `<span>Enf. ${moeda(l.enf)}</span>` : ""}
        ${temApto ? `<span>Apto ${moeda(l.apto)}</span>` : ""}
      </li>`).join("")}</ul>
    </section>`;
}

// Na imagem, os valores por idade ficam na barra lateral.
function tabelaFaixasLateral({ temEnf, temApto, linhas }) {
  if (!linhas.length || (!temEnf && !temApto)) return "";
  return `<div class="faixas-lado">
      <span class="eyebrow">Valor por faixa etária</span>
      <table><thead><tr><th>Idade</th>${temEnf ? "<th>Enf.</th>" : ""}${temApto ? "<th>Apto</th>" : ""}</tr></thead>
      <tbody>${linhas.map((l) => `<tr><td>${esc(l.faixa)}${l.n > 1 ? ` × ${l.n}` : ""}</td>${temEnf ? `<td>${moeda(l.enf)}</td>` : ""}${temApto ? `<td>${moeda(l.apto)}</td>` : ""}</tr>`).join("")}</tbody></table>
    </div>`;
}

function barraLateral(P, paraImagem) {
  const vidas = P.vidas ? `${P.vidas} ${P.vidas === 1 ? "vida" : "vidas"}${P.faixaEtaria ? ` · ${P.faixaEtaria}` : ""}` : "";
  const fone = String(P.consultor.telefone || "").replace(/\D/g, "");
  return `<aside class="side">
    <div class="stack" style="gap:4px">
      <span class="eyebrow blue">Proposta para</span>
      <span class="client">${esc(P.cliente || "Você")}</span>
      ${vidas ? `<span class="small">${esc(vidas)}</span>` : ""}
    </div>
    ${paraImagem ? tabelaFaixasLateral(P.faixas) : ""}
    ${P.beneficios.length ? `<div class="stack" style="gap:12px"><span class="eyebrow">Incluso no plano</span><div class="stack" style="gap:12px">${P.beneficios.map((b) =>
      `<div class="item">${svg(b.icone)}<span>${esc(b.texto)}${b.detalhe ? ` <span class="small">${esc(b.detalhe)}</span>` : ""}</span></div>`).join("")}</div></div>` : ""}
    ${P.rede.hospitais.length ? `<div class="stack" style="gap:8px"><span class="eyebrow">Rede · ${esc(P.rede.cidade)}</span><div class="stack" style="gap:8px">${P.rede.hospitais.map((h) =>
      `<div class="item">${svg("pin", 16)}<span>${esc(h)}</span></div>`).join("")}</div></div>` : ""}
    ${P.consultor.nome || fone ? `<div class="consultant">
      <span class="eyebrow">Seu consultor</span>
      ${P.consultor.nome ? `<span style="font-size:16px;font-weight:800">${esc(P.consultor.nome)}</span>` : ""}
      ${P.consultor.corretora ? `<span style="font-size:13px;color:var(--sobre-navy)">${esc(P.consultor.corretora)}</span>` : ""}
      ${fone ? `<a href="tel:${esc(fone)}">${SVG_TELEFONE}<span>${esc(P.consultor.telefone)}</span></a>` : ""}
    </div>` : ""}
  </aside>`;
}

function linhaCop(c) {
  const nome = `<span>${esc(c.nome)}${c.detalhe ? ` <span class="small">${esc(c.detalhe)}</span>` : ""}</span>`;
  if (c.tipo === "texto") return `<div class="copart-row">${nome}<span class="r cap inteiro">${esc(c.texto)}</span></div>`;
  const pct = c.tipo === "pct" ? `${esc(c.pct)}%` : c.tipo === "isento" ? "isento" : "fixo";
  const teto = c.tipo === "fixo" ? moeda(c.valor) : c.tipo === "pct" && c.teto != null ? moeda(c.teto) : "—";
  return `<div class="copart-row">${nome}<span class="r pct">${pct}</span><span class="r cap">${teto}</span></div>`;
}

function secaoCoparticipacao(P) {
  const figura = imagem(P.imagemCoparticipacao, "Tabela de coparticipação");
  if (!P.coparticipacao.length && !figura) return "";
  return `<section class="col">
    <div class="stack" style="gap:2px">
      <h2>Coparticipação ${P.coparticipacao.length ? `<span class="count">${contagem(P.coparticipacao)}</span>` : ""}</h2>
      ${P.copartTexto ? `<span class="explica">${esc(P.copartTexto)}</span>` : ""}
    </div>
    ${P.coparticipacao.length
    ? `<div class="copart-head"><span>Procedimento</span><span class="r">%</span><span class="r">Teto</span></div><div>${P.coparticipacao.map(linhaCop).join("")}</div>`
    : figura}
  </section>`;
}

function secaoCarencias(P) {
  const figura = imagem(P.imagemCarencia, "Tabela de carências");
  if (!P.carencias.length && !figura) return "";
  if (!P.carencias.length) return `<section class="col wide"><h2>Carências</h2>${figura}</section>`;
  const varias = P.situacoes.length > 1;
  const seletor = varias
    ? `<label class="sel">Situação do plano anterior<select id="situacao">${P.situacoes.map((s, i) => `<option value="${i}">${esc(s)}</option>`).join("")}</select></label>`
    : "";
  // Cada situação já vem pronta no HTML: o seletor só troca qual lista fica visível.
  const listas = P.situacoes.map((_, i) => `<div class="car-list" data-situacao="${i}"${i ? " hidden" : ""}>${P.carencias.map((c) => {
    const p = c.prazos[i];
    return `<div class="car-row"><span>${esc(c.nome)}</span>${p.texto ? `<span class="pill ${nivelPrazo(p.dias)}">${esc(p.texto)}</span>` : ""}</div>`;
  }).join("")}</div>`).join("");
  return `<section class="col wide">
    <div class="car-top"><h2>Carências <span class="count">${contagem(P.carencias)}</span></h2>${seletor}</div>
    ${listas}
  </section>`;
}

function botaoAceite(s, { token, aceite }, paraImagem) {
  const opcoes = opcoesDeAceite(s);
  if (paraImagem) return opcoes.length ? `<details class="aceitar"><summary>Aceitar proposta</summary></details>` : "";
  if (aceite?.aceitoEm || !token || !opcoes.length) return "";
  const unica = opcoes.length === 1;
  return `<details class="aceitar">
    <summary>Aceitar proposta</summary>
    <form class="painel" method="post" action="/p/${esc(token)}/aceite">
      <fieldset><legend>Escolha a acomodação</legend>${opcoes.map((o) =>
    `<label class="opcao"><input type="radio" name="acomodacao" value="${o.nome}" required${unica ? " checked" : ""}> <span>${o.nome}</span> <b>${moeda(o.valor)}</b></label>`).join("")}</fieldset>
      <label class="confirma"><input type="checkbox" name="confirmo" value="1" required> <span>Li as condições desta proposta e quero seguir com a contratação.</span></label>
      <button class="botao" type="submit">Confirmar aceite</button>
    </form>
  </details>`;
}

function avisoAceito(s, { aceite, documentos = [] }) {
  if (!aceite?.aceitoEm) return "";
  const data = new Date(aceite.aceitoEm).toLocaleDateString("pt-BR");
  const fone = normFone(s.corretor.fone);
  const contato = fone.length >= 10
    ? `<a class="botao" href="${esc(linkWhatsApp(fone, `Olá! Aceitei a proposta do plano ${s.plano.nome}. Seguem os meus documentos.`))}">Enviar documentos pelo WhatsApp</a>`
    : "";
  return `<section class="aceito">
    <h2>Proposta aceita</h2>
    <p>Você aceitou esta proposta em ${esc(data)}: <b>${esc(aceite.acomodacao)}, ${moeda(aceite.valor)} por mês</b>.</p>
    ${documentos.length
    ? `<h3>Documentos necessários</h3><p>Para dar andamento, precisamos que você nos envie:</p><ul>${documentos.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>${contato}`
    : "<p>Em breve entraremos em contato com os próximos passos.</p>"}
  </section>`;
}

const CSS = `
@font-face{font-family:Manrope;font-weight:200 800;font-display:swap;src:url(/fonts/manrope-latin-wght-normal.woff2) format("woff2")}
:root{--ink:#10243a;--muted:#4a5d70;
  --ok-bg:#e8f4ec;--ok:#145a32;--low-bg:#e6f1fb;--low:#00508c;--mid-bg:#fff6d6;--mid:#6b4d00;--high-bg:#ffe8d6;--high:#8a3b00}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;font-family:Manrope,system-ui,sans-serif;color:var(--ink);background:#fff}
.page{min-height:100vh;display:flex;flex-wrap:wrap}
.side{flex:1 1 270px;max-width:100%;background:var(--side);border-right:1px solid var(--line);padding:28px 24px;display:flex;flex-direction:column;gap:24px}
.main{flex:999 1 640px;min-width:0;padding:28px 36px;display:flex;flex-direction:column;gap:22px}
.eyebrow{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.eyebrow.blue{color:var(--accent-barra)}
.stack{display:flex;flex-direction:column}
.client{font-size:18px;font-weight:800;line-height:1.3}
.small{font-size:13px;color:var(--muted)}
.item{display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:1.4}
.item svg{flex:none;margin-top:1px}
.faixas{display:flex;align-items:flex-start;gap:6px 14px;margin-top:-8px}
.faixas h2{flex:0 0 96px;margin:0;font-size:11px;font-weight:700;line-height:1.3;color:var(--muted)}
.faixas ul{flex:1;min-width:0;display:flex;flex-wrap:wrap;gap:6px 8px;margin:0;padding:0;list-style:none}
.faixas li{display:flex;flex-wrap:wrap;gap:2px 10px;padding:4px 10px;border:1px solid var(--line);border-radius:8px;background:var(--side);font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}
.faixas li b{font-weight:800;color:var(--navy)}
.vezes{color:var(--accent)}
.consultant{margin-top:auto;background:var(--navy);color:#fff;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:6px}
.consultant .eyebrow{color:var(--rotulo-navy);letter-spacing:.06em}
.consultant a{margin-top:4px;min-height:44px;display:flex;align-items:center;justify-content:center;gap:8px;background:#fff;color:var(--navy);border-radius:10px;font-weight:700;font-size:14px;text-decoration:none}
.hero{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:20px;padding-bottom:20px;border-bottom:1px solid var(--line)}
h1{margin:0;font-size:36px;font-weight:800;letter-spacing:-.02em;color:var(--navy)}
.meta{font-size:12px;font-weight:700;color:var(--muted)}
.sub{font-size:14px;color:var(--muted)}
.taxa{font-size:13px;font-weight:700;color:var(--accent)}
.lado{display:flex;flex-wrap:wrap;gap:12px;align-items:stretch}
.prices{display:flex;flex-wrap:wrap;gap:12px}
.price{min-width:200px;border:1px solid var(--line);border-radius:16px;padding:14px 18px;display:flex;flex-direction:column;gap:2px}
.price.featured{background:var(--accent);border-color:var(--accent);color:#fff}
.price .label{font-size:13px;font-weight:700;color:var(--muted)}
.price.featured .label{color:var(--sobre-accent)}
.price .value{font-size:30px;font-weight:800;letter-spacing:-.02em;white-space:nowrap}
.aceitar{position:relative;display:flex}
.aceitar summary{list-style:none;display:flex;align-items:center;justify-content:center;min-height:44px;padding:0 20px;border-radius:16px;background:var(--navy);color:#fff;font-weight:800;font-size:15px;cursor:pointer;width:100%}
.aceitar summary::-webkit-details-marker{display:none}
.aceitar summary:focus-visible,.botao:focus-visible,select:focus-visible,.consultant a:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.painel{position:absolute;right:0;top:calc(100% + 8px);z-index:5;width:340px;max-width:calc(100vw - 32px);background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px;box-shadow:0 12px 32px rgba(0,40,70,.18)}
fieldset{border:0;margin:0 0 10px;padding:0}
legend{font-weight:800;font-size:14px;padding:0;margin-bottom:8px}
.opcao{display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:8px;font-size:14px;cursor:pointer}
.opcao span{flex:1;font-weight:600}
.opcao b{white-space:nowrap;color:var(--navy)}
.confirma{display:flex;gap:10px;align-items:flex-start;font-size:13px;line-height:1.4;cursor:pointer}
input[type=radio],input[type=checkbox]{width:18px;height:18px;flex:none;accent-color:var(--accent)}
.botao{display:flex;align-items:center;justify-content:center;width:100%;min-height:44px;margin-top:12px;border:0;border-radius:10px;background:var(--accent);color:#fff;font:800 15px Manrope,system-ui,sans-serif;text-decoration:none;cursor:pointer}
.aceito{border:2px solid var(--accent);border-radius:16px;padding:16px 18px;font-size:14px;line-height:1.45}
.aceito p{margin:6px 0}
.aceito h3{margin:12px 0 0;font-size:15px;font-weight:800;color:var(--navy)}
.aceito ul{margin:4px 0;padding-left:20px}
.aceito .botao{max-width:340px}
.cols{display:flex;flex-wrap:wrap;gap:32px}
.col{flex:1 1 320px;min-width:0;display:flex;flex-direction:column;gap:10px}
.col.wide{flex:1.2 1 360px}
h2{margin:0;font-size:17px;font-weight:800;color:var(--navy)}
h2 .count{font-size:13px;font-weight:600;color:var(--muted)}
.explica{font-size:12px;line-height:1.4;color:var(--muted)}
.copart-head,.copart-row{display:grid;grid-template-columns:minmax(0,1fr) 56px 92px;gap:8px;align-items:center;padding:6px 10px}
.copart-head{padding-bottom:4px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line)}
.copart-row,.car-row{font-size:13px;border-bottom:1px solid var(--line-soft)}
.copart-row:nth-child(even),.car-row:nth-child(even){background:var(--zebra)}
.copart-row .small{font-size:11px}
.r{text-align:right}.pct{font-weight:700;color:var(--accent)}.cap{font-weight:600}
.inteiro{grid-column:2/4}
.car-top{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:8px 16px}
label.sel{display:flex;flex-direction:column;gap:4px;min-width:0;max-width:100%;font-size:12px;font-weight:700;color:var(--muted)}
select{min-height:40px;width:100%;max-width:420px;padding:0 10px;border:1px solid var(--line);border-radius:10px;font:600 13px Manrope,system-ui,sans-serif;color:var(--ink);background:#fff}
label.sel select,label.sel .fs{width:320px;max-width:100%}
.fs-botao{font-size:13px;font-weight:600}
.car-list{border-top:1px solid var(--line)}
.car-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 10px}
.pill{flex:none;min-width:70px;text-align:center;padding:2px 8px;border-radius:999px;font-weight:700;font-size:12px;white-space:nowrap}
.pill.ok{background:var(--ok-bg);color:var(--ok)}.pill.low{background:var(--low-bg);color:var(--low)}
.pill.mid{background:var(--mid-bg);color:var(--mid)}.pill.high{background:var(--high-bg);color:var(--high)}
.pill.neutro{background:var(--line-soft);color:var(--ink)}
.faixas-lado{display:flex;flex-direction:column;gap:6px}
.faixas-lado table{width:100%;border-collapse:collapse;font-size:11.5px;font-variant-numeric:tabular-nums}
.faixas-lado th{padding:0 0 4px;font-size:10.5px;font-weight:700;text-align:right;color:var(--muted);border-bottom:1px solid var(--line)}
.faixas-lado td{padding:4px 0 4px 6px;text-align:right;white-space:nowrap;border-bottom:1px solid var(--line)}
.faixas-lado th:first-child,.faixas-lado td:first-child{padding-left:0;text-align:left;font-weight:800;color:var(--navy)}
.tabimg{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:10px}
.note{margin:0;font-size:12px;color:var(--muted);line-height:1.45}
.fidelidade{margin:0;font-size:13px;font-weight:800;color:#a3211f}
@media (max-width:640px){.main{padding:20px 16px}.side{padding:20px 16px;border-right:0;border-bottom:1px solid var(--line)}h1{font-size:28px}.lado,.prices,.aceitar{width:100%}.price{flex:1 1 100%}.aceitar{flex-direction:column}.painel{position:static;width:100%;max-width:100%;margin-top:8px}.faixas{flex-direction:column}.faixas h2{flex:none}.faixas ul,.faixas li{width:100%}.faixas ul{flex:none}.faixas li{justify-content:space-between;padding:6px 10px}.faixas li b{flex:1 1 100%}}
`;

// paraImagem: a página sem script, com o botão de aceite só desenhado e os valores por idade na barra lateral.
export function renderizarProposta(s, aceitacao = {}, { paraImagem = false } = {}) {
  const P = paraProposta(s);
  const titulo = `Proposta ${P.plano}`;
  const precos = P.precos.length
    ? P.precos.map((p) => `<div class="price${p.destaque ? " featured" : ""}"><span class="label">${esc(p.label)}</span><span class="value">${moeda(p.valor)}</span></div>`).join("")
    : `<div class="price"><span class="label">Valor mensal</span><span class="value">Sob consulta</span></div>`;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="Valores, coparticipação, carências e rede credenciada.">
<title>${esc(titulo)}</title>
<style>${variaveisDeCor(paletaProposta(s.plano))}${CSS}</style>
</head>
<body>
<div class="page">
  ${barraLateral(P, paraImagem)}
  <main class="main">
    ${avisoAceito(s, aceitacao)}
    <div class="hero">
      <div class="stack" style="gap:6px">
        <span class="meta">Cotação de ${esc(P.cotacao)}</span>
        <h1>${esc(P.plano)}</h1>
        ${P.subtitulo ? `<span class="sub">${esc(P.subtitulo)}</span>` : ""}
        ${P.taxa ? `<span class="taxa">${esc(P.taxa)}</span>` : ""}
      </div>
      <div class="lado"><div class="prices">${precos}</div>${botaoAceite(s, aceitacao, paraImagem)}</div>
    </div>
    ${paraImagem ? "" : blocoFaixas(P.faixas)}
    <div class="cols">${secaoCoparticipacao(P)}${secaoCarencias(P)}</div>
    ${P.fidelidade ? `<p class="fidelidade">Planos CNPJ geram fidelidade de 1 ano.</p>` : ""}
    ${P.rodape.length ? `<p class="note">${P.rodape.map(esc).join(" ")}</p>` : ""}
  </main>
</div>
${paraImagem ? "" : '<script type="module" src="/proposta-pagina.js"></script>'}
</body>
</html>`;
}
