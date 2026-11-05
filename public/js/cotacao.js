// Tela "Nova cotação": formulário, cartões de planos, prévia do WhatsApp e imagens da proposta.
import { FAIXAS, brl, hasFaixas, normFone, parseBRL, planPrices, totalVidas } from "./calculo.js";
import { $, S, api, esc, render, toast } from "./estado.js";
import { buildMsg, linkConversaDireta, textoDosLinks, waHtml } from "./mensagem.js";
import { paginaParaPng } from "./imagem-proposta.js";
import { imagemParaPdf } from "./pdf-imagem.js";
import { abrirComparativo } from "./comparativo.js";
import { renderHistCli, saveQuote } from "./historico.js";

const planosEscolhidos = () => S.selected.map((id) => S.plans.find((p) => p.id === id)).filter(Boolean);
const nomeCliente = () => $("#cliente").value.trim();
const corretor = () => ({ nome: S.cor.nome.trim(), fone: S.cor.fone.trim(), empresa: S.cor.empresa.trim() });
const opcoes = () => ({ copart: $("#o-copart").checked, rede: $("#o-rede").checked, acom: $("#o-acom").checked });
const prices = (p) => planPrices(p, S.vidas, S.over);

/* ---------- beneficiários ---------- */
function renderFaixas() {
  const tv = totalVidas(S.vidas);
  $("#vidas-total").textContent = `${tv} ${tv === 1 ? "vida" : "vidas"}`;
  $("#faixas").innerHTML = FAIXAS.map((f, i) => `<div class="fx" data-on="${S.vidas[i] ? 1 : 0}"><span>${f} anos</span><div class="ctr"><button class="iconbtn" data-m="${i}" aria-label="Menos uma pessoa de ${f} anos">−</button><b>${S.vidas[i]}</b><button class="iconbtn" data-p="${i}" aria-label="Mais uma pessoa de ${f} anos">+</button></div></div>`).join("");
  $("#faixas").querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { const i = +b.dataset.m; S.vidas[i] = Math.max(0, S.vidas[i] - 1); render(); }));
  $("#faixas").querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => { const i = +b.dataset.p; S.vidas[i]++; render(); }));
}

/* ---------- planos ---------- */
function renderPlans() {
  const box = $("#plans");
  if (!S.loaded) { box.innerHTML = `<div class="status">${S.dbErr ? esc(S.dbErr) : "Carregando planos…"}</div>`; return; }
  const list = S.plans.filter((p) => p.categoria === S.tipo && p.ativo !== false);
  if (!list.length) { box.innerHTML = `<div class="status">Nenhum plano ${S.tipo === "PF" ? "para pessoa física" : "CNPJ"} cadastrado. Adicione na aba <b>Planos e valores</b>.</div>`; return; }
  box.innerHTML = list.map((p) => {
    const v = prices(p);
    const pr = v.porFaixa ? `Total: Enf. R$ ${brl(v.enf) || "—"} · Apto R$ ${brl(v.apto) || "—"}`
      : hasFaixas(p) && !totalVidas(S.vidas) ? "Tabela por faixa etária: informe os beneficiários"
      : v.enf || v.apto ? `Enf. R$ ${brl(v.enf) || "—"} · Apto R$ ${brl(v.apto) || "—"}` : "Valores sob consulta";
    return `<button class="plan" aria-pressed="${S.selected.includes(p.id)}" data-id="${esc(p.id)}"><b>${esc(p.nome)}</b><span>${pr}</span></button>`;
  }).join("");
  box.querySelectorAll(".plan").forEach((b) => (b.onclick = () => {
    const id = b.dataset.id;
    S.selected = S.selected.includes(id) ? S.selected.filter((x) => x !== id) : [...S.selected, id];
    render();
  }));
}

function renderSel() {
  const box = $("#sel"), items = planosEscolhidos();
  if (!items.length) { box.innerHTML = ""; return; }
  const tv = totalVidas(S.vidas);
  box.innerHTML = `<div class="note">Valores desta cotação:</div>` + items.map((p) => {
    const v = prices(p);
    const remover = `<button class="iconbtn" title="Tirar da proposta" aria-label="Tirar ${esc(p.nome)} da proposta" data-rm="1">×</button>`;
    if (v.porFaixa) return `<div class="selitem" data-id="${esc(p.id)}"><div class="name">${esc(p.nome)}<small>${esc(p.subtitulo || "")} · ${tv} ${tv === 1 ? "vida" : "vidas"}</small></div>
      <div class="tot"><small>Enfermaria total</small>${v.enf != null ? "R$ " + brl(v.enf) : "falta valor"}</div>
      <div class="tot"><small>Apartamento total</small>${v.apto != null ? "R$ " + brl(v.apto) : "falta valor"}</div>
      ${remover}</div>`;
    return `<div class="selitem" data-id="${esc(p.id)}"><div class="name">${esc(p.nome)}<small>${esc(p.subtitulo || "")}</small></div>
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
    fone: normFone($("#fone").value), cliente: nomeCliente(), tipo: S.tipo, vidas: [...S.vidas],
    over: JSON.parse(JSON.stringify(S.over)),
    planos: planosEscolhidos().map((p) => { const v = prices(p); return { id: p.id, nome: p.nome, enf: v.enf ?? null, apto: v.apto ?? null }; }),
    mensagem,
  };
}

async function salvar(silent) {
  try {
    return await saveQuote(dadosCotacao(currentMsg()), silent);
  } catch (e) {
    toast(e.message);
    return false;
  }
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
      json: { planos: items.map((p) => p.id), vidas: S.vidas, over: S.over, cliente: nomeCliente(), opts: opcoes() },
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
  box.innerHTML = made.map((m, i) => `<figure><img src="${m.url}" alt="Proposta ${esc(m.p.nome)}"><figcaption>${esc(m.p.nome)}</figcaption><button class="btn primary" data-cp="${i}">Copiar e baixar imagem</button><button class="btn" data-pdf="${i}">Baixar PDF</button></figure>`).join("");
  box.querySelectorAll("[data-pdf]").forEach((b) => (b.onclick = () => savePdf(cards[+b.dataset.pdf], b)));
  box.querySelectorAll("[data-cp]").forEach((b) => (b.onclick = () => copyCard(cards[+b.dataset.cp])));
  paintChat(currentMsg());
}

const fileName = (m, extensao = "png") => `${m.titulo.replace(/[\\/:*?"<>|]/g, "")}${nomeCliente() ? " - " + nomeCliente().replace(/[\\/:*?"<>|]/g, "") : ""}.${extensao}`;

function baixarArquivo(url, nome) {
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return salvar(true);
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
  else toast(salvou ? "Imagem copiada, baixada e salva no histórico: cole no WhatsApp" : "Imagem copiada e baixada: cole no WhatsApp");
}

// O link do WhatsApp só leva texto. A imagem vai para a área de transferência antes de abrir a conversa,
// porque com a nova aba em primeiro plano o navegador recusaria a cópia.
async function abrirWhatsApp() {
  if (!currentMsg()) { toast("Escolha um plano primeiro"); return; }
  if (!cardsProntos) { toast("A imagem ainda está sendo gerada: tente de novo em um instante"); return; }
  const copiou = await copiarImagem(cards[0]);
  window.open(linkConversaDireta(normFone($("#fone").value), currentMsg(), navigator.userAgent), "_blank", "noopener");
  salvar(true);
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
      json: { planos: [...S.selected], vidas: S.vidas, over: S.over, cliente: nomeCliente(), fone: normFone($("#fone").value), opts: opcoes() },
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
  renderFaixas();
  renderPlans();
  renderSel();
  const nome = nomeCliente();
  $("#pv-nome").textContent = nome || "Cliente";
  $("#av").textContent = (nome[0] || "?").toUpperCase();
  lastAuto = buildMsg({ items: planosEscolhidos(), vidas: S.vidas, over: S.over, nome, corretor: corretor(), opts: opcoes() });
  $("#nota-envio").textContent = "Abrir no WhatsApp leva o texto e copia a imagem: na conversa, aperte Ctrl+V para colar a imagem. Com vários planos, copie as outras imagens nos botões acima. Ao copiar, a cotação fica salva no histórico do número.";
  $("#links-gerados").hidden = true;
  $("#comparar").hidden = planosEscolhidos().length < 2;
  manual = false;
  $("#rawtxt").value = lastAuto;
  paintChat(lastAuto);
  cardsProntos = false;
  clearTimeout(cardTimer);
  cardTimer = setTimeout(renderCards, 250);
}

export function iniciarCotacao() {
  $("#tipo").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    S.tipo = b.dataset.t;
    for (const x of $("#tipo").children) x.setAttribute("aria-pressed", x === b);
    S.selected = S.selected.filter((id) => (S.plans.find((p) => p.id === id) || {}).categoria === S.tipo);
    render();
  };
  for (const id of ["cliente", "fone", "o-copart", "o-rede", "o-acom"]) $("#" + id).addEventListener("input", render);
  $("#limpar-vidas").onclick = () => { S.vidas = Array(10).fill(0); render(); };
  $("#rawtxt").addEventListener("input", () => { manual = true; paintChat($("#rawtxt").value); });

  $("#copy").onclick = async () => {
    if (!currentMsg()) { toast("Escolha um plano primeiro"); return; }
    const t = currentMsg();
    try {
      await navigator.clipboard.writeText(t);
      const ok = await salvar(true);
      toast(ok ? "Mensagem copiada e salva no histórico" : "Mensagem copiada");
    } catch {
      $("#raw").open = true;
      const ta = $("#rawtxt");
      ta.value = t;
      ta.focus();
      ta.select();
      toast("Selecionei o texto: use Ctrl+C");
      salvar(true);
    }
  };
  $("#copiar-link").onclick = copiarLink;
  $("#comparar").onclick = () => abrirComparativo(
    planosEscolhidos(),
    { vidas: S.vidas, over: S.over, cliente: nomeCliente(), opts: opcoes() },
    { copiar: copyCard, baixarPdf: savePdf },
  );
  $("#wa").addEventListener("click", (e) => { e.preventDefault(); abrirWhatsApp(); });
  $("#salvar-hist").onclick = async () => {
    if (!currentMsg()) { toast("Escolha um plano primeiro"); return; }
    if (await salvar(false)) toast("Cotação salva no histórico");
  };
  $("#fone").addEventListener("input", () => {
    const f = normFone($("#fone").value);
    if (f.length >= 10 && !nomeCliente()) {
      const h = S.hist.find((x) => x.fone === f && x.cliente);
      if (h) { $("#cliente").value = h.cliente; render(); }
    }
    renderHistCli();
  });
}
