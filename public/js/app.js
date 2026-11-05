// Ponto de entrada: navegação entre as abas, dados do usuário, backup e carga inicial.
import { $, S, VIEWS, api, carregarPlanos, definirRender, pode, render, show, toast } from "./estado.js";
import { iniciarCotacao, renderCotacao, salvarCotacaoPendente } from "./cotacao.js";
import { iniciarPlanos, renderCat } from "./planos.js";
import { carregarHistorico, iniciarHistorico, renderHist } from "./historico.js";
import { carregarAceites, renderAceites } from "./aceites.js";
import { carregarDocumentos, iniciarDocumentos, renderDocumentos } from "./documentos.js";
import { aplicarPerfil, iniciarConfiguracoes } from "./configuracoes.js";
import { iniciarFiltroSelects } from "./filtro-select.js";

iniciarFiltroSelects();

definirRender(() => {
  renderCotacao();
  renderCat();
  renderDocumentos();
});

/* ---------- abas ---------- */
document.querySelectorAll(".tabs button[data-view]").forEach((b) => (b.onclick = () => show(b.dataset.view)));
// Nova cotação recomeça do zero: a página recarrega, sem perder o que ainda estava para salvar.
$("#tab-cot").onclick = async () => {
  if (salvarTimer) {
    clearTimeout(salvarTimer);
    await salvarDados();
  }
  await salvarCotacaoPendente();
  history.replaceState(null, "", "#cotacao");
  location.reload();
};
const viewDoHash = () => (VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "cotacao");
addEventListener("hashchange", () => show(viewDoHash()));
show(viewDoHash());

/* ---------- meus dados ---------- */
let salvarTimer = null;
const salvarDados = () => {
  salvarTimer = null;
  // O e-mail só vai quando está completo, para não dar erro enquanto é digitado.
  const email = $("#c-email").value.trim();
  const json = { ...S.cor, ...(!email || EMAIL_VALIDO.test(email) ? { email } : {}) };
  return api("/api/config", { metodo: "PUT", json }).then(() => ($("#c-email-msg").textContent = "")).catch((e) => toast(`Não deu para salvar os seus dados: ${e.message}`));
};
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
$("#c-email").oninput = () => {
  const email = $("#c-email").value.trim();
  $("#c-email-msg").textContent = email && !EMAIL_VALIDO.test(email) ? "Complete o e-mail para salvar." : "";
  clearTimeout(salvarTimer);
  salvarTimer = setTimeout(salvarDados, 400);
};
const CAMPOS_CONFIG = ["nome", "fone", "empresa"];
for (const k of CAMPOS_CONFIG) {
  const el = $("#c-" + k);
  el.oninput = () => {
    S.cor[k] = el.value;
    render();
    clearTimeout(salvarTimer);
    salvarTimer = setTimeout(salvarDados, 400);
  };
}

/* ---------- restaurar backup ---------- */
let arquivoBackup = null;
const msgBackup = (t) => ($("#b-msg").textContent = t);
document.querySelector('label[for="b-file"]').onkeydown = (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#b-file").click(); }
};
$("#b-file").onchange = () => {
  arquivoBackup = $("#b-file").files[0] || null;
  $("#b-file").value = "";
  if (!arquivoBackup) return;
  $("#b-nome").textContent = arquivoBackup.name;
  $("#b-confirm").hidden = false;
  msgBackup("");
};
$("#b-nao").onclick = () => { arquivoBackup = null; $("#b-confirm").hidden = true; };
$("#b-sim").onclick = async () => {
  const btn = $("#b-sim");
  btn.disabled = true;
  try {
    await api("/api/restaurar", { metodo: "POST", corpo: arquivoBackup, tipo: "application/octet-stream" });
    S.over = {};
    S.selected = [];
    await carregar();
    msgBackup("Backup restaurado. Uma cópia dos dados anteriores ficou na pasta backups.");
  } catch (e) {
    msgBackup(e.message);
  }
  btn.disabled = false;
  arquivoBackup = null;
  $("#b-confirm").hidden = true;
};

/* ---------- links das propostas ---------- */
// O servidor das páginas sobe logo depois do cotador, então a mensagem acompanha o estado dele.
async function verificarLink() {
  try {
    const { linkPublico } = await api("/api/status");
    const ativo = linkPublico.estado === "ativo";
    if (ativo !== S.linkAtivo || linkPublico.local !== S.linkLocal) {
      S.linkAtivo = ativo;
      S.linkLocal = linkPublico.local;
      render();
    }
  } catch {
    // O cotador pode estar sendo fechado; a próxima verificação tenta de novo.
  }
}

/* ---------- carga inicial ---------- */
async function carregar() {
  try {
    // As permissões vêm primeiro: elas decidem o que mais pode ser carregado.
    const eu = await api("/api/eu");
    S.eu = eu;
    aplicarPerfil(eu);
    show(viewDoHash());
    const precisaDosPlanos = ["cotacao", "planos", "documentos"].some((t) => pode(t));
    const [status] = await Promise.all([api("/api/status"), precisaDosPlanos ? carregarPlanos() : null]);
    S.leituraDisponivel = status.leituraDisponivel;
    S.linkAtivo = status.linkPublico.estado === "ativo";
    S.linkLocal = status.linkPublico.local;
    S.cor = { nome: eu.nome ?? "", fone: eu.fone ?? "", empresa: eu.empresa ?? "" };
    for (const k of CAMPOS_CONFIG) $("#c-" + k).value = S.cor[k];
    $("#c-email").value = eu.email ?? "";
  } catch (e) {
    S.dbErr = e.message;
  }
  render();
  await carregarHistorico();
  if (pode("documentos")) await carregarDocumentos().catch((e) => toast(e.message));
  await verificarAceites();
}

// O aceite chega do link, fora desta tela, então a lista é conferida de tempos em tempos.
async function verificarAceites() {
  if (!pode("aceites")) return;
  try {
    await carregarAceites();
  } catch {
    // O cotador pode estar sendo fechado; a próxima verificação tenta de novo.
  }
}

iniciarCotacao();
iniciarPlanos();
iniciarHistorico();
iniciarDocumentos();
iniciarConfiguracoes();
renderHist();
renderAceites();
render();
carregar();
setInterval(() => { verificarLink(); verificarAceites(); }, 5000);
