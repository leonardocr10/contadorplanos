// Tela "Nova cotação": formulário, cartões de planos, prévia do WhatsApp e imagens da proposta.
import { FAIXAS, brl, hasFaixas, lerArea, locaisDosPlanos, normFone, parseBRL, planPrices, redeDaCidade, totalVidas, vendidoEm } from "./calculo.js";
import { $, S, api, esc, pode, render, toast } from "./estado.js";
import { buildMsg, linkConversaDireta, textoDosLinks, waHtml } from "./mensagem.js";
import { paginaParaPng } from "./imagem-proposta.js";
import { imagemParaPdf } from "./pdf-imagem.js";
import { abrirComparativo } from "./comparativo.js";
import { renderHistCli, saveQuote } from "./historico.js";

const planosEscolhidos = () => S.selected.map((id) => S.plans.find((p) => p.id === id)).filter(Boolean);
const nomeCliente = () => $("#cliente").value.trim();
const corretor = () => ({ nome: S.cor.nome.trim(), fone: S.cor.fone.trim(), empresa: S.cor.empresa.trim() });
// Coparticipação, rede e legenda de acomodação vão em toda cotação: texto, imagem, PDF e link.
const opcoes = () => ({ copart: true, rede: true, acom: true });
const prices = (p) => planPrices(p, S.vidas, S.over);

/* ---------- beneficiários ---------- */
function renderFaixas() {
  const tv = totalVidas(S.vidas);
  $("#vidas-total").textContent = `${tv} ${tv === 1 ? "vida" : "vidas"}`;
  $("#faixas").innerHTML = FAIXAS.map((f, i) => `<div class="fx" data-on="${S.vidas[i] ? 1 : 0}"><span>${f}</span><div class="ctr"><button class="iconbtn" data-m="${i}" aria-label="Menos uma pessoa de ${f} anos">−</button><b>${S.vidas[i]}</b><button class="iconbtn" data-p="${i}" aria-label="Mais uma pessoa de ${f} anos">+</button></div></div>`).join("");
  $("#faixas").querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { const i = +b.dataset.m; S.vidas[i] = Math.max(0, S.vidas[i] - 1); render(); }));
  $("#faixas").querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => { const i = +b.dataset.p; S.vidas[i]++; render(); }));
}

/* ---------- cidade ---------- */
// Só troca as opções quando elas mudam: a cotação redesenha a cada alteração e há centenas de cidades.
const opcoesAtuais = new Map();
const trocarOpcoes = (select, html, valor, quantas) => {
  if (opcoesAtuais.get(select) !== html) { select.innerHTML = html; opcoesAtuais.set(select, html); }
  select.value = valor;
  select.disabled = quantas < 1;
};

function renderLocal() {
  // O valor guarda o estado junto: nomes de cidade podem se repetir entre estados.
  const cidades = locaisDosPlanos(S.plans.filter((p) => p.ativo !== false))
    .flatMap((l) => l.cidades.map((c) => [`${l.uf}|${c}`, c, l.uf]))
    .sort((a, b) => a[1].localeCompare(b[1], "pt-BR") || a[2].localeCompare(b[2]));
  const atual = `${S.uf}|${S.municipio}`;
  const existe = cidades.some(([v]) => v === atual);
  // Enquanto os planos carregam a lista está vazia: a cidade padrão só cai se não existir de verdade.
  if (S.loaded && !existe) { S.uf = ""; S.municipio = ""; }
  const html = `<option value="" data-icone="todos">Todas as cidades</option><optgroup label="Cidades">${cidades.map(([v, c, uf]) => `<option value="${esc(v)}" data-selo="${esc(uf)}">${esc(c)}</option>`).join("")}</optgroup>`;
  trocarOpcoes($("#municipio"), html, existe ? atual : "", cidades.length);
  $("#limpar-local").disabled = !S.municipio && !$("#cliente").value && !$("#fone").value;
}

// Plano fora da área sai da cotação junto com o cartão, para não ir na proposta por engano.
function aplicarLocal() {
  const fora = planosEscolhidos().filter((p) => !vendidoEm(p, S.uf, S.municipio));
  S.selected = S.selected.filter((id) => !fora.some((p) => p.id === id));
  render();
  if (fora.length) toast(fora.length === 1 ? `${fora[0].nome} saiu da cotação: não é comercializado nesse local` : `${fora.length} planos saíram da cotação: não são comercializados nesse local`);
}

/* ---------- planos ---------- */
// Filtro da lista de planos: busca no nome e no subtítulo e escolha da operadora. Só esconde cartões; a seleção fica.
const filtroPlanos = { texto: "", operadora: "" };
const normal = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const NOMES_OPERADORAS = { AMIL: "Amil", UNIMED: "Unimed", PLAM: "PLAM", PLAMEDH: "Plamedh", HAPVIDA: "Hapvida", AURORA: "Aurora Saúde" };
function operadoraDe(p) {
  if (/^sul\s?america/.test(normal(p.nome))) return "SulAmérica";
  const primeira = String(p.nome || "").trim().split(/\s+/)[0].toUpperCase();
  return NOMES_OPERADORAS[primeira] || primeira.charAt(0) + primeira.slice(1).toLowerCase();
}
function passaNoFiltro(p) {
  if (filtroPlanos.operadora && operadoraDe(p) !== filtroPlanos.operadora) return false;
  const alvo = normal(`${p.nome} ${p.subtitulo}`);
  return normal(filtroPlanos.texto).split(/\s+/).filter(Boolean).every((t) => alvo.includes(t));
}
function limparFiltroPlanos() {
  filtroPlanos.texto = "";
  filtroPlanos.operadora = "";
  $("#busca-plano").value = "";
  renderPlans();
}
function renderFiltroPlanos(list) {
  const operadoras = [...new Set(list.map(operadoraDe))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  if (!operadoras.includes(filtroPlanos.operadora)) filtroPlanos.operadora = "";
  const sel = $("#operadora-plano");
  const opcoes = `<option value="" data-icone="todos">Todas as operadoras</option><optgroup label="Operadoras">${operadoras.map((o) => `<option value="${esc(o)}" data-selo="${list.filter((p) => operadoraDe(p) === o).length}">${esc(o)}</option>`).join("")}</optgroup>`;
  if (sel.dataset.opcoes !== opcoes) { sel.innerHTML = opcoes; sel.dataset.opcoes = opcoes; }
  sel.value = filtroPlanos.operadora;
  // Com poucos planos o filtro não ajuda: fica escondido.
  $("#filtro-planos").hidden = list.length < 6 && !filtroPlanos.texto && !filtroPlanos.operadora;
}

// Plano fora do tamanho de grupo que aceita sai da proposta, para não ir sem preço.
function tirarForaDoGrupo() {
  const fora = planosEscolhidos().filter((p) => { const v = prices(p); return v.minimo || v.maximo; });
  if (!fora.length) return;
  S.selected = S.selected.filter((id) => !fora.some((p) => p.id === id));
  const n = totalVidas(S.vidas), grupo = `${n} ${n === 1 ? "vida" : "vidas"}`;
  toast(fora.length === 1 ? `${fora[0].nome} saiu da cotação: não aceita grupos de ${grupo}` : `${fora.length} planos saíram da cotação: não aceitam grupos de ${grupo}`);
}

// Planos da mesma linha ("AMIL PRATA 30%", "AMIL PRATA 30% MEI", "AMIL PRATA PARCIAL"...) ficam num cartão só,
// que abre as opções ao clicar. O nome sem a coparticipação e sem o MEI é o da linha.
const SUFIXOS = /\s+(\d+%|PARCIAL|MEI)(?=\s|$)/gi;
const linhaDoPlano = (p) => String(p.nome || "").replace(SUFIXOS, "").trim();
const gruposAbertos = new Set();
const eMei = (p) => [...String(p.nome || "").matchAll(SUFIXOS)].some((m) => m[1].toUpperCase() === "MEI");
function rotuloDaOpcao(p) {
  const partes = [...String(p.nome || "").matchAll(SUFIXOS)].map((m) => m[1].toUpperCase())
    .map((t) => (t === "MEI" ? "MEI" : t === "PARCIAL" ? "Coparticipação parcial" : `Coparticipação ${t}`));
  // Sem sufixo, o subtítulo diz qual é a opção (ex.: "Coparticipação total").
  return partes.length ? partes.join(" · ") : String(p.subtitulo || "").split(" – ")[0] || p.nome;
}

function cartaoDoPlano(p, titulo = p.nome) {
  const v = prices(p);
  const semArea = S.uf && !lerArea(p.areaComercializacao).estados.length ? `<span>Área de comercialização não informada</span>` : "";
  if (v.minimo || v.maximo) {
    const limite = v.minimo ? `Para grupos a partir de ${v.minimo} vidas` : `Para grupos de até ${v.maximo} vidas`;
    return `<button class="plan" aria-pressed="false" aria-disabled="true" data-id="${esc(p.id)}" data-limite="${esc(limite)}"><b>${esc(titulo)}</b><span>${limite}</span>${semArea}</button>`;
  }
  const grupo = v.tabelaVidas ? `<span>Preço de ${esc(v.tabelaVidas)}</span>` : "";
  const pr = v.porFaixa ? `Enf. R$ ${brl(v.enf) || "—"} · Apto R$ ${brl(v.apto) || "—"}`
    : hasFaixas(p) && !totalVidas(S.vidas) ? "Tabela por faixa etária: informe os beneficiários"
    : v.enf || v.apto ? `Enf. R$ ${brl(v.enf) || "—"} · Apto R$ ${brl(v.apto) || "—"}` : "Valores sob consulta";
  return `<button class="plan" aria-pressed="${S.selected.includes(p.id)}" aria-disabled="${!totalVidas(S.vidas)}" data-id="${esc(p.id)}"><b>${esc(titulo)}</b><span>${pr}</span>${grupo}${semArea}</button>`;
}

// Resumo da linha: quantas opções, o menor preço e quantas já estão na proposta.
// Linha sem beneficiários informados, ou em que nenhuma opção aceita o tamanho do grupo (ex.: Amil PME com 1 vida),
// fica apagada e fechada, como os outros cartões.
function limiteDaLinha(planos) {
  if (!totalVidas(S.vidas)) return "Informe a faixa etária dos beneficiários";
  const precos = planos.map(prices);
  if (!precos.every((v) => v.minimo || v.maximo)) return "";
  const v = precos[0];
  return v.minimo ? `Para grupos a partir de ${v.minimo} vidas` : `Para grupos de até ${v.maximo} vidas`;
}

function cartaoDaLinha(nome, planos, aberto) {
  const precos = planos.map(prices).filter((v) => v.porFaixa && !v.minimo && !v.maximo);
  const menor = (k) => { const x = precos.map((v) => v[k]).filter((n) => n != null); return x.length ? Math.min(...x) : null; };
  const limite = planos.map(prices).find((v) => v.minimo || v.maximo);
  const resumo = !totalVidas(S.vidas) ? "Informe os beneficiários para ver os valores"
    // Linha só de apartamento (ex.: Platinum) não mostra enfermaria.
    : precos.length ? `A partir de ${[menor("enf") != null && `Enf. R$ ${brl(menor("enf"))}`, menor("apto") != null && `Apto R$ ${brl(menor("apto"))}`].filter(Boolean).join(" · ")}`
    : limite?.minimo ? `Para grupos a partir de ${limite.minimo} vidas` : limite?.maximo ? `Para grupos de até ${limite.maximo} vidas` : "Valores sob consulta";
  const tabela = precos.find((v) => v.tabelaVidas)?.tabelaVidas;
  const marcados = planos.filter((p) => S.selected.includes(p.id)).length;
  const fora = limiteDaLinha(planos);
  return `<button type="button" class="plan plan-linha" aria-expanded="${aberto}" aria-pressed="${marcados > 0}"${fora ? ` aria-disabled="true" data-limite="${esc(fora)}"` : ""} data-linha="${esc(nome)}"><b>${esc(nome)}</b><span>${planos.length} opções · ${resumo}</span>${tabela ? `<span>Preço de ${esc(tabela)}</span>` : ""}${marcados ? `<span class="na-proposta">${marcados} na proposta</span>` : ""}</button>`;
}

// Com opções para MEI, as demais empresas ficam numa linha e as de MEI em outra.
function opcoesDaLinha(nome, planos) {
  const mei = planos.filter(eMei), demais = planos.filter((p) => !eMei(p));
  const secao = (titulo, lista) => `<div class="opcoes-secao"><div class="opcoes-titulo">${titulo}</div><div class="opcoes-grade">${lista.map((p) => cartaoDoPlano(p, rotuloDaOpcao(p))).join("")}</div></div>`;
  const corpo = mei.length && demais.length ? secao("Demais empresas", demais) + secao("MEI", mei)
    : `<div class="opcoes-grade">${planos.map((p) => cartaoDoPlano(p, rotuloDaOpcao(p))).join("")}</div>`;
  return `<div class="opcoes-plano" role="group" aria-label="Opções de ${esc(nome)}">${corpo}</div>`;
}

function renderPlans() {
  const box = $("#plans");
  tirarForaDoGrupo();
  if (!S.loaded) { box.innerHTML = `<div class="status">${S.dbErr ? esc(S.dbErr) : "Carregando planos…"}</div>`; return; }
  const doTipo = S.plans.filter((p) => p.categoria === S.tipo && p.ativo !== false);
  const nomeTipo = S.tipo === "PF" ? "para pessoa física" : "CNPJ";
  if (!doTipo.length) { box.innerHTML = `<div class="status">Nenhum plano ${nomeTipo} cadastrado. Adicione na aba <b>Planos e valores</b>.</div>`; return; }
  const naArea = doTipo.filter((p) => vendidoEm(p, S.uf, S.municipio));
  renderFiltroPlanos(naArea);
  $("#contagem-planos").textContent = "";
  if (!naArea.length) { box.innerHTML = `<div class="status">Nenhum plano ${nomeTipo} comercializado em ${esc(S.municipio)}.</div>`; return; }
  const list = naArea.filter(passaNoFiltro);
  if (list.length !== naArea.length) $("#contagem-planos").textContent = `${list.length} de ${naArea.length} planos`;
  if (!list.length) {
    box.innerHTML = `<div class="status">Nenhum plano encontrado com esse filtro. <button type="button" class="btn" id="limpar-filtro-planos">Mostrar todos</button></div>`;
    $("#limpar-filtro-planos").onclick = limparFiltroPlanos;
    return;
  }
  // Agrupa os planos da mesma linha.
  const linhas = new Map();
  for (const p of list) {
    const nome = linhaDoPlano(p);
    if (!linhas.has(nome)) linhas.set(nome, []);
    linhas.get(nome).push(p);
  }
  // Com uma busca digitada, as linhas já vêm abertas para mostrar o que foi achado.
  const buscando = !!filtroPlanos.texto.trim();
  // Cartões em ordem alfabética pelo nome que aparece; dentro da linha, as opções seguem a ordem do cadastro.
  const nomeDoCartao = ([nome, planos]) => (planos.length === 1 ? planos[0].nome : nome);
  const ordenadas = [...linhas].sort((a, b) => nomeDoCartao(a).localeCompare(nomeDoCartao(b), "pt-BR", { numeric: true, sensitivity: "base" }));
  box.innerHTML = ordenadas.map(([nome, planos]) => {
    if (planos.length === 1) return cartaoDoPlano(planos[0]);
    const aberto = !limiteDaLinha(planos) && (buscando || gruposAbertos.has(nome));
    return cartaoDaLinha(nome, planos, aberto)
      + (aberto ? opcoesDaLinha(nome, planos) : "");
  }).join("");
  box.querySelectorAll(".plan-linha").forEach((b) => (b.onclick = () => {
    if (!totalVidas(S.vidas)) { toast("Informe a faixa etária dos beneficiários antes de marcar o plano"); return; }
    if (b.dataset.limite) { toast(`${b.dataset.limite}: ajuste os beneficiários para ver as opções`); return; }
    const nome = b.dataset.linha;
    if (gruposAbertos.has(nome)) gruposAbertos.delete(nome); else gruposAbertos.add(nome);
    renderPlans();
  }));
  box.querySelectorAll(".plan[data-id]").forEach((b) => (b.onclick = () => {
    if (!totalVidas(S.vidas)) { toast("Informe a faixa etária dos beneficiários antes de marcar o plano"); return; }
    if (b.dataset.limite) { toast(`${b.dataset.limite}: ajuste os beneficiários para escolher este plano`); return; }
    const id = b.dataset.id;
    S.selected = S.selected.includes(id) ? S.selected.filter((x) => x !== id) : [...S.selected, id];
    render();
  }));
}

function renderSel() {
  const box = $("#sel"), items = planosEscolhidos();
  if (!items.length) { box.innerHTML = ""; return; }
  const tv = totalVidas(S.vidas);
  // Com os dois tipos marcados, cada plano diz o seu.
  const misturados = new Set(items.map((p) => p.categoria)).size > 1;
  const tipoDe = (p) => {
    // O aviso é só para o corretor: sem rede na cidade, a proposta sai sem essa seção.
    const semRede = S.municipio && !redeDaCidade(p, S.municipio).length ? `Sem rede cadastrada em ${esc(S.municipio)} · ` : "";
    return `${misturados ? `${p.categoria === "CNPJ" ? "CNPJ" : "Pessoa física"} · ` : ""}${semRede}`;
  };
  box.innerHTML = `<div class="note">Valores desta cotação:</div>` + items.map((p) => {
    const v = prices(p);
    const remover = `<button class="iconbtn" title="Tirar da proposta" aria-label="Tirar ${esc(p.nome)} da proposta" data-rm="1">×</button>`;
    if (v.porFaixa) return `<div class="selitem" data-id="${esc(p.id)}"><div class="name">${esc(p.nome)}<small>${tipoDe(p)}${esc(p.subtitulo || "")} · ${tv} ${tv === 1 ? "vida" : "vidas"}</small></div>
      <div class="tot"><small>Enfermaria total</small>${v.enf != null ? "R$ " + brl(v.enf) : "falta valor"}</div>
      <div class="tot"><small>Apartamento total</small>${v.apto != null ? "R$ " + brl(v.apto) : "falta valor"}</div>
      ${remover}</div>`;
    return `<div class="selitem" data-id="${esc(p.id)}"><div class="name">${esc(p.nome)}<small>${tipoDe(p)}${esc(p.subtitulo || "")}</small></div>
      <div class="field"><label for="enf-${esc(p.id)}">Enfermaria R$</label><input class="money" type="text" inputmode="decimal" id="enf-${esc(p.id)}" data-k="enf" value="${brl(v.enf)}"></div>
      <div class="field"><label for="apto-${esc(p.id)}">Apartamento R$</label><input class="money" type="text" inputmode="decimal" id="apto-${esc(p.id)}" data-k="apto" value="${brl(v.apto)}"></div>
      ${remover}</div>`;
  }).join("");
  box.querySelectorAll(".selitem").forEach((row) => {
    const id = row.dataset.id;
    row.querySelectorAll("input").forEach((inp) => inp.addEventListener("change", () => {
      S.over[id] = S.over[id] || {};
      S.over[id][inp.dataset.k] = parseBRL(inp.value);
      inp.value = brl(S.over[id][inp.dataset.k]);
      render();
    }));
    row.querySelector("[data-rm]").onclick = () => { S.selected = S.selected.filter((x) => x !== id); render(); };
  });
}

/* ---------- mensagem ---------- */
let manual = false, lastAuto = "";
const currentMsg = () => (manual ? $("#rawtxt").value : lastAuto);

function paintChat(msg) {
  const chat = $("#chat");
  if (!msg) { chat.innerHTML = `<div class="empty">Escolha um ou mais planos para ver a mensagem aqui.</div>`; return; }
  const hh = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  let h = `<div class="bubble">${waHtml(msg)}<span class="meta">${hh} ✓✓</span></div>`;
  for (const u of cardUrls) h += `<div class="bubble img"><img src="${u}" alt="Imagem da proposta"><span class="meta">${hh} ✓✓</span></div>`;
  chat.innerHTML = h;
}

function dadosCotacao(mensagem) {
  return {
    fone: normFone($("#fone").value), cliente: nomeCliente(), tipo: S.tipo, uf: S.uf, municipio: S.municipio, vidas: [...S.vidas],
    over: JSON.parse(JSON.stringify(S.over)),
    planos: planosEscolhidos().map((p) => { const v = prices(p); return { id: p.id, nome: p.nome, enf: v.enf ?? null, apto: v.apto ?? null }; }),
    mensagem,
  };
}

/* ---------- histórico automático ---------- */
// Toda cotação vai para o histórico sozinha. Enquanto ela é montada, o mesmo registro é atualizado,
// para cada plano marcado ou letra digitada não virar uma cotação nova.
const auto = { id: null, fone: "", assinatura: "", timer: null, fila: Promise.resolve(false) };

// Só vai para o histórico com nome, WhatsApp completo e um plano com valor.
const podeSalvar = (d) => !!d.cliente && d.fone.length >= 10 && d.planos.some((p) => p.enf != null || p.apto != null);
const AVISO_SEM_DADOS = "Preencha o nome e o WhatsApp do cliente para salvar no histórico";

function salvar() {
  clearTimeout(auto.timer);
  auto.timer = null;
  const dados = dadosCotacao(currentMsg());
  // Com visualização, a pessoa simula, mas nada vai para o histórico.
  if (!pode("cotacao", "editar") || !podeSalvar(dados)) return Promise.resolve(false);
  const assinatura = JSON.stringify(dados);
  auto.fila = auto.fila.then(async () => {
    if (assinatura === auto.assinatura) return true;
    // Número trocado é outro cliente: a cotação anterior fica como está.
    if (auto.fone && dados.fone !== auto.fone) auto.id = null;
    const salva = await saveQuote(dados, auto.id);
    if (!salva) return false;
    auto.id = salva.id;
    auto.fone = dados.fone;
    auto.assinatura = assinatura;
    return true;
  });
  return auto.fila;
}

function agendarSalvar() {
  clearTimeout(auto.timer);
  auto.timer = setTimeout(salvar, 800);
}

// Para quem vai recarregar a página não perder a última alteração.
export const salvarCotacaoPendente = () => (auto.timer ? salvar() : auto.fila);

// Volta a tela ao estado de quando a página abre, guardando antes o que faltava salvar.
export async function novaCotacao() {
  await salvarCotacaoPendente();
  if ($("#visor").open) $("#visor").close();
  S.tipo = "PF";
  for (const b of $("#tipo").children) b.setAttribute("aria-pressed", b.dataset.t === "PF");
  S.uf = "MG";
  S.municipio = "Uberlândia";
  S.selected = [];
  S.over = {};
  S.vidas = Array(10).fill(0);
  $("#cliente").value = "";
  $("#fone").value = "";
  $("#raw").open = false;
  auto.id = null;
  auto.fone = "";
  S.recomecarHistorico = true;
  render();
  renderHistCli();
  scrollTo(0, 0);
  $("#cliente").focus();
}

// O que está na tela vira o ponto de partida: só uma alteração a partir daqui cria outra cotação.
function recomecarHistorico() {
  clearTimeout(auto.timer);
  auto.timer = null;
  auto.id = null;
  auto.fone = "";
  auto.assinatura = JSON.stringify(dadosCotacao(currentMsg()));
}

/* ---------- imagens ---------- */
let cardUrls = [], cards = [], cardSeq = 0, cardsProntos = false;
async function renderCards() {
  const seq = ++cardSeq, items = planosEscolhidos(), box = $("#imgs");
  if (!items.length) {
    box.innerHTML = `<div class="note">As imagens aparecem quando você escolhe um plano.</div>`;
    cardUrls.forEach(URL.revokeObjectURL);
    cardUrls = [];
    cards = [];
    paintChat(currentMsg());
    return;
  }
  const made = [];
  try {
    const { paginas } = await api("/api/propostas/previa", {
      metodo: "POST",
      json: { planos: items.map((p) => p.id), vidas: S.vidas, over: S.over, cliente: nomeCliente(), opts: opcoes(), municipio: S.municipio },
    });
    for (const [i, p] of items.entries()) {
      if (seq !== cardSeq) break;
      const blob = await paginaParaPng(paginas[i].html);
      made.push({ p, titulo: `Proposta ${p.nome}`, blob, url: URL.createObjectURL(blob) });
    }
  } catch (e) {
    console.error("Falha ao gerar a imagem:", e);
    made.forEach((m) => URL.revokeObjectURL(m.url));
    if (seq === cardSeq) box.innerHTML = `<div class="status">Não consegui gerar a imagem: ${esc(e.message)}</div>`;
    return;
  }
  if (seq !== cardSeq) { made.forEach((m) => URL.revokeObjectURL(m.url)); return; }
  cardUrls.forEach(URL.revokeObjectURL);
  cards = made;
  cardsProntos = true;
  cardUrls = made.map((m) => m.url);
  box.innerHTML = made.map((m, i) => `<figure><button type="button" class="imgs-abrir" data-ver="${i}" title="Clique para ampliar" aria-label="Ampliar a proposta de ${esc(m.p.nome)}"><img src="${m.url}" alt=""></button><figcaption title="${esc(m.p.nome)}">${esc(m.p.nome)}</figcaption>${pode("cotacao", "editar") ? `<button class="btn primary" data-cp="${i}">Copiar e baixar</button><button class="btn" data-pdf="${i}">Baixar PDF</button>` : ""}</figure>`).join("");
  box.querySelectorAll("[data-ver]").forEach((b) => (b.onclick = () => abrirVisor(+b.dataset.ver)));
  box.querySelectorAll("[data-pdf]").forEach((b) => (b.onclick = () => savePdf(cards[+b.dataset.pdf], b)));
  box.querySelectorAll("[data-cp]").forEach((b) => (b.onclick = () => copyCard(cards[+b.dataset.cp])));
  // Se as imagens forem refeitas com a janela aberta, ela acompanha.
  if ($("#visor").open) { if (cards.length) pintarVisor(); else $("#visor").close(); }
  paintChat(currentMsg());
}

/* ---------- imagem ampliada ---------- */
let visorIndice = 0;
function pintarVisor() {
  visorIndice = Math.min(visorIndice, cards.length - 1);
  const m = cards[visorIndice];
  $("#visor-titulo").textContent = m.p.nome;
  $("#visor-img").src = m.url;
  $("#visor-img").alt = `Proposta ${m.p.nome}`;
  $("#visor-conta").textContent = cards.length > 1 ? `${visorIndice + 1} de ${cards.length}` : "";
  $("#visor-ant").hidden = $("#visor-prox").hidden = cards.length < 2;
  $("#visor-corpo").scrollTo(0, 0);
}
function abrirVisor(i) {
  visorIndice = i;
  pintarVisor();
  $("#visor").showModal();
}
function passarVisor(passo) {
  if (cards.length < 2) return;
  visorIndice = (visorIndice + passo + cards.length) % cards.length;
  pintarVisor();
}
function definirZoom(ligado) {
  $("#visor-corpo").classList.toggle("zoom", ligado);
  $("#visor-corpo").scrollTo(0, 0);
  $("#visor-zoom").textContent = ligado ? "Ajustar à tela" : "Ampliar";
  $("#visor-zoom").setAttribute("aria-pressed", ligado);
}
function iniciarVisor() {
  const visor = $("#visor");
  const alternarZoom = () => definirZoom(!$("#visor-corpo").classList.contains("zoom"));
  $("#visor-zoom").onclick = alternarZoom;
  $("#visor-img").onclick = alternarZoom;
  $("#visor-fechar").onclick = () => visor.close();
  $("#visor-ant").onclick = () => passarVisor(-1);
  $("#visor-prox").onclick = () => passarVisor(1);
  $("#visor-copiar").onclick = () => copyCard(cards[visorIndice]);
  $("#visor-pdf").onclick = (e) => savePdf(cards[visorIndice], e.currentTarget);
  // Clique fora da imagem, no fundo escuro, fecha.
  visor.onclick = (e) => { if (e.target === visor) visor.close(); };
  visor.onkeydown = (e) => {
    if (e.key === "ArrowLeft") passarVisor(-1);
    if (e.key === "ArrowRight") passarVisor(1);
  };
  visor.onclose = () => definirZoom(false);
}

const fileName = (m, extensao = "png") => `${m.titulo.replace(/[\\/:*?"<>|]/g, "")}${nomeCliente() ? " - " + nomeCliente().replace(/[\\/:*?"<>|]/g, "") : ""}.${extensao}`;

function baixarArquivo(url, nome) {
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return salvar();
}

function saveCard(m) {
  return baixarArquivo(m.url, fileName(m));
}

async function savePdf(m, botao) {
  botao.disabled = true;
  try {
    const url = URL.createObjectURL(await imagemParaPdf(m.blob));
    baixarArquivo(url, fileName(m, "pdf"));
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (e) {
    console.error("Falha ao gerar o PDF:", e);
    toast("Não consegui gerar o PDF: tente de novo", "erro");
  } finally {
    botao.disabled = false;
  }
}

const AVISO_SEM_COPIA = "O navegador só copia imagem em endereço com HTTPS: ela foi baixada. Arraste o arquivo para a conversa";

async function copiarImagem(m) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": m.blob })]);
    return true;
  } catch (e) {
    console.error("Falha ao copiar a imagem:", e);
    return false;
  }
}

async function copyCard(m) {
  // A cópia vem antes, enquanto o clique ainda vale para o navegador. Em endereço sem HTTPS ela é recusada.
  const copiou = await copiarImagem(m);
  const salvou = await saveCard(m);
  if (!copiou) toast(AVISO_SEM_COPIA, "erro");
  else toast(salvou ? "Imagem copiada, baixada e salva no histórico: cole no WhatsApp" : `Imagem copiada e baixada. ${AVISO_SEM_DADOS}`, salvou ? "sucesso" : "aviso");
}

// O link do WhatsApp só leva texto. A imagem vai para a área de transferência antes de abrir a conversa,
// porque com a nova aba em primeiro plano o navegador recusaria a cópia.
async function abrirWhatsApp() {
  if (!currentMsg()) { toast("Escolha um plano primeiro"); return; }
  if (!cardsProntos) { toast("A imagem ainda está sendo gerada: tente de novo em um instante"); return; }
  const copiou = await copiarImagem(cards[0]);
  window.open(linkConversaDireta(normFone($("#fone").value), currentMsg(), navigator.userAgent), "_blank", "noopener");
  salvar();
  if (!copiou) {
    saveCard(cards[0]);
    toast(AVISO_SEM_COPIA, "erro");
  }
  else if (cards.length > 1) toast(`Imagem de ${cards[0].p.nome} copiada: aperte Ctrl+V na conversa. Copie as outras nos botões Copiar e baixar`, "sucesso");
  else toast("Imagem copiada: aperte Ctrl+V na conversa do WhatsApp", "sucesso");
}

/* ---------- link da proposta ---------- */
// Em endereço http, como o da VPS, o navegador não oferece a área de transferência moderna.
async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const campo = document.createElement("textarea");
    campo.value = texto;
    campo.style.cssText = "position:fixed;opacity:0";
    document.body.append(campo);
    campo.select();
    const ok = document.execCommand("copy");
    campo.remove();
    return ok;
  }
}

// O link leva à página com o botão de aceite. Ele fica visível, caso o navegador recuse a cópia.
async function copiarLink() {
  if (!S.selected.length) { toast("Escolha um plano primeiro"); return; }
  const caixa = $("#links-gerados");
  let texto;
  try {
    const { links } = await api("/api/propostas", {
      metodo: "POST",
      json: { planos: [...S.selected], vidas: S.vidas, over: S.over, cliente: nomeCliente(), fone: normFone($("#fone").value), opts: opcoes(), municipio: S.municipio },
    });
    texto = textoDosLinks(links);
  } catch (e) {
    toast(e.message, "erro");
    return;
  }
  caixa.textContent = texto;
  caixa.hidden = false;
  if (await copiarTexto(texto)) toast(S.linkLocal ? "Link copiado, mas ele só abre neste computador: preencha PUBLIC_URL no .env" : "Link copiado: cole na conversa do cliente", S.linkLocal ? "aviso" : "sucesso");
  else toast("O navegador bloqueou a cópia: selecione o link abaixo dos botões", "erro");
}

/* ---------- render ---------- */
let cardTimer;
export function renderCotacao() {
  // Sem beneficiários não há o que cotar: zerar as faixas também desmarca os planos.
  if (S.selected.length && !totalVidas(S.vidas)) {
    S.selected = [];
    toast("Planos desmarcados: informe a faixa etária dos beneficiários");
  }
  renderLocal();
  renderFaixas();
  renderPlans();
  renderSel();
  const nome = nomeCliente();
  $("#pv-nome").textContent = nome || "Cliente";
  $("#av").textContent = (nome[0] || "?").toUpperCase();
  lastAuto = buildMsg({ items: planosEscolhidos(), vidas: S.vidas, over: S.over, nome, corretor: corretor(), opts: opcoes(), cidade: S.municipio });
  $("#nota-envio").textContent = "Abrir no WhatsApp leva o texto e copia a imagem: na conversa, aperte Ctrl+V para colar a imagem. Com vários planos, copie as outras imagens nos botões acima. A cotação fica salva no histórico automaticamente quando tem nome, WhatsApp e plano.";
  $("#links-gerados").hidden = true;
  $("#comparar").hidden = planosEscolhidos().length < 2 || !pode("cotacao", "editar");
  $("#limpar-planos").disabled = !S.selected.length;
  manual = false;
  $("#rawtxt").value = lastAuto;
  paintChat(lastAuto);
  if (S.recomecarHistorico) {
    S.recomecarHistorico = false;
    recomecarHistorico();
  } else {
    agendarSalvar();
  }
  cardsProntos = false;
  clearTimeout(cardTimer);
  cardTimer = setTimeout(renderCards, 250);
}

export function iniciarCotacao() {
  iniciarVisor();
  $("#tipo").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    S.tipo = b.dataset.t;
    for (const x of $("#tipo").children) x.setAttribute("aria-pressed", x === b);
    // Os planos marcados continuam ao trocar de tipo, para comparar pessoa física com CNPJ.
    render();
  };
  $("#municipio").addEventListener("change", () => {
    [S.uf = "", S.municipio = ""] = $("#municipio").value ? $("#municipio").value.split("|") : [];
    aplicarLocal();
  });
  $("#limpar-local").onclick = () => {
    S.uf = "";
    S.municipio = "";
    $("#cliente").value = "";
    $("#fone").value = "";
    // Dados apagados são o começo de outra cotação, e a anterior fica no histórico como estava.
    S.recomecarHistorico = true;
    filtroPlanos.texto = "";
    filtroPlanos.operadora = "";
    $("#busca-plano").value = "";
    render();
    renderHistCli();
  };
  $("#limpar-planos").onclick = () => { S.selected = []; render(); };
  $("#busca-plano").addEventListener("input", (e) => { filtroPlanos.texto = e.target.value; renderPlans(); });
  $("#operadora-plano").addEventListener("change", (e) => { filtroPlanos.operadora = e.target.value; renderPlans(); });
  for (const id of ["cliente", "fone"]) $("#" + id).addEventListener("input", render);
  $("#limpar-vidas").onclick = () => { S.vidas = Array(10).fill(0); render(); };
  $("#rawtxt").addEventListener("input", () => { manual = true; paintChat($("#rawtxt").value); agendarSalvar(); });

  $("#copy").onclick = async () => {
    if (!currentMsg()) { toast("Escolha um plano primeiro"); return; }
    const t = currentMsg();
    try {
      await navigator.clipboard.writeText(t);
      const ok = await salvar();
      toast(ok ? "Mensagem copiada e salva no histórico" : `Mensagem copiada. ${AVISO_SEM_DADOS}`, ok ? "sucesso" : "aviso");
    } catch {
      $("#raw").open = true;
      const ta = $("#rawtxt");
      ta.value = t;
      ta.focus();
      ta.select();
      toast("Selecionei o texto: use Ctrl+C");
      salvar();
    }
  };
  $("#copiar-link").onclick = copiarLink;
  $("#comparar").onclick = () => abrirComparativo(
    planosEscolhidos(),
    { vidas: S.vidas, over: S.over, cliente: nomeCliente(), opts: opcoes(), municipio: S.municipio },
    { copiar: copyCard, baixarPdf: savePdf },
  );
  $("#wa").addEventListener("click", (e) => { e.preventDefault(); abrirWhatsApp(); });
  $("#fone").addEventListener("input", () => {
    const f = normFone($("#fone").value);
    if (f.length >= 10 && !nomeCliente()) {
      const h = S.hist.find((x) => x.fone === f && x.cliente);
      if (h) { $("#cliente").value = h.cliente; render(); }
    }
    renderHistCli();
  });
}
