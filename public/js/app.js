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
  await salvarCotacaoPendente();
  history.replaceState(null, "", "#cotacao");
  location.reload();
};
const viewDoHash = () => (VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "cotacao");
addEventListener("hashchange", () => show(viewDoHash()));
show(viewDoHash());

/* ---------- meus dados ---------- */
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CAMPOS_CONFIG = ["nome", "fone", "empresa"];
const lerDados = () => ({
  ...Object.fromEntries(CAMPOS_CONFIG.map((k) => [k, $("#c-" + k).value])),
  email: $("#c-email").value.trim().toLowerCase(),
});
const dadosAlterados = () => {
  const d = lerDados();
  return CAMPOS_CONFIG.some((k) => d[k] !== (S.cor?.[k] ?? "")) || d.email !== (S.eu?.email ?? "");
};
const atualizarBotaoDados = () => ($("#dados-salvar").disabled = !dadosAlterados());
for (const k of [...CAMPOS_CONFIG, "email"]) $("#c-" + k).addEventListener("input", atualizarBotaoDados);
// Nova cotação recarrega a página: avisa antes de perder o que não foi salvo.
addEventListener("beforeunload", (e) => { if (S.eu && dadosAlterados()) e.preventDefault(); });
$("#dados-form").onsubmit = async (e) => {
  e.preventDefault();
  const dados = lerDados(), msg = $("#dados-msg");
  msg.textContent = "";
  if (dados.email && !EMAIL_VALIDO.test(dados.email)) { msg.textContent = "Confira o e-mail: ele parece incompleto."; return; }
  $("#dados-salvar").disabled = true;
  try {
    await api("/api/config", { metodo: "PUT", json: dados });
    const { email, ...cor } = dados;
    S.cor = cor;
    S.eu.email = email;
    $("#c-email").value = email;
    render();
    toast("Dados salvos");
  } catch (erro) {
    msg.textContent = `Não deu para salvar: ${erro.message}`;
  }
  atualizarBotaoDados();
};

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
    atualizarBotaoDados();
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
