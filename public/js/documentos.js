// Tela "Documentos": os documentos de pessoa física e os de CNPJ. Cada um vale para todos os planos do seu tipo.
import { $, api, avisoCentral, esc, pode, toast } from "./estado.js";

const TIPOS = { PF: "Pessoa física", CNPJ: "CNPJ" };
const NOME_DO_TIPO = { PF: "pessoa física", CNPJ: "CNPJ" };
let docs = [], aba = "PF", editando = null, excluindo = null;
const docsDaAba = () => docs.filter((d) => d.tipo === aba);

const icone = (corpo) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;
const ICONES = {
  editar: icone('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  excluir: icone('<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>'),
};
const botaoIcone = (nome, rotulo, atributos, extra = "") => `<button type="button" class="iconbtn doc-acao ${extra}" title="${esc(rotulo)}" aria-label="${esc(rotulo)}" ${atributos}>${ICONES[nome]}</button>`;

export async function carregarDocumentos() {
  docs = await api("/api/documentos");
  renderDocumentos();
}

function renderAbas() {
  $("#doc-abas").innerHTML = Object.entries(TIPOS).map(([tipo, nome]) =>
    `<button type="button" class="cfg-item" data-tipo="${tipo}" aria-current="${tipo === aba}">${nome} <span class="cat-qtd">${docs.filter((d) => d.tipo === tipo).length}</span></button>`).join("");
  $("#doc-abas").querySelectorAll("[data-tipo]").forEach((b) => (b.onclick = () => {
    aba = b.dataset.tipo;
    editando = excluindo = null;
    renderDocumentos();
  }));
}

export function renderDocumentos() {
  renderAbas();
  const lista = docsDaAba(), edita = pode("documentos", "editar");
  $("#doc-count").textContent = `${lista.length} ${lista.length === 1 ? "documento pedido" : "documentos pedidos"} em todos os planos de ${NOME_DO_TIPO[aba]}`;
  $("#doc-nome").placeholder = aba === "CNPJ" ? "Ex.: Contrato social" : "Ex.: Comprovante de residência";
  $("#doc-nome-rotulo").textContent = `Novo documento de ${NOME_DO_TIPO[aba]} (vale para todos os planos de ${NOME_DO_TIPO[aba]})`;
  const box = $("#doc-list");
  if (!lista.length) {
    box.innerHTML = `<div class="status">Nenhum documento de ${NOME_DO_TIPO[aba]} cadastrado.${edita ? " Escreva o nome acima e clique em <b>Adicionar</b>." : ""}</div>`;
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
      ${excluindo === d.id ? `<div class="status" style="flex:1 1 100%">Excluir <b>${esc(d.nome)}</b> dos documentos de ${NOME_DO_TIPO[d.tipo]}? <div class="actions" style="margin-top:8px"><button class="btn danger" data-excluir-sim>Sim, excluir</button><button class="btn" data-excluir-nao>Manter</button></div></div>` : ""}
    </div>`;
  }).join("");
  box.querySelectorAll(".catrow[data-id]").forEach(ligarLinha);
  if (editando != null) box.querySelector("[data-nome]")?.focus();
}

function ligarLinha(row) {
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
    await api(url, { metodo: "PUT", json: { nome: row.querySelector("[data-nome]").value } });
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
    await api(url, { metodo: "DELETE" });
    avisoCentral("Documento excluído com sucesso");
  }));
}

export function iniciarDocumentos() {
  $("#doc-form").onsubmit = async (e) => {
    e.preventDefault();
    const campo = $("#doc-nome");
    try {
      await api("/api/documentos", { metodo: "POST", json: { nome: campo.value, tipo: aba } });
      campo.value = "";
      await carregarDocumentos();
      avisoCentral("Documento cadastrado com sucesso");
      campo.focus();
    } catch (erro) {
      toast(erro.message, "erro");
    }
  };
}
