// Tela "Aceites": clientes que aceitaram a proposta pelo link e o envio da lista de documentos.
import { brl, fmtFone } from "./calculo.js";
import { $, S, api, esc, toast } from "./estado.js";
import { linkWhatsApp, mensagemDocumentos } from "./mensagem.js";

let aceites = [], assinatura = null;
const fmtData = (iso) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export async function carregarAceites() {
  const lista = await api("/api/aceites");
  const nova = JSON.stringify(lista);
  if (nova === assinatura) return;
  const novos = assinatura === null ? 0 : lista.length - aceites.length;
  assinatura = nova;
  aceites = lista;
  renderAceites();
  if (novos > 0) toast(novos === 1 ? "Novo aceite de proposta" : `${novos} novos aceites de proposta`);
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
    <div class="hq-date">${a.fone ? esc(fmtFone(a.fone)) : "Sem número"} · aceitou em ${esc(fmtData(a.aceitoEm))}</div>
    <div class="hq-plans"><b>${esc(a.plano)}</b> · ${esc(a.acomodacao)} · R$ ${brl(a.valor)} · ${a.categoria === "CNPJ" ? "CNPJ" : "PF"}</div>
    ${a.docsEnviadosEm ? `<div class="note">Conversa aberta com a lista em ${esc(fmtData(a.docsEnviadosEm))}</div>` : ""}
    <div class="actions"><button class="btn ${a.docsEnviadosEm ? "" : "primary"}" data-docs="1">${a.docsEnviadosEm ? "Enviar de novo" : "Enviar documentos no WhatsApp"}</button></div>
  </div>`).join("");
  box.querySelectorAll("[data-docs]").forEach((b) => (b.onclick = () => enviarDocumentos(aceites.find((a) => a.token === b.closest(".hq").dataset.token))));
}

async function enviarDocumentos(a) {
  if (!a.documentos.length) {
    toast(`Nenhum documento ativo para ${a.plano}: ative na aba Documentos`);
    return;
  }
  if (!a.fone) {
    toast("Este aceite não tem o número do cliente");
    return;
  }
  const texto = mensagemDocumentos({ cliente: a.cliente, plano: a.plano, acomodacao: a.acomodacao, valor: a.valor, documentos: a.documentos, corretor: S.cor });
  window.open(linkWhatsApp(a.fone, texto), "_blank", "noopener");
  try {
    await api(`/api/aceites/${encodeURIComponent(a.token)}/documentos`, { metodo: "POST", json: {} });
    await carregarAceites();
  } catch (e) {
    toast(e.message);
  }
}
