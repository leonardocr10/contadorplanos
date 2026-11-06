// Tela "Documentos": cadastro dos documentos e o que fica ativo em cada plano.
import { $, S, api, avisoCentral, esc, pode, toast } from "./estado.js";
import { normalizar } from "./filtro-select.js";

let docs = [], planoId = null, editando = null, excluindo = null, planosAberto = null, filtroPlanos = "";

const icone = (corpo) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;
const ICONES = {
  planos: icone('<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="m3 6 1 1 2-2"/><path d="m3 12 1 1 2-2"/><path d="m3 18 1 1 2-2"/>'),
  todos: icone('<path d="m2 12 5 5L18 6"/><path d="m12 16 1 1L22 6"/>'),
  nenhum: icone('<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/>'),
  editar: icone('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  excluir: icone('<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>'),
};
const botaoIcone = (nome, rotulo, atributos, extra = "") => `<button type="button" class="iconbtn doc-acao ${extra}" title="${esc(rotulo)}" aria-label="${esc(rotulo)}" ${atributos}>${ICONES[nome]}</button>`;

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

function painelPlanos(d) {
  const grupo = (cat, rotulo) => {
    const lista = S.plans.filter((p) => p.categoria === cat);
    if (!lista.length) return "";
    return `<div class="doc-grupo" data-grupo>
      <div class="label">${rotulo}</div>
      <div class="doc-planos">${lista.map((p) => `<label class="uchk" data-nome-plano="${esc(normalizar(p.nome))}"><input type="checkbox" data-plano="${esc(p.id)}" ${d.planos.includes(p.id) ? "checked" : ""}> ${esc(p.nome)}${p.ativo === false ? " (oculto)" : ""}</label>`).join("")}</div>
    </div>`;
  };
  return `<div class="doc-painel" style="flex:1 1 100%">
    <div class="field"><label for="doc-filtro-${d.id}">Planos com este documento: marque ou desmarque</label><input type="text" id="doc-filtro-${d.id}" data-filtro-planos placeholder="Filtrar planos…" autocomplete="off" value="${esc(filtroPlanos)}"></div>
    ${grupo("PF", "Pessoa física")}${grupo("CNPJ", "CNPJ")}
    <div class="note" data-sem-planos hidden>Nenhum plano encontrado.</div>
  </div>`;
}

function aplicarFiltroPlanos(row) {
  const palavras = normalizar(filtroPlanos).split(/\s+/).filter(Boolean);
  let algum = false;
  row.querySelectorAll("[data-grupo]").forEach((g) => {
    let noGrupo = false;
    g.querySelectorAll("[data-nome-plano]").forEach((l) => {
      l.hidden = !palavras.every((p) => l.dataset.nomePlano.includes(p));
      noGrupo ||= !l.hidden;
    });
    g.hidden = !noGrupo;
    algum ||= noGrupo;
  });
  const vazio = row.querySelector("[data-sem-planos]");
  if (vazio) vazio.hidden = algum;
}

// Quem tem só visualização consulta os documentos pedidos no plano escolhido.
function renderConsulta() {
  const lista = docs.filter((d) => d.planos.includes(planoId));
  $("#doc-count").textContent = planoId ? `${lista.length} ${lista.length === 1 ? "documento pedido" : "documentos pedidos"} neste plano` : "";
  $("#doc-list").innerHTML = lista.length
    ? lista.map((d) => `<div class="catrow"><div class="t"><b>${esc(d.nome)}</b></div></div>`).join("")
    : `<div class="status">Nenhum documento ativo neste plano.</div>`;
}

export function renderDocumentos() {
  renderSeletor();
  if (!pode("documentos", "editar")) { renderConsulta(); return; }
  const ativos = docs.filter((d) => d.planos.includes(planoId)).length;
  $("#doc-count").textContent = planoId ? `${ativos} de ${docs.length} ${docs.length === 1 ? "documento ativo" : "documentos ativos"} neste plano` : "";
  const box = $("#doc-list");
  if (!docs.length) {
    box.innerHTML = `<div class="status">Nenhum documento cadastrado. Escreva o nome acima e clique em <b>Adicionar</b>.</div>`;
    return;
  }
  const total = S.plans.length;
  box.innerHTML = docs.map((d) => {
    const ativo = d.planos.includes(planoId), aberto = planosAberto === d.id;
    const nome = editando === d.id
      ? `<input type="text" data-nome value="${esc(d.nome)}" aria-label="Nome do documento"><div class="actions" style="margin-top:8px"><button class="btn primary" data-salvar>Salvar</button><button class="btn" data-cancelar>Cancelar</button></div>`
      : `<b>${esc(d.nome)}</b><span>Ativo em ${d.planos.length} de ${total} planos</span>`;
    return `<div class="catrow" data-id="${d.id}">
      <div class="t" style="flex:1 1 240px">${nome}</div>
      <label class="uchk"><input type="checkbox" data-ativo ${ativo ? "checked" : ""} ${planoId ? "" : "disabled"}> <span class="pill ${ativo ? "" : "off"}" style="margin:0">${ativo ? "ATIVO" : "INATIVO"}</span></label>
      <div class="actions">
        ${botaoIcone("planos", `Ver e marcar os planos de ${d.nome}`, `data-ver-planos aria-expanded="${aberto}"`, aberto ? "ligado" : "")}
        ${botaoIcone("todos", "Ativar em todos os planos", 'data-todos="1"')}
        ${botaoIcone("nenhum", "Inativar em todos os planos", 'data-todos="0"')}
        ${botaoIcone("editar", "Editar nome", "data-editar")}
        ${botaoIcone("excluir", "Excluir documento", "data-excluir", "perigo")}
      </div>
      ${aberto ? painelPlanos(d) : ""}
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

  on("[data-ver-planos]", () => {
    planosAberto = planosAberto === id ? null : id;
    filtroPlanos = "";
    renderDocumentos();
    if (planosAberto === id) $(`#doc-filtro-${id}`)?.focus();
  });
  const filtro = row.querySelector("[data-filtro-planos]");
  if (filtro) {
    aplicarFiltroPlanos(row);
    filtro.oninput = () => { filtroPlanos = filtro.value; aplicarFiltroPlanos(row); };
  }
  row.querySelectorAll("[data-plano]").forEach((c) => (c.onchange = async () => {
    const plano = c.dataset.plano;
    await executar(() => api(`${url}/planos/${encodeURIComponent(plano)}`, { metodo: "PUT", json: { ativo: c.checked } }));
    // A lista é redesenhada: o foco volta para o plano que acabou de ser marcado.
    [...document.querySelectorAll(`.catrow[data-id="${id}"] [data-plano]`)].find((x) => x.dataset.plano === plano)?.focus();
  }));

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
    if (planosAberto === id) planosAberto = null;
    await api(url, { metodo: "DELETE" });
    avisoCentral("Documento excluído com sucesso");
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
