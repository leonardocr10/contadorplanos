// Tela "Documentos": a lista dos planos, agrupados nos mesmos cartões da Nova cotação (ex.: UNIMED,
// AMIL PRATA MG I), com busca. Clicar no plano abre a tela dele: documentos e mensagem para o WhatsApp.
import { $, S, api, avisoCentral, esc, pode, toast } from "./estado.js";
import { mensagemDocumentosDoPlano, waHtml } from "./mensagem.js";
import { copiarTexto } from "./cotacao.js";
import { normalizar } from "./filtro-select.js";
import { SUFIXOS } from "./calculo.js";

const TIPOS = { PF: "Pessoa física", CNPJ: "CNPJ" };
let cartoes = [], aba = "PF", busca = "", aberto = null, opcao = "", editando = null, excluindo = null;
// Documentos desmarcados: ficam fora da mensagem. Ao abrir outro plano ou opção, todos voltam marcados.
let fora = new Set();
// Plano marcado na lista (o painel pode estar mostrando todas as opções do cartão dele).
let visto = "";
const cartoesDaAba = () => cartoes.filter((c) => c.tipo === aba);
// O plano aberto some se for renomeado ou apagado em Planos e valores: a tela volta para a lista.
const cartaoAberto = () => (aberto ? cartoes.find((c) => c.tipo === aberto.tipo && c.nome === aberto.nome) ?? null : null);

const icone = (corpo) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;
const ICONES = {
  editar: icone('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  excluir: icone('<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>'),
  ver: icone('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
};
const botaoIcone = (nome, rotulo, atributos, extra = "") => `<button type="button" class="iconbtn doc-acao ${extra}" title="${esc(rotulo)}" aria-label="${esc(rotulo)}" ${atributos}>${ICONES[nome]}</button>`;

export async function carregarDocumentos() {
  cartoes = await api("/api/documentos");
  renderDocumentos();
}

// Como em Planos e valores: a lista dos planos à esquerda e o plano escolhido à direita.
export function renderDocumentos() {
  const c = cartaoAberto();
  if (aberto && !c) { aberto = null; visto = ""; }
  renderLista();
  $("#doc-vazio").hidden = !!c;
  $("#doc-plano-tela").hidden = !c;
  if (c) renderPlano(c);
}

/* ---------- lista dos planos ---------- */
function renderAbas() {
  $("#doc-abas").innerHTML = Object.entries(TIPOS).map(([tipo, nome]) =>
    `<button type="button" class="cfg-item" data-tipo="${tipo}" aria-current="${tipo === aba}">${nome} <span class="cat-qtd">${cartoes.filter((c) => c.tipo === tipo).reduce((n, c) => n + c.planos.length, 0)}</span></button>`).join("");
  $("#doc-abas").querySelectorAll("[data-tipo]").forEach((b) => (b.onclick = () => {
    if (aba === b.dataset.tipo) return;
    aba = b.dataset.tipo;
    aberto = null;
    visto = opcao = "";
    editando = excluindo = null;
    renderDocumentos();
  }));
}

// Cada plano aparece na lista, como em Planos e valores (ex.: AMIL OURO 30%, AMIL OURO 30% MEI),
// na mesma ordem; o cartão dele só serve para cadastrar o mesmo documento nas outras opções.
const planosDaAba = () => cartoesDaAba()
  .flatMap((c) => c.planos.map((p) => ({ c, p })))
  .sort((a, b) => a.p.ordem - b.p.ordem);
const achados = () => {
  const termo = normalizar(busca);
  const todos = planosDaAba();
  return termo ? todos.filter(({ c, p }) => [p.nome, c.nome].some((n) => normalizar(n).includes(termo))) : todos;
};

function renderLista() {
  renderAbas();
  const todos = planosDaAba(), lista = achados();
  const box = $("#doc-planos");
  if (!lista.length) {
    box.innerHTML = `<div class="status">${todos.length ? "Nenhum plano encontrado com essa busca." : `Nenhum plano de ${TIPOS[aba].toLowerCase()} cadastrado.`}</div>`;
    return;
  }
  box.innerHTML = lista.map(({ p }, i) => `<div class="catrow${p.id === visto ? " visto" : ""}" data-i="${i}">
      <button type="button" class="cat-nome" aria-current="${p.id === visto}">${esc(p.nome)}</button>
    </div>`).join("");
  box.querySelectorAll(".catrow[data-i]").forEach((row) => {
    const { c, p } = lista[Number(row.dataset.i)];
    row.querySelectorAll("button").forEach((b) => (b.onclick = () => abrirPlano(c, p.id)));
  });
}

function abrirPlano(c, planoId) {
  aberto = { tipo: c.tipo, nome: c.nome };
  visto = opcao = planoId;
  fora = new Set();
  editando = excluindo = null;
  renderDocumentos();
  // Em tela estreita o painel fica embaixo da lista: leva até ele.
  if (matchMedia("(max-width:900px)").matches) $(".doc-detalhe").scrollIntoView({ block: "start" });
  else if (pode("documentos", "editar")) $("#doc-nome").focus({ preventScroll: true });
}

/* ---------- tela do plano ---------- */
// Opção escolhida dentro do cartão; vazia, as ações valem para todas as opções.
const opcaoDe = (c) => c.planos.find((p) => p.id === opcao) ?? null;
const nomeDaVisao = (c) => opcaoDe(c)?.nome ?? c.nome;
const docsDaVisao = (c) => (opcaoDe(c) ? c.documentos.filter((d) => d.planos.includes(opcao)) : c.documentos);
// Na visão de todas as opções, a mensagem leva só o que todas pedem; o resto depende da opção.
const docsDaMensagem = (c) => (opcaoDe(c) ? docsDaVisao(c) : c.documentos.filter((d) => d.planos.length === c.planos.length));
const marcados = (c) => docsDaMensagem(c).filter((d) => !fora.has(d.id));
const marca = (c, d) => (docsDaMensagem(c).some((x) => x.id === d.id)
  ? `<label class="doc-marca" title="Pedir na mensagem"><input type="checkbox" data-marca="${d.id}" aria-label="Pedir ${esc(d.nome)} na mensagem"${fora.has(d.id) ? "" : " checked"}></label>`
  : `<span class="doc-marca"></span>`);
const alvo = (c) => ({ tipo: c.tipo, cartao: c.nome, ...(opcaoDe(c) ? { plano: opcao } : {}) });
// Na visão de todas as opções, o documento que não vale para todas diz onde vale.
const ondeVale = (c, d) => {
  if (opcaoDe(c) || d.planos.length === c.planos.length) return "";
  const nomes = c.planos.filter((p) => d.planos.includes(p.id)).map((p) => p.nome);
  return `<span class="doc-so-em">Só em: ${esc(nomes.join(", "))}</span>`;
};

function renderOpcoes(c) {
  const campo = $("#doc-opcao-campo"), sel = $("#doc-opcao");
  campo.hidden = c.planos.length < 2;
  if (!opcaoDe(c)) opcao = "";
  if (campo.hidden) return;
  const html = `<option value="">Todas as opções de ${esc(c.nome)} (${c.planos.length})</option>${c.planos.map((p) => {
    const n = c.documentos.filter((d) => d.planos.includes(p.id)).length;
    return `<option value="${esc(p.id)}">${esc(p.nome)} · ${n} ${n === 1 ? "documento" : "documentos"}</option>`;
  }).join("")}`;
  if (sel.dataset.opcoes !== html) { sel.innerHTML = html; sel.dataset.opcoes = html; }
  sel.value = opcao;
}

function renderPlano(c) {
  renderOpcoes(c);
  const lista = docsDaVisao(c), edita = pode("documentos", "editar"), nome = nomeDaVisao(c);
  $("#doc-titulo").textContent = `${nome} · ${TIPOS[c.tipo]}`;
  $("#doc-opcoes").textContent = c.planos.length < 2 ? ""
    : opcaoDe(c) ? `Para cadastrar o mesmo documento nas ${c.planos.length} opções de ${c.nome} de uma vez, escolha "Todas as opções" abaixo.` : `Documentos de todas as ${c.planos.length} opções. O que for cadastrado ou excluído aqui vale para todas elas.`;
  $("#doc-form").hidden = !edita;
  $("#doc-nome-rotulo").textContent = `Novo documento para ${nome}${!opcaoDe(c) && c.planos.length > 1 ? " (todas as opções)" : ""}`;
  $("#doc-nome").placeholder = c.tipo === "CNPJ" ? "Ex.: Contrato social" : "Ex.: Comprovante de residência";
  $("#doc-count").textContent = `${lista.length} ${lista.length === 1 ? "documento pedido" : "documentos pedidos"} em ${nome}`;
  renderMensagem(c);
  const box = $("#doc-list");
  if (!lista.length) {
    box.innerHTML = `<div class="status">Nenhum documento cadastrado para ${esc(nome)}.${edita ? " Escreva o nome acima e clique em <b>Adicionar</b>." : ""}</div>`;
    return;
  }
  if (!edita) {
    box.innerHTML = lista.map((d) => `<div class="catrow doc-linha">${marca(c, d)}<div class="t" style="flex:1 1 0;min-width:0"><b title="${esc(d.nome)}">${esc(d.nome)}</b>${ondeVale(c, d)}</div></div>`).join("");
    ligarMarcas(box, c);
    return;
  }
  box.innerHTML = lista.map((d) => {
    const nome = editando === d.id
      ? `<input type="text" data-nome value="${esc(d.nome)}" aria-label="Nome do documento"><div class="actions" style="margin-top:8px"><button class="btn primary" data-salvar>Salvar</button><button class="btn" data-cancelar>Cancelar</button></div>`
      : `<b title="${esc(d.nome)}">${esc(d.nome)}</b>${ondeVale(c, d)}`;
    return `<div class="catrow doc-linha" data-id="${d.id}">
      ${marca(c, d)}<div class="t" style="flex:1 1 0;min-width:0">${nome}</div>
      ${excluindo === d.id
    // A confirmação fica na própria linha, no lugar dos botões.
    ? `<div class="actions doc-confirma"><span>Excluir?</span><button type="button" class="btn danger" data-excluir-sim>Sim</button><button type="button" class="btn" data-excluir-nao>Não</button></div>`
    : `<div class="actions">
        ${botaoIcone("editar", "Editar nome", "data-editar")}
        ${botaoIcone("excluir", "Excluir documento", "data-excluir", "perigo")}
      </div>`}
    </div>`;
  }).join("");
  box.querySelectorAll(".catrow[data-id]").forEach((row) => ligarLinha(row, c));
  ligarMarcas(box, c);
  if (editando != null) box.querySelector("[data-nome]")?.focus();
}

// O cliente não precisa ver a coparticipação nem o MEI: "AMIL OURO 30% MEI" vai como "AMIL OURO".
const textoDaMensagem = (c) => mensagemDocumentosDoPlano({
  plano: nomeDaVisao(c).replace(SUFIXOS, "").trim(), tipo: c.tipo, documentos: marcados(c).map((d) => d.nome),
  corretor: { nome: S.cor.nome.trim(), fone: S.cor.fone.trim(), empresa: S.cor.empresa.trim() },
});

function renderMensagem(c) {
  const caixa = $("#doc-msg"), todos = docsDaMensagem(c), lista = marcados(c);
  caixa.hidden = !todos.length;
  if (caixa.hidden) return;
  $("#doc-msg-qtd").textContent = `${lista.length} de ${todos.length} ${todos.length === 1 ? "documento marcado" : "documentos marcados"}`;
  $("#doc-marcar-todos").textContent = lista.length === todos.length ? "Desmarcar todos" : "Marcar todos";
  $("#doc-msg-previa").innerHTML = lista.length ? waHtml(textoDaMensagem(c)) : "Marque ao menos um documento para montar a mensagem.";
  $("#doc-copiar").disabled = !lista.length;
}

// Marcar ou desmarcar só refaz a mensagem: a lista fica como está.
function ligarMarcas(box, c) {
  box.querySelectorAll("[data-marca]").forEach((caixa) => (caixa.onchange = () => {
    const id = Number(caixa.dataset.marca);
    if (caixa.checked) fora.delete(id); else fora.add(id);
    renderMensagem(c);
  }));
}

function ligarLinha(row, c) {
  const id = Number(row.dataset.id);
  const url = `/api/documentos/${id}`;
  const executar = async (acao) => {
    try {
      await acao();
      await carregarDocumentos();
    } catch (e) {
      toast(e.message, "erro");
      await carregarDocumentos().catch(() => {});
    }
  };
  const on = (seletor, fn) => { const el = row.querySelector(seletor); if (el) el.onclick = fn; };
  on("[data-editar]", () => { editando = id; excluindo = null; renderDocumentos(); });
  on("[data-cancelar]", () => { editando = null; renderDocumentos(); });
  const salvarNome = () => executar(async () => {
    await api(url, { metodo: "PUT", json: { nome: row.querySelector("[data-nome]").value, ...alvo(c) } });
    editando = null;
    avisoCentral("Documento salvo com sucesso");
  });
  on("[data-salvar]", salvarNome);
  const campo = row.querySelector("[data-nome]");
  if (campo) campo.onkeydown = (e) => { if (e.key === "Enter") salvarNome(); if (e.key === "Escape") { editando = null; renderDocumentos(); } };
  on("[data-excluir]", () => { excluindo = id; editando = null; renderDocumentos(); });
  on("[data-excluir-nao]", () => { excluindo = null; renderDocumentos(); });
  // O documento some na hora; o servidor confirma depois. Se der erro, a lista volta como estava no servidor.
  on("[data-excluir-sim]", async () => {
    excluindo = null;
    const escopo = opcaoDe(c) ? [opcao] : c.planos.map((p) => p.id);
    const doc = c.documentos.find((d) => d.id === id);
    if (doc) doc.planos = doc.planos.filter((p) => !escopo.includes(p));
    c.documentos = c.documentos.filter((d) => d.planos.length);
    fora.delete(id);
    renderDocumentos();
    avisoCentral("Documento excluído com sucesso");
    try {
      await api(`${url}?${new URLSearchParams(alvo(c))}`, { metodo: "DELETE" });
    } catch (e) {
      toast(`Não deu para excluir: ${e.message}`, "erro");
      await carregarDocumentos().catch(() => {});
    }
  });
}

export function iniciarDocumentos() {
  $("#doc-busca").oninput = (e) => {
    busca = e.target.value;
    renderDocumentos();
  };
  $("#doc-marcar-todos").onclick = () => {
    const c = cartaoAberto();
    if (!c) return;
    const todos = docsDaMensagem(c);
    fora = marcados(c).length === todos.length ? new Set(todos.map((d) => d.id)) : new Set();
    renderDocumentos();
  };
  $("#doc-opcao").onchange = (e) => {
    opcao = e.target.value;
    fora = new Set();
    editando = excluindo = null;
    renderDocumentos();
  };
  $("#doc-form").onsubmit = async (e) => {
    e.preventDefault();
    const campo = $("#doc-nome"), botao = $("#doc-form [type=submit]"), c = cartaoAberto();
    if (!c || botao.disabled) return;
    if (!campo.value.trim()) { toast("Escreva o nome do documento", "erro"); campo.focus(); return; }
    // Enquanto grava, o botão avisa e não aceita outro clique.
    botao.disabled = true;
    botao.textContent = "Salvando…";
    try {
      const novo = await api("/api/documentos", { metodo: "POST", json: { nome: campo.value, ...alvo(c) } });
      // Atualiza a lista aqui mesmo, sem buscar tudo de novo no servidor.
      const escopo = opcaoDe(c) ? [opcao] : c.planos.map((p) => p.id);
      const doc = c.documentos.find((d) => d.id === novo.id);
      if (doc) doc.planos = c.planos.map((p) => p.id).filter((p) => doc.planos.includes(p) || escopo.includes(p));
      else c.documentos.push({ id: novo.id, nome: novo.nome, planos: escopo });
      campo.value = "";
      renderDocumentos();
      avisoCentral("Documento cadastrado com sucesso");
      campo.focus();
    } catch (erro) {
      toast(erro.message, "erro");
    } finally {
      botao.disabled = false;
      botao.textContent = "Adicionar";
    }
  };
  $("#doc-copiar").onclick = async () => {
    const c = cartaoAberto();
    if (!c || !marcados(c).length) return;
    if (await copiarTexto(textoDaMensagem(c))) toast("Mensagem copiada: cole na conversa do cliente no WhatsApp", "sucesso");
    else toast("Não deu para copiar: selecione o texto da mensagem e use Ctrl+C", "erro");
  };
}
