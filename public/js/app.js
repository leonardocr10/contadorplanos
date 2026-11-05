// Ponto de entrada: navegação entre as abas, dados do usuário, backup e carga inicial.
import { $, S, VIEWS, api, carregarPlanos, definirRender, pode, render, show, toast } from "./estado.js";
import { iniciarCotacao, renderCotacao, salvarCotacaoPendente } from "./cotacao.js";
import { iniciarPlanos, renderCat } from "./planos.js";
import { carregarHistorico, iniciarHistorico, renderHist } from "./historico.js";
import { carregarAceites, renderAceites } from "./aceites.js";
import { carregarDocumentos, iniciarDocumentos, renderDocumentos } from "./documentos.js";
import { abrirItem, aplicarPerfil, avatarDoUsuario, carregarUsuarios, iniciarConfiguracoes, mostrarUsuarioLogado } from "./configuracoes.js";
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
  return fotoPendente !== undefined || CAMPOS_CONFIG.some((k) => d[k] !== (S.cor?.[k] ?? "")) || d.email !== (S.eu?.email ?? "");
};

/* A foto escolhida só é enviada ao salvar: undefined = sem mudança, null = remover. */
let fotoPendente;
const LADO_DA_FOTO = 256;
async function reduzirFoto(arquivo) {
  const imagem = await createImageBitmap(arquivo);
  const lado = Math.min(imagem.width, imagem.height);
  const tela = document.createElement("canvas");
  tela.width = tela.height = LADO_DA_FOTO;
  tela.getContext("2d").drawImage(imagem, (imagem.width - lado) / 2, (imagem.height - lado) / 2, lado, lado, 0, 0, LADO_DA_FOTO, LADO_DA_FOTO);
  imagem.close();
  const blob = await new Promise((ok) => tela.toBlob(ok, "image/jpeg", 0.85));
  return { blob, previa: tela.toDataURL("image/jpeg", 0.85) };
}
function pintarFoto(src) {
  const nome = $("#c-nome").value || S.eu?.login;
  $("#foto-previa").innerHTML = avatarDoUsuario({ foto: src, nome, login: S.eu?.login });
  $("#foto-remover").hidden = !src;
  $("#foto-dica").textContent = fotoPendente !== undefined
    ? "Clique em Salvar alterações para aplicar."
    : "JPG, PNG ou WebP. A foto aparece no menu ao lado do seu nome.";
}
$("#foto-escolher").onclick = () => $("#foto-arquivo").click();
$("#foto-arquivo").onchange = async () => {
  const arquivo = $("#foto-arquivo").files[0];
  $("#foto-arquivo").value = "";
  if (!arquivo) return;
  $("#dados-msg").textContent = "";
  try {
    const { blob, previa } = await reduzirFoto(arquivo);
    fotoPendente = blob;
    pintarFoto(previa);
  } catch {
    $("#dados-msg").textContent = "Não deu para ler esta imagem. Use um arquivo JPG, PNG ou WebP.";
  }
};
$("#foto-remover").onclick = () => {
  fotoPendente = S.eu?.foto ? null : undefined;
  pintarFoto("");
};
$("#usuario-logado").onclick = () => { show("configuracoes"); abrirItem("dados"); };
async function salvarFoto() {
  if (fotoPendente === undefined) return;
  if (fotoPendente) S.eu.foto = (await api("/api/eu/foto", { metodo: "POST", corpo: fotoPendente, tipo: "image/jpeg" })).foto;
  else {
    await api("/api/eu/foto", { metodo: "DELETE" });
    S.eu.foto = "";
  }
  fotoPendente = undefined;
}
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
    S.eu.nome = cor.nome;
    $("#c-email").value = email;
    await salvarFoto();
    pintarFoto(S.eu.foto);
    mostrarUsuarioLogado(S.eu);
    render();
    toast("Dados salvos");
    // O cadastro de usuários mostra estes mesmos dados.
    if (S.eu.perfil === "admin") carregarUsuarios();
  } catch (erro) {
    msg.textContent = `Não deu para salvar: ${erro.message}`;
  }
  $("#dados-salvar").disabled = false;
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
    pintarFoto(eu.foto);
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
