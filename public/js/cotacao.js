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
const trocarOpcoes = (select, opcoes, valor) => {
  const html = opcoes.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join("");
  if (opcoesAtuais.get(select) !== html) { select.innerHTML = html; opcoesAtuais.set(select, html); }
  select.value = valor;
  select.disabled = opcoes.length < 2;
};

function renderLocal() {
  // O valor guarda o estado junto: nomes de cidade podem se repetir entre estados.
  const cidades = locaisDosPlanos(S.plans.filter((p) => p.ativo !== false))
    .flatMap((l) => l.cidades.map((c) => [`${l.uf}|${c}`, `${c} (${l.uf})`]))
    .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  const atual = `${S.uf}|${S.municipio}`;
  const existe = cidades.some(([v]) => v === atual);
  // Enquanto os planos carregam a lista está vazia: a cidade padrão só cai se não existir de verdade.
  if (S.loaded && !existe) { S.uf = ""; S.municipio = ""; }
  trocarOpcoes($("#municipio"), [["", "Todas as cidades"], ...cidades], existe ? atual : "");
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
function renderPlans() {
  const box = $("#plans");
  if (!S.loaded) { box.innerHTML = `<div class="status">${S.dbErr ? esc(S.dbErr) : "Carregando planos…"}</div>`; return; }
  const doTipo = S.plans.filter((p) => p.categoria === S.tipo && p.ativo !== false);
  const nomeTipo = S.tipo === "PF" ? "para pessoa física" : "CNPJ";
  if (!doTipo.length) { box.innerHTML = `<div class="status">Nenhum plano ${nomeTipo} cadastrado. Adicione na aba <b>Planos e valores</b>.</div>`; return; }
  const list = doTipo.filter((p) => vendidoEm(p, S.uf, S.municipio));
  if (!list.length) { box.innerHTML = `<div class="status">Nenhum plano ${nomeTipo} comercializado em ${esc(S.municipio)}.</div>`; return; }
  box.innerHTML = list.map((p) => {
    const v = prices(p);
    const semArea = S.uf && !lerArea(p.areaComercializacao).estados.length ? `<span>Área de comercialização não informada</span>` : "";
    const pr = v.porFaixa ? `Enf. R$ ${brl(v.enf) || "—"} · Apto R$ ${brl(v.apto) || "—"}`
      : hasFaixas(p) && !totalVidas(S.vidas) ? "Tabela por faixa etária: informe os beneficiários"
      : v.enf || v.apto ? `Enf. R$ ${brl(v.enf) || "—"} · Apto R$ ${brl(v.apto) || "—"}` : "Valores sob consulta";
    return `<button class="plan" aria-pressed="${S.selected.includes(p.id)}" aria-disabled="${!totalVidas(S.vidas)}" data-id="${esc(p.id)}"><b>${esc(p.nome)}</b><span>${pr}</span>${semArea}</button>`;
  }).join("");
  box.querySelectorAll(".plan").forEach((b) => (b.onclick = () => {
    if (!totalVidas(S.vidas)) { toast("Informe a faixa etária dos beneficiários antes de marcar o plano"); return; }
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
  box.innerHTML = made.map((m, i) => `<figure><button type="button" class="imgs-abrir" data-ver="${i}" title="Clique para ampliar" aria-label="Ampliar a proposta de ${esc(m.p.nome)}"><img src="${m.url}" alt=""></button><figcaption>${esc(m.p.nome)}</figcaption>${pode("cotacao", "editar") ? `<button class="btn primary" data-cp="${i}">Copiar e baixar imagem</button><button class="btn" data-pdf="${i}">Baixar PDF</button>` : ""}</figure>`).join("");
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
}
function abrirVisor(i) {
  visorIndice = i;
  pintarVisor();
  $("#visor").showModal();
  // A janela fica acima do resto da página: o aviso precisa estar dentro dela para aparecer.
  $("#visor").append($("#toast"));
}
function passarVisor(passo) {
  if (cards.length < 2) return;
  visorIndice = (visorIndice + passo + cards.length) % cards.length;
  pintarVisor();
}
function iniciarVisor() {
  const visor = $("#visor");
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
  visor.onclose = () => document.body.append($("#toast"));
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
    toast("Não consegui gerar o PDF: tente de novo");
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
  if (!copiou) toast(AVISO_SEM_COPIA);
  else toast(salvou ? "Imagem copiada, baixada e salva no histórico: cole no WhatsApp" : `Imagem copiada e baixada. ${AVISO_SEM_DADOS}`);
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
    toast(AVISO_SEM_COPIA);
  }
  else if (cards.length > 1) toast(`Imagem de ${cards[0].p.nome} copiada: aperte Ctrl+V na conversa. Copie as outras nos botões Copiar e baixar imagem`);
  else toast("Imagem copiada: aperte Ctrl+V na conversa do WhatsApp");
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
    toast(e.message);
    return;
  }
  caixa.textContent = texto;
  caixa.hidden = false;
  if (await copiarTexto(texto)) toast(S.linkLocal ? "Link copiado, mas ele só abre neste computador: preencha PUBLIC_URL no .env" : "Link copiado: cole na conversa do cliente");
  else toast("O navegador bloqueou a cópia: selecione o link abaixo dos botões");
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
    render();
    renderHistCli();
  };
  $("#limpar-planos").onclick = () => { S.selected = []; render(); };
  for (const id of ["cliente", "fone"]) $("#" + id).addEventListener("input", render);
  $("#limpar-vidas").onclick = () => { S.vidas = Array(10).fill(0); render(); };
  $("#rawtxt").addEventListener("input", () => { manual = true; paintChat($("#rawtxt").value); agendarSalvar(); });

  $("#copy").onclick = async () => {
    if (!currentMsg()) { toast("Escolha um plano primeiro"); return; }
    const t = currentMsg();
    try {
      await navigator.clipboard.writeText(t);
      const ok = await salvar();
      toast(ok ? "Mensagem copiada e salva no histórico" : `Mensagem copiada. ${AVISO_SEM_DADOS}`);
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
