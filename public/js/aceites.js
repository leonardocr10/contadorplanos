// Tela "Aceites": clientes que aceitaram a proposta pelo link, o pedido dos documentos e o que o cliente já enviou.
import { brl, fmtFone } from "./calculo.js";
import { $, S, api, avisoCentral, esc, pode, toast } from "./estado.js";
import { copiarTexto } from "./cotacao.js";
import { linkConversaDireta, mensagemDocumentos } from "./mensagem.js";

let aceites = [], assinatura = null;
// Escolha de documentos em andamento: sobrevive às atualizações automáticas da lista.
let escolha = null;
// Aceite com a lista de documentos recebidos aberta.
let recebidosAbertos = null;
const fmtData = (iso) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export async function carregarAceites() {
  const lista = await api("/api/aceites");
  const nova = JSON.stringify(lista);
  if (nova === assinatura) return;
  const novos = assinatura === null ? 0 : lista.length - aceites.length;
  // Cliente que acabou de concluir o envio dos documentos.
  const concluiram = assinatura === null ? [] : lista.filter((a) => a.docsConcluidoEm && aceites.some((x) => x.token === a.token && x.docsConcluidoEm !== a.docsConcluidoEm));
  assinatura = nova;
  aceites = lista;
  renderAceites();
  for (const a of concluiram) toast(`${a.cliente || "Um cliente"} concluiu o envio dos documentos`, "sucesso");
  if (novos > 0) toast(novos === 1 ? "Novo aceite de proposta" : `${novos} novos aceites de proposta`, "sucesso");
}

export function renderAceites() {
  const pendentes = aceites.filter((a) => situacao(a).pendente).length;
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
    <div class="hq-top"><span class="hg-name">${esc(a.cliente || "Sem nome")}</span><span class="pill ${situacao(a).pendente ? "st-neg" : "st-ok"}">${situacao(a).rotulo}</span></div>
    <div class="hq-date">${a.fone ? esc(fmtFone(a.fone)) : "Sem número"} · aceitou em ${esc(fmtData(a.aceitoEm))}${a.responsavel ? ` · Corretor: ${esc(a.responsavel)}` : ""}</div>
    <div class="hq-plans"><b>${esc(a.plano)}</b> · ${esc(a.acomodacao)} · R$ ${brl(a.valor)} · ${a.categoria === "CNPJ" ? "CNPJ" : "PF"}</div>
    ${a.docsEnviadosEm ? `<div class="note">Conversa aberta com a lista em ${esc(fmtData(a.docsEnviadosEm))}</div>` : ""}
    ${a.arquivos.length || a.docsConcluidoEm ? `<div class="note">${esc(resumoDosRecebidos(a))}</div>` : ""}
    ${a.contatoCliente ? contatoDoCliente(a.contatoCliente) : ""}
    <div class="actions">
      ${pode("aceites", "editar") ? `<button class="btn ${situacao(a).pendente ? "primary" : ""}" data-docs="1">${a.docsEnviadosEm ? "Pedir de novo no WhatsApp" : "Pedir documentos no WhatsApp"}</button>` : ""}
      <button class="btn ${a.docsConcluidoEm ? "primary" : ""}" data-recebidos aria-expanded="${recebidosAbertos === a.token}">Documentos do cliente${a.arquivos.length ? ` <span class="ctr-qtd">${a.arquivos.length}</span>` : ""}</button>
      ${a.linkDocumentos ? `<button class="btn" data-link title="Link em que o cliente envia os documentos, entrando com o telefone">Copiar link de envio</button>` : ""}
      ${pode("aceites", "editar") ? `<button class="btn danger" data-excluir="1">Excluir</button>` : ""}
    </div>
    ${recebidosAbertos === a.token ? painelDeRecebidos(a) : ""}
    ${pode("aceites", "editar") ? `${escolha?.token === a.token ? painelDeDocumentos(a) : ""}
    <div class="status" data-confirma hidden>Excluir o aceite de <b>${esc(a.cliente || "Sem nome")}</b>${a.arquivos.length ? ` e ${a.arquivos.length === 1 ? "o documento que o cliente enviou" : `os ${a.arquivos.length} documentos que o cliente enviou`}` : ""}? O link desta proposta deixa de abrir para o cliente. A cotação continua no histórico. <span class="actions" style="margin-top:8px"><button class="btn danger" data-sim>Sim, excluir</button><button class="btn" data-nao>Manter</button></span></div>` : ""}
  </div>`).join("");
  const doCartao = (b) => aceites.find((a) => a.token === b.closest(".hq").dataset.token);
  box.querySelectorAll("[data-docs]").forEach((b) => (b.onclick = () => escolherDocumentos(doCartao(b))));
  box.querySelectorAll("[data-recebidos]").forEach((b) => (b.onclick = () => {
    const a = doCartao(b);
    recebidosAbertos = recebidosAbertos === a.token ? null : a.token;
    renderAceites();
  }));
  box.querySelectorAll("[data-link]").forEach((b) => (b.onclick = async () => {
    const a = doCartao(b);
    if (await copiarTexto(a.linkDocumentos)) toast("Link de envio copiado: o cliente entra com o telefone dele", "sucesso");
    else toast(`O navegador bloqueou a cópia. O link é: ${a.linkDocumentos}`, "erro");
  }));
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

// O que mostrar no selo: o que o cliente já fez vale mais do que o pedido do corretor.
function situacao(a) {
  if (a.docsConcluidoEm) return { rotulo: "DOCUMENTOS RECEBIDOS", pendente: false };
  if (a.arquivos.length) return { rotulo: "RECEBENDO DOCUMENTOS", pendente: false };
  if (a.docsEnviadosEm) return { rotulo: "LISTA ABERTA NO WHATSAPP", pendente: false };
  return { rotulo: "PEDIR DOCUMENTOS", pendente: true };
}

// Nome, telefone e e-mail que o cliente informou ao concluir o envio dos documentos.
function contatoDoCliente({ nome, fone, email }) {
  return `<div class="ace-contato"><span class="label">Contato do cliente</span><span>${esc(nome)}</span>${fone ? `<span>${esc(fmtFone(fone))}</span>` : ""}<a href="mailto:${encodeURIComponent(email).replace(/%40/g, "@")}">${esc(email)}</a></div>`;
}

const enviadosDaLista = (a) => a.documentos.filter((d) => a.arquivos.some((x) => x.documento === d)).length;

function resumoDosRecebidos(a) {
  const partes = [a.documentos.length ? `Cliente enviou ${enviadosDaLista(a)} de ${a.documentos.length} documentos` : `Cliente enviou ${a.arquivos.length} ${a.arquivos.length === 1 ? "arquivo" : "arquivos"}`];
  if (a.docsConcluidoEm) partes.push(`concluiu o envio em ${fmtData(a.docsConcluidoEm)}`);
  else partes.push("ainda não concluiu");
  return partes.join(" · ");
}

const tamanhoDoArquivo = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const urlDoArquivo = (a, x, baixar) => `/api/aceites/${encodeURIComponent(a.token)}/arquivos/${encodeURIComponent(x.id)}${baixar ? "?baixar=1" : ""}`;

// Documentos que o cliente enviou pelo link, agrupados pelo documento do plano a que pertencem.
function painelDeRecebidos(a) {
  const grupo = (nome, arquivos, falta) => `<div class="ace-rec-doc">
    <div class="ace-rec-nome"><span>${esc(nome)}</span>${arquivos.length ? "" : `<span class="pill st-neg">${falta}</span>`}</div>
    ${arquivos.map((x) => `<div class="ace-rec-arq"><a href="${esc(urlDoArquivo(a, x))}" target="_blank" rel="noopener" title="Abrir em outra aba">${esc(x.nome)}</a><span class="note">${tamanhoDoArquivo(x.tamanho)} · ${esc(fmtData(x.criadoEm))}</span><a class="btn" href="${esc(urlDoArquivo(a, x, true))}" download>Baixar</a></div>`).join("")}
  </div>`;
  const fora = a.arquivos.filter((x) => !a.documentos.includes(x.documento));
  return `<div class="ace-docs">
    <div class="ace-docs-topo"><span class="label">Documentos enviados pelo cliente</span><span class="note">${esc(a.arquivos.length ? resumoDosRecebidos(a) : "O cliente ainda não enviou nenhum arquivo.")}</span></div>
    ${a.documentos.map((d) => grupo(d, a.arquivos.filter((x) => x.documento === d), "FALTA")).join("")}
    ${fora.length ? grupo("Outros documentos", fora, "") : ""}
    ${a.linkDocumentos ? `<div class="note">O cliente envia por este link, entrando com o telefone${a.fone ? ` ${esc(fmtFone(a.fone))}` : ""}: <span style="overflow-wrap:anywhere">${esc(a.linkDocumentos)}</span></div>` : ""}
  </div>`;
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
  const texto = mensagemDocumentos({ cliente: a.cliente, plano: a.plano, acomodacao: a.acomodacao, valor: a.valor, documentos, link: a.linkDocumentos, corretor: a.corretor || S.cor });
  window.open(linkConversaDireta(a.fone, texto, navigator.userAgent), "_blank", "noopener");
  renderAceites();
  try {
    await api(`/api/aceites/${encodeURIComponent(a.token)}/documentos`, { metodo: "POST", json: {} });
    await carregarAceites();
  } catch (e) {
    toast(e.message, "erro");
  }
}
