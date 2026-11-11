// Tela "Documentos": os documentos de cada plano, agrupados nos mesmos cartões da Nova cotação
// (ex.: UNIMED, AMIL PRATA MG I). Cada cartão tem a sua lista e a mensagem pronta para o WhatsApp.
import { $, S, api, avisoCentral, esc, pode, toast } from "./estado.js";
import { mensagemDocumentosDoPlano, waHtml } from "./mensagem.js";
import { copiarTexto } from "./cotacao.js";

const TIPOS = { PF: "Pessoa física", CNPJ: "CNPJ" };
let cartoes = [], aba = "PF", escolhido = { PF: "", CNPJ: "" }, editando = null, excluindo = null;
const cartoesDaAba = () => cartoes.filter((c) => c.tipo === aba);
const cartaoAtual = () => cartoesDaAba().find((c) => c.nome === escolhido[aba]) ?? cartoesDaAba()[0] ?? null;

const icone = (corpo) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;
const ICONES = {
  editar: icone('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  excluir: icone('<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>'),
};
const botaoIcone = (nome, rotulo, atributos, extra = "") => `<button type="button" class="iconbtn doc-acao ${extra}" title="${esc(rotulo)}" aria-label="${esc(rotulo)}" ${atributos}>${ICONES[nome]}</button>`;

export async function carregarDocumentos() {
  cartoes = await api("/api/documentos");
  renderDocumentos();
}

function renderAbas() {
  $("#doc-abas").innerHTML = Object.entries(TIPOS).map(([tipo, nome]) =>
    `<button type="button" class="cfg-item" data-tipo="${tipo}" aria-current="${tipo === aba}">${nome} <span class="cat-qtd">${cartoes.filter((c) => c.tipo === tipo).length}</span></button>`).join("");
  $("#doc-abas").querySelectorAll("[data-tipo]").forEach((b) => (b.onclick = () => {
    aba = b.dataset.tipo;
    editando = excluindo = null;
    renderDocumentos();
  }));
}

const qtdDocs = (n) => `${n} ${n === 1 ? "documento" : "documentos"}`;

function renderSeletor() {
  const sel = $("#doc-plano"), c = cartaoAtual();
  const opcoes = cartoesDaAba().map((x) => `<option value="${esc(x.nome)}">${esc(x.nome)} · ${qtdDocs(x.documentos.length)}</option>`).join("");
  if (sel.dataset.opcoes !== opcoes) { sel.innerHTML = opcoes; sel.dataset.opcoes = opcoes; }
  sel.value = c?.nome ?? "";
  sel.disabled = !c;
  $("#doc-opcoes").textContent = c && c.planos.length > 1 ? `Vale para as ${c.planos.length} opções deste cartão: ${c.planos.join(", ")}.` : "";
}

export function renderDocumentos() {
  renderAbas();
  renderSeletor();
  const c = cartaoAtual(), edita = pode("documentos", "editar");
  const lista = c?.documentos ?? [];
  $("#doc-form").hidden = !edita || !c;
  if (c) $("#doc-nome-rotulo").textContent = `Novo documento para ${c.nome}`;
  $("#doc-nome").placeholder = aba === "CNPJ" ? "Ex.: Contrato social" : "Ex.: Comprovante de residência";
  $("#doc-count").textContent = c ? `${lista.length} ${lista.length === 1 ? "documento pedido" : "documentos pedidos"} em ${c.nome}` : "";
  renderMensagem(c);
  const box = $("#doc-list");
  if (!c) { box.innerHTML = `<div class="status">Nenhum plano de ${TIPOS[aba].toLowerCase()} cadastrado.</div>`; return; }
  if (!lista.length) {
    box.innerHTML = `<div class="status">Nenhum documento cadastrado para ${esc(c.nome)}.${edita ? " Escreva o nome acima e clique em <b>Adicionar</b>." : ""}</div>`;
    return;
  }
  if (!edita) {
    box.innerHTML = lista.map((d) => `<div class="catrow"><div class="t"><b>${esc(d.nome)}</b></div></div>`).join("");
    return;
  }
  box.innerHTML = lista.map((d) => {
    const nome = editando === d.id
      ? `<input type="text" data-nome value="${esc(d.nome)}" aria-label="Nome do documento"><div class="actions" style="margin-top:8px"><button class="btn primary" data-salvar>Salvar</button><button class="btn" data-cancelar>Cancelar</button></div>`
      : `<b>${esc(d.nome)}</b>`;
    return `<div class="catrow" data-id="${d.id}">
      <div class="t" style="flex:1 1 240px">${nome}</div>
      <div class="actions">
        ${botaoIcone("editar", "Editar nome", "data-editar")}
        ${botaoIcone("excluir", "Excluir documento", "data-excluir", "perigo")}
      </div>
      ${excluindo === d.id ? `<div class="status" style="flex:1 1 100%">Tirar <b>${esc(d.nome)}</b> dos documentos de ${esc(c.nome)}? <div class="actions" style="margin-top:8px"><button class="btn danger" data-excluir-sim>Sim, excluir</button><button class="btn" data-excluir-nao>Manter</button></div></div>` : ""}
    </div>`;
  }).join("");
  box.querySelectorAll(".catrow[data-id]").forEach((row) => ligarLinha(row, c));
  if (editando != null) box.querySelector("[data-nome]")?.focus();
}

const textoDaMensagem = (c) => mensagemDocumentosDoPlano({
  plano: c.nome, tipo: c.tipo, documentos: c.documentos.map((d) => d.nome),
  corretor: { nome: S.cor.nome.trim(), fone: S.cor.fone.trim(), empresa: S.cor.empresa.trim() },
});

function renderMensagem(c) {
  const caixa = $("#doc-msg");
  caixa.hidden = !c?.documentos.length;
  if (!caixa.hidden) $("#doc-msg-previa").innerHTML = waHtml(textoDaMensagem(c));
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
    await api(url, { metodo: "PUT", json: { nome: row.querySelector("[data-nome]").value, tipo: c.tipo, cartao: c.nome } });
    editando = null;
    avisoCentral("Documento salvo com sucesso");
  });
  on("[data-salvar]", salvarNome);
  const campo = row.querySelector("[data-nome]");
  if (campo) campo.onkeydown = (e) => { if (e.key === "Enter") salvarNome(); };
  on("[data-excluir]", () => { excluindo = id; editando = null; renderDocumentos(); });
  on("[data-excluir-nao]", () => { excluindo = null; renderDocumentos(); });
  on("[data-excluir-sim]", () => executar(async () => {
    excluindo = null;
    await api(`${url}?${new URLSearchParams({ tipo: c.tipo, cartao: c.nome })}`, { metodo: "DELETE" });
    avisoCentral("Documento excluído com sucesso");
  }));
}

export function iniciarDocumentos() {
  $("#doc-plano").onchange = (e) => {
    escolhido[aba] = e.target.value;
    editando = excluindo = null;
    renderDocumentos();
  };
  $("#doc-form").onsubmit = async (e) => {
    e.preventDefault();
    const campo = $("#doc-nome"), c = cartaoAtual();
    if (!c) return;
    try {
      await api("/api/documentos", { metodo: "POST", json: { nome: campo.value, tipo: c.tipo, cartao: c.nome } });
      escolhido[aba] = c.nome;
      campo.value = "";
      await carregarDocumentos();
      avisoCentral("Documento cadastrado com sucesso");
      campo.focus();
    } catch (erro) {
      toast(erro.message, "erro");
    }
  };
  $("#doc-copiar").onclick = async () => {
    const c = cartaoAtual();
    if (!c?.documentos.length) return;
    if (await copiarTexto(textoDaMensagem(c))) toast("Mensagem copiada: cole na conversa do cliente no WhatsApp", "sucesso");
    else toast("Não deu para copiar: selecione o texto da mensagem e use Ctrl+C", "erro");
  };
}
