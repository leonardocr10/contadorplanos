// Ponto de entrada: navegação entre as abas, "Meus dados", backup e carga inicial.
import { $, S, VIEWS, api, carregarPlanos, definirRender, render, show, toast } from "./estado.js";
import { iniciarCotacao, renderCotacao } from "./cotacao.js";
import { iniciarPlanos, renderCat } from "./planos.js";
import { carregarHistorico, iniciarHistorico, renderHist } from "./historico.js";

definirRender(() => {
  renderCotacao();
  renderCat();
});

/* ---------- abas ---------- */
document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => show(b.dataset.view)));
const viewDoHash = () => (VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "cotacao");
addEventListener("hashchange", () => show(viewDoHash()));
show(viewDoHash());

/* ---------- meus dados ---------- */
let salvarTimer;
for (const k of ["nome", "fone", "empresa"]) {
  const el = $("#c-" + k);
  el.oninput = () => {
    S.cor[k] = el.value;
    render();
    clearTimeout(salvarTimer);
    salvarTimer = setTimeout(() => api("/api/config", { metodo: "PUT", json: S.cor }).catch(() => toast("Não deu para salvar os seus dados")), 400);
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

/* ---------- link público ---------- */
// O túnel leva alguns segundos para conectar e pode cair, então a mensagem acompanha o estado dele.
async function verificarLink() {
  try {
    const { linkPublico } = await api("/api/status");
    const ativo = linkPublico.estado === "ativo";
    if (ativo !== S.linkAtivo) {
      S.linkAtivo = ativo;
      render();
    }
  } catch {
    // O cotador pode estar sendo fechado; a próxima verificação tenta de novo.
  }
}

/* ---------- carga inicial ---------- */
async function carregar() {
  try {
    const [status, cor] = await Promise.all([api("/api/status"), api("/api/config"), carregarPlanos()]);
    S.leituraDisponivel = status.leituraDisponivel;
    S.linkAtivo = status.linkPublico.estado === "ativo";
    S.cor = cor;
    for (const k of ["nome", "fone", "empresa"]) $("#c-" + k).value = cor[k] ?? "";
  } catch (e) {
    S.dbErr = e.message;
  }
  render();
  await carregarHistorico();
}

iniciarCotacao();
iniciarPlanos();
iniciarHistorico();
renderHist();
render();
carregar();
setInterval(verificarLink, 5000);
