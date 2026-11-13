// Tela "Aceites": clientes que aceitaram a proposta pelo link, o pedido dos documentos e o que o cliente já enviou.
import { brl, fmtFone } from "./calculo.js";
import { $, S, api, avisoCentral, esc, pode, toast } from "./estado.js";
import { copiarTexto } from "./cotacao.js";
import { ehPdf, esquecerArquivo, fmtTamanho, miniaturaPronta, mostrarMiniaturas } from "./contratos.js";
import { linkConversaDireta, mensagemDocumentos, mensagemPropostaEnviada } from "./mensagem.js";

let aceites = [], assinatura = null;
// Escolha de documentos em andamento: sobrevive às atualizações automáticas da lista.
let escolha = null;
// Mensagem "Proposta enviada" aberta para edição: o texto sobrevive às atualizações automáticas da lista.
let aviso = null;
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
  // Uma linha fina por aceite, nas mesmas colunas dos Contratos Vendidos; os detalhes ficam nas dicas e no painel.
  box.innerHTML = aceites.map((a) => {
    const st = situacao(a), tipo = a.categoria === "CNPJ" ? "CNPJ" : "PF";
    const dicaSituacao = [a.arquivos.length || a.docsConcluidoEm ? resumoDosRecebidos(a) : "", a.docsEnviadosEm ? `Lista aberta no WhatsApp em ${fmtData(a.docsEnviadosEm)}` : "", a.propostaEnviadaEm ? `Aviso da proposta enviado em ${fmtData(a.propostaEnviadaEm)}` : ""].filter(Boolean).join(" · ");
    return `<div class="hq ctr-item${st.pendente ? " ctr-pendente" : ""}" data-token="${esc(a.token)}">
    <div class="ctr-linha">
      <b class="ctr-nome" title="${esc([a.cliente || "Sem nome", a.responsavel ? `Corretor: ${a.responsavel}` : ""].filter(Boolean).join(" · "))}">${esc(a.cliente || "Sem nome")}</b>
      <span class="ctr-fone">${a.fone ? esc(fmtFone(a.fone)) : "Sem número"}</span>
      <span class="ctr-plano" title="${esc(`${a.plano} · ${a.acomodacao} · ${tipo}`)}">${esc(a.plano)} <span class="ctr-sub">· ${esc(a.acomodacao)} · ${tipo}</span></span>
      <span class="ctr-valor">R$ ${brl(a.valor)}</span>
      <span class="ctr-ativ" title="Aceitou em ${esc(fmtData(a.aceitoEm))}">${esc(new Date(a.aceitoEm).toLocaleDateString("pt-BR"))}</span>
      <span class="ctr-sit"><span class="pill ${st.pendente ? "st-neg" : "st-ok"}"${dicaSituacao ? ` title="${esc(dicaSituacao)}"` : ""}>${st.rotulo}</span></span>
      <div class="actions ctr-acoes">
        ${pode("aceites", "editar") ? `<button class="btn ${st.pendente ? "primary" : ""}" data-docs="1" title="${a.docsEnviadosEm ? "Pedir de novo os documentos no WhatsApp" : "Pedir os documentos no WhatsApp"}">WhatsApp</button>` : ""}
        <button class="btn" data-recebidos aria-expanded="${recebidosAbertos === a.token}" title="Documentos enviados pelo cliente">Documentos${a.arquivos.length ? ` <span class="ctr-qtd">${a.arquivos.length}</span>` : ""}</button>
        ${pode("aceites", "editar") ? `<button class="btn" data-proposta aria-expanded="${aviso?.token === a.token}" title="${a.propostaEnviadaEm ? `Aviso enviado em ${esc(fmtData(a.propostaEnviadaEm))}. Clique para enviar de novo.` : "Avisar no WhatsApp que a proposta para assinar foi enviada ao e-mail"}">Proposta enviada${a.propostaEnviadaEm ? " ✓" : ""}</button>` : ""}
        ${a.linkDocumentos ? `<button class="btn" data-link title="Copiar o link em que o cliente envia os documentos, entrando com o telefone">Copiar link</button>` : ""}
        ${pode("aceites", "editar") ? `<button class="btn danger" data-excluir="1">Excluir</button>` : ""}
      </div>
    </div>
    ${aviso?.token === a.token ? painelDoAviso(a) : ""}
    ${recebidosAbertos === a.token ? painelDeRecebidos(a) : ""}
    ${pode("aceites", "editar") ? `${escolha?.token === a.token ? painelDeDocumentos(a) : ""}
    <div class="status" data-confirma hidden>Excluir o aceite de <b>${esc(a.cliente || "Sem nome")}</b>${a.arquivos.length ? ` e ${a.arquivos.length === 1 ? "o documento que o cliente enviou" : `os ${a.arquivos.length} documentos que o cliente enviou`}` : ""}? O link desta proposta deixa de abrir para o cliente. A cotação continua no histórico. <span class="actions" style="margin-top:8px"><button class="btn danger" data-sim>Sim, excluir</button><button class="btn" data-nao>Manter</button></span></div>` : ""}
  </div>`;
  }).join("");
  const doCartao = (b) => aceites.find((a) => a.token === b.closest(".hq").dataset.token);
  box.querySelectorAll("[data-docs]").forEach((b) => (b.onclick = () => escolherDocumentos(doCartao(b))));
  box.querySelectorAll("[data-proposta]").forEach((b) => (b.onclick = () => {
    const a = doCartao(b);
    if (!a.fone) { toast("Este aceite não tem o número do cliente"); return; }
    aviso = aviso?.token === a.token ? null : { token: a.token, texto: mensagemPropostaEnviada() };
    renderAceites();
    if (aviso) box.querySelector("#ace-aviso-texto")?.focus();
  }));
  const painelAviso = box.querySelector("[data-painel-aviso]");
  if (painelAviso) ligarAviso(painelAviso, doCartao(painelAviso));
  const recebidos = box.querySelector("[data-painel-docs]");
  if (recebidos) ligarRecebidos(recebidos, doCartao(recebidos));
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

// Texto do aviso "Proposta enviada", editável antes de abrir no WhatsApp.
function painelDoAviso(a) {
  return `<div class="ctr-msg" data-painel-aviso>
    <label class="label" for="ace-aviso-texto">Mensagem para ${esc(a.cliente || "o cliente")}: proposta enviada ao e-mail</label>
    <textarea id="ace-aviso-texto" rows="10" spellcheck="true">${esc(aviso.texto)}</textarea>
    <div class="actions">
      <button class="btn primary" data-aviso-abrir>Abrir no WhatsApp</button>
      <button class="btn" data-aviso-copiar>Copiar mensagem</button>
      <button class="btn" data-aviso-original>Voltar ao texto original</button>
      <button class="btn" data-aviso-fechar>Fechar</button>
    </div>
  </div>`;
}

function ligarAviso(painel, a) {
  const campo = painel.querySelector("textarea");
  campo.oninput = () => (aviso.texto = campo.value);
  painel.querySelector("[data-aviso-original]").onclick = () => { aviso.texto = campo.value = mensagemPropostaEnviada(); campo.focus(); };
  painel.querySelector("[data-aviso-fechar]").onclick = () => { aviso = null; renderAceites(); };
  painel.querySelector("[data-aviso-copiar]").onclick = async () => {
    if (await copiarTexto(campo.value)) toast("Mensagem copiada", "sucesso");
    else toast("O navegador bloqueou a cópia: selecione o texto e copie", "erro");
  };
  painel.querySelector("[data-aviso-abrir]").onclick = async () => {
    const texto = campo.value.trim();
    if (!texto) { toast("Escreva a mensagem antes de abrir o WhatsApp"); campo.focus(); return; }
    window.open(linkConversaDireta(a.fone, texto, navigator.userAgent), "_blank", "noopener");
    aviso = null;
    renderAceites();
    try {
      await api(`/api/aceites/${encodeURIComponent(a.token)}/proposta-enviada`, { metodo: "POST", json: {} });
      await carregarAceites();
    } catch (e) {
      toast(e.message, "erro");
    }
  };
}

// O que mostrar no selo: o que o cliente já fez vale mais do que o pedido do corretor.
function situacao(a) {
  if (a.propostaEnviadaEm) return { rotulo: "PROPOSTA ENVIADA", pendente: false };
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

const urlDoArquivo = (a, x, baixar) => `/api/aceites/${encodeURIComponent(a.token)}/arquivos/${encodeURIComponent(x.id)}${baixar ? "?baixar=1" : ""}`;

// Documentos que o cliente enviou pelo link, no mesmo formato dos Contratos Vendidos.
// Cada cartão diz a que documento do plano o arquivo pertence; os que faltam aparecem embaixo.
function painelDeRecebidos(a) {
  const edita = pode("aceites", "editar");
  const mini = (x) => {
    const src = miniaturaPronta(x.id);
    return `<a class="ctr-doc-mini" data-mini="${esc(x.id)}" href="${esc(urlDoArquivo(a, x))}" target="_blank" rel="noopener" title="Abrir ${esc(x.nome)}">${src ? `<img src="${esc(src)}" alt="">` : `<span>${ehPdf(x) ? "PDF" : "IMG"}</span>`}</a>`;
  };
  const linhas = a.arquivos.map((x) => `<li class="ctr-doc-linha" data-arquivo="${esc(x.id)}">
      ${mini(x)}
      <span class="ctr-doc-texto"><a href="${esc(urlDoArquivo(a, x))}" target="_blank" rel="noopener" title="${esc(x.nome)}">${esc(x.nome)}</a><span class="note" title="${esc(x.documento)}">${esc(x.documento)} · ${fmtTamanho(x.tamanho)} · ${esc(new Date(x.criadoEm).toLocaleDateString("pt-BR"))}</span></span>
      <span class="ctr-doc-acoes">
        <a class="limpar-filtros" href="${esc(urlDoArquivo(a, x))}" target="_blank" rel="noopener">Abrir</a>
        <a class="limpar-filtros" href="${esc(urlDoArquivo(a, x, true))}">Baixar</a>
        ${edita ? `<button type="button" class="limpar-filtros" data-tirar>Excluir</button>` : ""}
      </span>
      <span class="doc-confirma ctr-doc-confirma" hidden>Excluir este documento? <button type="button" class="limpar-filtros" data-tirar-sim>Sim</button><button type="button" class="limpar-filtros" data-tirar-nao>Não</button></span>
    </li>`).join("");
  const faltam = a.documentos.filter((d) => !a.arquivos.some((x) => x.documento === d));
  return `<div class="ctr-docs" data-painel-docs>
    <div class="ctr-docs-topo"><span class="label">Documentos do cliente${a.arquivos.length ? ` · ${a.arquivos.length}` : ""}</span><span class="note">${esc(a.arquivos.length || a.docsConcluidoEm ? resumoDosRecebidos(a) : "O cliente ainda não enviou nenhum arquivo.")}</span></div>
    ${a.contatoCliente ? contatoDoCliente(a.contatoCliente) : ""}
    ${linhas ? `<ul class="ctr-docs-lista">${linhas}</ul>` : ""}
    ${a.arquivos.length && faltam.length ? `<p class="note" style="margin:0"><b>Falta:</b> ${esc(faltam.join(", "))}</p>` : ""}
    ${a.linkDocumentos ? `<p class="note" style="margin:0">O cliente envia por este link, entrando com o telefone${a.fone ? ` ${esc(fmtFone(a.fone))}` : ""}: <span style="overflow-wrap:anywhere">${esc(a.linkDocumentos)}</span></p>` : ""}
  </div>`;
}

function ligarRecebidos(painel, a) {
  mostrarMiniaturas(painel, a.arquivos, (x) => urlDoArquivo(a, x));
  painel.querySelectorAll("[data-tirar]").forEach((b) => (b.onclick = () => (b.closest("li").querySelector(".ctr-doc-confirma").hidden = false)));
  painel.querySelectorAll("[data-tirar-nao]").forEach((b) => (b.onclick = () => (b.closest(".ctr-doc-confirma").hidden = true)));
  painel.querySelectorAll("[data-tirar-sim]").forEach((b) => (b.onclick = () => tirarRecebido(a, b.closest("li").dataset.arquivo, b)));
}

async function tirarRecebido(a, id, botao) {
  botao.disabled = true;
  try {
    await api(`/api/aceites/${encodeURIComponent(a.token)}/arquivos/${encodeURIComponent(id)}`, { metodo: "DELETE" });
    a.arquivos = a.arquivos.filter((x) => x.id !== id);
    esquecerArquivo(id);
    renderAceites();
    avisoCentral("Documento excluído com sucesso");
    await carregarAceites();
  } catch (e) {
    botao.disabled = false;
    toast(`Não deu para excluir: ${e.message}`, "erro");
  }
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
