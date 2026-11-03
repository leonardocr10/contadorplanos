// Tela "Documentos": cadastro dos documentos e o que fica ativo em cada plano.
import { $, S, api, esc, toast } from "./estado.js";

let docs = [], planoId = null, editando = null, excluindo = null;

export async function carregarDocumentos() {
  docs = await api("/api/documentos");
  renderDocumentos();
}

function renderSeletor() {
  if (!S.plans.some((p) => p.id === planoId)) planoId = S.plans[0]?.id ?? null;
  const grupo = (cat, rotulo) => {
    const lista = S.plans.filter((p) => p.categoria === cat);
    return lista.length ? `<optgroup label="${rotulo}">${lista.map((p) => `<option value="${esc(p.id)}" ${p.id === planoId ? "selected" : ""}>${esc(p.nome)}${p.ativo === false ? " (oculto)" : ""}</option>`).join("")}</optgroup>` : "";
  };
  $("#doc-plano").innerHTML = grupo("PF", "Pessoa física") + grupo("CNPJ", "CNPJ");
}

export function renderDocumentos() {
  renderSeletor();
  const ativos = docs.filter((d) => d.planos.includes(planoId)).length;
  $("#doc-count").textContent = planoId ? `${ativos} de ${docs.length} ${docs.length === 1 ? "documento ativo" : "documentos ativos"} neste plano` : "";
  const box = $("#doc-list");
  if (!docs.length) {
    box.innerHTML = `<div class="status">Nenhum documento cadastrado. Escreva o nome acima e clique em <b>Adicionar</b>.</div>`;
    return;
  }
  const total = S.plans.length;
  box.innerHTML = docs.map((d) => {
    const ativo = d.planos.includes(planoId);
    const nome = editando === d.id
      ? `<input type="text" data-nome value="${esc(d.nome)}" aria-label="Nome do documento"><div class="actions" style="margin-top:8px"><button class="btn primary" data-salvar>Salvar</button><button class="btn" data-cancelar>Cancelar</button></div>`
      : `<b>${esc(d.nome)}</b><span>Ativo em ${d.planos.length} de ${total} planos</span>`;
    return `<div class="catrow" data-id="${d.id}">
      <div class="t" style="flex:1 1 240px">${nome}</div>
      <label class="uchk"><input type="checkbox" data-ativo ${ativo ? "checked" : ""} ${planoId ? "" : "disabled"}> <span class="pill ${ativo ? "" : "off"}" style="margin:0">${ativo ? "ATIVO" : "INATIVO"}</span></label>
      <div class="actions">
        <button class="btn" data-todos="1">Ativar em todos</button>
        <button class="btn" data-todos="0">Inativar em todos</button>
        <button class="btn" data-editar>Editar</button>
        <button class="btn danger" data-excluir>Excluir</button>
      </div>
      ${excluindo === d.id ? `<div class="status" style="flex:1 1 100%">Excluir <b>${esc(d.nome)}</b> de todos os planos? <div class="actions" style="margin-top:8px"><button class="btn danger" data-excluir-sim>Sim, excluir</button><button class="btn" data-excluir-nao>Manter</button></div></div>` : ""}
    </div>`;
  }).join("");
  box.querySelectorAll(".catrow").forEach(ligarLinha);
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
      toast(e.message);
      await carregarDocumentos().catch(() => {});
    }
  };
  const on = (seletor, fn) => { const el = row.querySelector(seletor); if (el) el.onclick = fn; };

  row.querySelector("[data-ativo]").onchange = (e) => executar(() =>
    api(`${url}/planos/${encodeURIComponent(planoId)}`, { metodo: "PUT", json: { ativo: e.target.checked } }));
  row.querySelectorAll("[data-todos]").forEach((b) => (b.onclick = () => executar(() =>
    api(`${url}/planos`, { metodo: "PUT", json: { ativo: b.dataset.todos === "1" } }))));
  on("[data-editar]", () => { editando = id; excluindo = null; renderDocumentos(); });
  on("[data-cancelar]", () => { editando = null; renderDocumentos(); });
  const salvarNome = () => executar(async () => {
    await api(url, { metodo: "PUT", json: { nome: row.querySelector("[data-nome]").value } });
    editando = null;
  });
  on("[data-salvar]", salvarNome);
  const campo = row.querySelector("[data-nome]");
  if (campo) campo.onkeydown = (e) => { if (e.key === "Enter") salvarNome(); };
  on("[data-excluir]", () => { excluindo = id; editando = null; renderDocumentos(); });
  on("[data-excluir-nao]", () => { excluindo = null; renderDocumentos(); });
  on("[data-excluir-sim]", () => executar(async () => {
    excluindo = null;
    await api(url, { metodo: "DELETE" });
    toast("Documento excluído");
  }));
}

export function iniciarDocumentos() {
  $("#doc-plano").onchange = (e) => { planoId = e.target.value; editando = null; excluindo = null; renderDocumentos(); };
  $("#doc-form").onsubmit = async (e) => {
    e.preventDefault();
    const campo = $("#doc-nome");
    try {
      await api("/api/documentos", { metodo: "POST", json: { nome: campo.value, planoId } });
      campo.value = "";
      await carregarDocumentos();
      campo.focus();
    } catch (erro) {
      toast(erro.message);
    }
  };
}
