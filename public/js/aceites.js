// Tela "Aceites": clientes que aceitaram a proposta pelo link e o envio da lista de documentos.
import { brl, fmtFone } from "./calculo.js";
import { $, S, api, avisoCentral, esc, pode, toast } from "./estado.js";
import { linkConversaDireta, mensagemDocumentos } from "./mensagem.js";

let aceites = [], assinatura = null;
// Escolha de documentos em andamento: sobrevive às atualizações automáticas da lista.
let escolha = null;
const fmtData = (iso) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export async function carregarAceites() {
  const lista = await api("/api/aceites");
  const nova = JSON.stringify(lista);
  if (nova === assinatura) return;
  const novos = assinatura === null ? 0 : lista.length - aceites.length;
  assinatura = nova;
  aceites = lista;
  renderAceites();
  if (novos > 0) toast(novos === 1 ? "Novo aceite de proposta" : `${novos} novos aceites de proposta`, "sucesso");
}

export function renderAceites() {
  const pendentes = aceites.filter((a) => !a.docsEnviadosEm).length;
  const selo = $("#ace-selo");
  selo.textContent = pendentes;
  selo.hidden = !pendentes;
  $("#ace-count").textContent = `${aceites.length} ${aceites.length === 1 ? "aceite" : "aceites"} · ${pendentes} ${pendentes === 1 ? "pendente" : "pendentes"}`;
  const box = $("#ace-list");
  if (!aceites.length) {
    box.innerHTML = `<div class="status">Nenhum aceite ainda. Quando um cliente aceitar a proposta pelo link, ele aparece aqui.</div>`;
    return;
  }
  box.innerHTML = aceites.map((a) => `<div class="hq" data-token="${esc(a.token)}">
    <div class="hq-top"><span class="hg-name">${esc(a.cliente || "Sem nome")}</span><span class="pill ${a.docsEnviadosEm ? "st-ok" : "st-neg"}">${a.docsEnviadosEm ? "LISTA ABERTA NO WHATSAPP" : "ENVIAR DOCUMENTOS"}</span></div>
    <div class="hq-date">${a.fone ? esc(fmtFone(a.fone)) : "Sem número"} · aceitou em ${esc(fmtData(a.aceitoEm))}${a.responsavel ? ` · Corretor: ${esc(a.responsavel)}` : ""}</div>
    <div class="hq-plans"><b>${esc(a.plano)}</b> · ${esc(a.acomodacao)} · R$ ${brl(a.valor)} · ${a.categoria === "CNPJ" ? "CNPJ" : "PF"}</div>
    ${a.docsEnviadosEm ? `<div class="note">Conversa aberta com a lista em ${esc(fmtData(a.docsEnviadosEm))}</div>` : ""}
    ${pode("aceites", "editar") ? `<div class="actions"><button class="btn ${a.docsEnviadosEm ? "" : "primary"}" data-docs="1">${a.docsEnviadosEm ? "Enviar de novo" : "Enviar documentos no WhatsApp"}</button><button class="btn danger" data-excluir="1">Excluir</button></div>
    ${escolha?.token === a.token ? painelDeDocumentos(a) : ""}
    <div class="status" data-confirma hidden>Excluir o aceite de <b>${esc(a.cliente || "Sem nome")}</b>? O link desta proposta deixa de abrir para o cliente. A cotação continua no histórico. <span class="actions" style="margin-top:8px"><button class="btn danger" data-sim>Sim, excluir</button><button class="btn" data-nao>Manter</button></span></div>` : ""}
  </div>`).join("");
  const doCartao = (b) => aceites.find((a) => a.token === b.closest(".hq").dataset.token);
  box.querySelectorAll("[data-docs]").forEach((b) => (b.onclick = () => escolherDocumentos(doCartao(b))));
  const painel = box.querySelector("[data-escolha]");
  if (painel) {
    const a = doCartao(painel);
    const marcados = () => a.documentos.filter((_, i) => painel.querySelector(`[data-doc="${i}"]`).checked);
    const atualizar = () => {
      escolha.marcados = new Set(marcados());
      painel.querySelector("[data-abrir]").disabled = !escolha.marcados.size;
      painel.querySelector("[data-qtd]").textContent = `${escolha.marcados.size} de ${a.documentos.length} marcados`;
      painel.querySelector("[data-todos]").textContent = escolha.marcados.size === a.documentos.length ? "Desmarcar todos" : "Marcar todos";
    };
    painel.querySelectorAll("[data-doc]").forEach((c) => (c.onchange = atualizar));
    painel.querySelector("[data-todos]").onclick = () => {
      const todos = escolha.marcados.size !== a.documentos.length;
      painel.querySelectorAll("[data-doc]").forEach((c) => (c.checked = todos));
      atualizar();
    };
    painel.querySelector("[data-cancelar]").onclick = () => { escolha = null; renderAceites(); };
    painel.querySelector("[data-abrir]").onclick = () => {
      const docs = marcados();
      escolha = null;
      enviarDocumentos(a, docs);
    };
    atualizar();
  }
  box.querySelectorAll("[data-excluir]").forEach((b) => (b.onclick = () => (b.closest(".hq").querySelector("[data-confirma]").hidden = false)));
  box.querySelectorAll("[data-nao]").forEach((b) => (b.onclick = () => (b.closest("[data-confirma]").hidden = true)));
  box.querySelectorAll("[data-sim]").forEach((b) => (b.onclick = () => excluirAceite(doCartao(b), b)));
}

async function excluirAceite(a, botao) {
  botao.disabled = true;
  try {
    await api(`/api/aceites/${encodeURIComponent(a.token)}`, { metodo: "DELETE" });
    aceites = aceites.filter((x) => x.token !== a.token);
    assinatura = JSON.stringify(aceites);
    renderAceites();
    avisoCentral("Aceite excluído com sucesso");
  } catch (e) {
    botao.disabled = false;
    toast(`Não deu para excluir: ${e.message}`, "erro");
  }
}

// Abre a lista dos documentos do plano, todos marcados, para escolher o que pedir.
function escolherDocumentos(a) {
  if (!a.documentos.length) {
    toast(pode("documentos", "editar") ? `Nenhum documento cadastrado para ${a.plano}: cadastre na tela Documentos` : `Nenhum documento cadastrado para ${a.plano}: peça ao administrador para cadastrar`);
    return;
  }
  if (!a.fone) {
    toast("Este aceite não tem o número do cliente");
    return;
  }
  escolha = escolha?.token === a.token ? null : { token: a.token, marcados: new Set(a.documentos) };
  renderAceites();
}

function painelDeDocumentos(a) {
  return `<div class="ace-docs" data-escolha>
    <div class="ace-docs-topo"><span class="label">Documentos a pedir</span><span class="note" data-qtd></span><button type="button" class="limpar-filtros" data-todos>Desmarcar todos</button></div>
    <div class="ace-docs-lista">${a.documentos.map((d, i) => `<label class="uchk"><input type="checkbox" data-doc="${i}" ${escolha.marcados.has(d) ? "checked" : ""}>${esc(d)}</label>`).join("")}</div>
    <div class="actions"><button class="btn primary" data-abrir>Abrir no WhatsApp</button><button class="btn" data-cancelar>Cancelar</button></div>
  </div>`;
}

async function enviarDocumentos(a, documentos) {
  const texto = mensagemDocumentos({ cliente: a.cliente, plano: a.plano, acomodacao: a.acomodacao, valor: a.valor, documentos, corretor: a.corretor || S.cor });
  window.open(linkConversaDireta(a.fone, texto, navigator.userAgent), "_blank", "noopener");
  renderAceites();
  try {
    await api(`/api/aceites/${encodeURIComponent(a.token)}/documentos`, { metodo: "POST", json: {} });
    await carregarAceites();
  } catch (e) {
    toast(e.message, "erro");
  }
}
