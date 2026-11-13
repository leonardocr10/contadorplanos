// Ponto de entrada: navegação entre as abas, dados do usuário, backup e carga inicial.
import { $, S, VIEWS, abrirGrupoDoMenu, api, avisoCentral, carregarPlanos, definirRender, pode, render, show, toast } from "./estado.js";
import { iniciarCotacao, novaCotacao, renderCotacao } from "./cotacao.js";
import { iniciarPlanos, renderCat } from "./planos.js";
import { carregarHistorico, iniciarHistorico, renderHist } from "./historico.js";
import { carregarAceites, iniciarAceites, renderAceites } from "./aceites.js";
import { carregarDocumentos, iniciarDocumentos, renderDocumentos } from "./documentos.js";
import { atualizarPlanosDoContrato, carregarContratos, conferirDiaDosContratos, iniciarContratos } from "./contratos.js";
import { atualizarPlanosDaRegra, carregarFinanceiro, iniciarFinanceiro } from "./financeiro.js";
import { abrirItem, aplicarPerfil, avatarDoUsuario, carregarUsuarios, iniciarConfiguracoes, mostrarUsuarioLogado } from "./configuracoes.js";
import { iniciarFiltroSelects } from "./filtro-select.js";

iniciarFiltroSelects();

// Telas que usam a lista de planos (a mesma regra do servidor).
const TELAS_COM_PLANOS = ["cotacao", "planos", "documentos", "contratos", "financeiro"];

definirRender(() => {
  renderCotacao();
  renderCat();
  renderDocumentos();
  atualizarPlanosDoContrato();
  atualizarPlanosDaRegra();
});

/* ---------- abas ---------- */
// Financeiro abre e fecha os submenus (Regras de pagamento e Comissões).
$(".tabs-grupo").onclick = (e) => abrirGrupoDoMenu(e.currentTarget.getAttribute("aria-expanded") !== "true");
document.querySelectorAll(".tabs button[data-view]").forEach((b) => (b.onclick = () => {
  show(b.dataset.view);
  if (["regras", "comissoes"].includes(b.dataset.view)) carregarFinanceiro();
}));
// Nova cotação recomeça do zero na hora, sem recarregar a página; planos e histórico se atualizam ao fundo.
$("#tab-cot").onclick = async () => {
  await novaCotacao();
  show("cotacao");
  if (TELAS_COM_PLANOS.some((t) => pode(t))) carregarPlanos().then(render).catch(() => {});
  carregarHistorico();
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
  try {
    const { blob, previa } = await reduzirFoto(arquivo);
    fotoPendente = blob;
    pintarFoto(previa);
  } catch {
    toast("Não deu para ler esta imagem. Use um arquivo JPG, PNG ou WebP.", "erro");
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
  const dados = lerDados();
  if (dados.email && !EMAIL_VALIDO.test(dados.email)) { toast("Confira o e-mail: ele parece incompleto.", "erro"); return; }
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
    avisoCentral("Dados salvos com sucesso");
    // O cadastro de usuários mostra estes mesmos dados.
    if (S.eu.perfil === "admin") carregarUsuarios();
  } catch (erro) {
    toast(`Não deu para salvar: ${erro.message}`, "erro");
  }
  $("#dados-salvar").disabled = false;
};

/* ---------- fazer backup ---------- */
// O backup junta o banco (com os documentos dos contratos) e as imagens num arquivo só, o que pode levar
// alguns minutos: o botão mostra o andamento e a mensagem avisa quando o arquivo foi baixado.
function andamentoDoBackup(texto) {
  $("#b-andamento").hidden = !texto;
  $("#b-andamento-texto").textContent = texto || "";
}
$("#b-fazer").onclick = async () => {
  const botao = $("#b-fazer");
  botao.disabled = true;
  botao.textContent = "Gerando backup…";
  andamentoDoBackup("Gerando o backup com os planos, o histórico, os contratos e os documentos dos clientes. Pode levar alguns minutos: não feche esta tela.");
  const inicio = Date.now();
  try {
    const r = await fetch("/api/backup");
    if (r.status === 401) { location.href = "/login"; return; }
    if (!r.ok) throw new Error((await r.json().catch(() => null))?.erro || "O cotador não conseguiu gerar o backup.");
    andamentoDoBackup("Baixando o arquivo do backup…");
    const arquivo = await r.blob();
    const nome = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") || "")?.[1] || "cotador-backup.db";
    const link = document.createElement("a");
    link.href = URL.createObjectURL(arquivo);
    link.download = nome;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    const segundos = Math.round((Date.now() - inicio) / 1000);
    avisoCentral(`Backup feito com sucesso (${(arquivo.size / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB${segundos > 1 ? `, em ${segundos} s` : ""}). Guarde o arquivo em local seguro.`);
  } catch (e) {
    toast(e.message === "Failed to fetch" ? "Não consegui falar com o cotador. Verifique se a janela dele está aberta." : `Não deu para fazer o backup: ${e.message}`, "erro");
  }
  andamentoDoBackup("");
  botao.disabled = false;
  botao.textContent = "Fazer backup";
};

/* ---------- restaurar backup ---------- */
let arquivoBackup = null;
document.querySelector('label[for="b-file"]').onkeydown = (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#b-file").click(); }
};
$("#b-file").onchange = () => {
  arquivoBackup = $("#b-file").files[0] || null;
  $("#b-file").value = "";
  if (!arquivoBackup) return;
  $("#b-nome").textContent = arquivoBackup.name;
  $("#b-confirm").hidden = false;
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
    avisoCentral("Backup restaurado com sucesso. Uma cópia dos dados anteriores ficou na pasta backups.");
  } catch (e) {
    toast(e.message, "erro");
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
    return true;
  } catch {
    // O cotador pode estar sendo fechado; a próxima verificação tenta de novo.
    return false;
  }
}

/* ---------- carga inicial ---------- */
// Os pedidos saem juntos, em vez de um depois do outro: com o servidor longe, cada espera conta.
async function carregar() {
  let extras = null;
  try {
    // Status e planos já vão junto com as permissões; quem não pode ver os planos só ignora a resposta.
    const statusP = api("/api/status");
    const planosP = carregarPlanos().then(() => null, (e) => e);
    const eu = await api("/api/eu");
    S.eu = eu;
    aplicarPerfil(eu);
    show(viewDoHash());
    extras = Promise.all([
      carregarHistorico(),
      pode("documentos") ? carregarDocumentos().catch((e) => toast(e.message, "erro")) : null,
      verificarAceites(),
      carregarContratos(),
      carregarFinanceiro(),
    ]);
    const precisaDosPlanos = TELAS_COM_PLANOS.some((t) => pode(t));
    const [status, erroPlanos] = await Promise.all([statusP, planosP]);
    if (erroPlanos && precisaDosPlanos) throw erroPlanos;
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
  await extras;
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
iniciarContratos();
iniciarFinanceiro();
renderHist();
iniciarAceites();
renderAceites();
render();
carregar();
// Link e aceites são conferidos a cada 5 s com a aba à vista. Escondida, a aba não consulta o servidor; fora do ar,
// o servidor é consultado cada vez mais devagar (até 40 s), em vez de encher o console de erros.
let falhas = 0;
async function conferir() {
  conferirDiaDosContratos();
  if (!document.hidden) {
    const ok = await verificarLink();
    if (ok) await verificarAceites();
    falhas = ok ? 0 : falhas + 1;
  }
  setTimeout(conferir, 5000 * 2 ** Math.min(falhas, 3));
}
setTimeout(conferir, 5000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { verificarLink(); verificarAceites(); }
});
