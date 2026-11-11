// Aba "Configurações": senha de cada login e, para o administrador, usuários e atualização do sistema.
import { $, api, avisoCentral, esc, pode, toast } from "./estado.js";

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const msg = (t) => ($("#cfg-msg").textContent = t);
const msgUsuarios = (t) => toast(t, "erro");
const PERFIS = { admin: "Administrador", usuario: "Usuário" };
const TELAS = { cotacao: "Nova cotação", planos: "Planos e valores", documentos: "Documentos", historico: "Histórico", aceites: "Aceites", contratos: "Contratos vendidos" };
const NIVEIS = { nenhum: "Sem acesso", ver: "Ver", editar: "Editar" };
const NOMES_NIVEIS = { nenhum: "sem acesso", ver: "visualização", editar: "edição" };
const PADRAO = { cotacao: "editar", planos: "ver", documentos: "ver", historico: "editar", aceites: "editar", contratos: "editar" };

let eu = null, usuarios = [], editando = null;

const camposDePermissao = (atuais) => Object.entries(TELAS).map(([tela, nome]) => `<div class="usr-tela"><span>${nome}</span><div class="usr-niveis" role="radiogroup" aria-label="Acesso a ${nome}">${Object.entries(NIVEIS).map(([n, rotulo]) => `<label><input type="radio" name="perm-${tela}" value="${n}" ${atuais[tela] === n ? "checked" : ""}><span>${rotulo}</span></label>`).join("")}</div></div>`).join("");
const lerPermissoes = () => Object.fromEntries([...$("#usr-permissoes").querySelectorAll("input:checked")].map((r) => [r.name.slice(5), r.value]));
const perfilEscolhido = () => document.querySelector('[name="usr-perfil"]:checked').value;
const nivelNaTela = (u, tela) => (u.perfil === "admin" ? "editar" : u.permissoes?.[tela] ?? "nenhum");
const chipsDeAcesso = (u) => Object.entries(TELAS).map(([tela, nome]) => {
  const nivel = nivelNaTela(u, tela);
  return `<span class="chip-tela ${nivel}">${nome}<span class="so-leitor">: ${NOMES_NIVEIS[nivel]}</span></span>`;
}).join("");

// Foto do usuário ou, sem foto, a inicial do nome.
export const avatarDoUsuario = (u) => (u.foto
  ? `<img src="${esc(u.foto)}" alt="">`
  : esc((u.nome || u.login || "?").trim().charAt(0).toUpperCase()));

export function mostrarUsuarioLogado(u) {
  const box = $("#usuario-logado");
  box.hidden = !u.id;
  if (!u.id) return;
  box.innerHTML = `<span class="usr-avatar">${avatarDoUsuario(u)}</span><span class="usuario-logado-texto"><b>${esc(u.nome || u.login)}</b><small>${PERFIS[u.perfil]}</small></span>`;
}

async function mostrarVersao() {
  try {
    const { commit, data } = await api("/api/sistema/versao");
    $("#cfg-versao").textContent = `Versão instalada: ${commit}, de ${new Date(data).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`;
  } catch (e) {
    $("#cfg-versao").textContent = e.message;
  }
}

// Durante o reinício a conexão falha. Qualquer resposta indica que o cotador voltou.
async function esperarVoltar() {
  await espera(3000);
  for (let i = 0; i < 100; i++) {
    try {
      await fetch("/api/status", { cache: "no-store" });
      location.reload();
      return true;
    } catch {
      await espera(3000);
    }
  }
  return false;
}

/* ---------- usuários ---------- */
export async function carregarUsuarios() {
  try {
    usuarios = await api("/api/usuarios");
    renderUsuarios();
  } catch (e) {
    msgUsuarios(e.message);
  }
}

function renderUsuarios() {
  $("#usr-total").textContent = `· ${usuarios.length}`;
  const box = $("#usr-lista");
  box.innerHTML = usuarios.map((u) => {
    const proprio = u.id === eu?.id;
    const detalhes = [u.nome, u.email || "Sem e-mail"].filter(Boolean).join(" · ");
    return `<tr data-id="${esc(u.id)}" class="${u.ativo ? "" : "usr-inativo"}">
      <td><div class="usr-quem"><span class="usr-avatar" aria-hidden="true">${u.foto ? avatarDoUsuario(u) : esc(u.login.charAt(0).toUpperCase())}</span><div><b>${esc(u.login)}</b>${proprio ? " <span class=\"usr-voce\">(você)</span>" : ""}<small>${esc(detalhes)}</small></div></div></td>
      <td><span class="usr-selo ${u.perfil}">${PERFIS[u.perfil]}</span>${u.ativo ? "" : '<span class="usr-selo desativado">Desativado</span>'}</td>
      <td><div class="usr-chips">${chipsDeAcesso(u)}</div></td>
      <td><div class="usr-acoes">
        <button class="btn" type="button" data-editar>Editar</button>
        ${proprio ? "" : `<button class="btn" type="button" data-ativo title="${u.ativo ? "Bloqueia o login; cotações, contratos e documentos do usuário ficam guardados" : "Libera o login de novo"}">${u.ativo ? "Desativar" : "Ativar"}</button>`}
      </div></td>
    </tr>`;
  }).join("");
  box.querySelectorAll("tr[data-id]").forEach((linha) => {
    const u = usuarios.find((x) => x.id === linha.dataset.id);
    linha.querySelector("[data-editar]").onclick = () => abrirGaveta(u);
    if (!linha.querySelector("[data-ativo]")) return;
    linha.querySelector("[data-ativo]").onclick = async () => {
      try {
        await api(`/api/usuarios/${encodeURIComponent(u.id)}`, { metodo: "PUT", json: { ativo: !u.ativo } });
        avisoCentral(u.ativo ? "Usuário desativado com sucesso" : "Usuário ativado com sucesso");
        await carregarUsuarios();
      } catch (e) {
        msgUsuarios(e.message);
      }
    };
  });
}

/* ---------- janela lateral de novo usuário e de edição ---------- */
function abrirGaveta(u = null) {
  editando = u;
  const proprio = u?.id === eu?.id;
  $("#usr-form").reset();
  $("#usr-titulo").textContent = u ? "Editar usuário" : "Novo usuário";
  $("#usr-salvar").textContent = u ? "Salvar alterações" : "Criar usuário";
  $("#usr-login").value = u?.login ?? "";
  $("#usr-login").disabled = !!u;
  $("#usr-email").value = u?.email ?? "";
  // Quem foi criado antes do e-mail existir continua editável sem ele.
  $("#usr-email").required = !u;
  $("#usr-senha").required = !u;
  $("#usr-senha-rotulo").textContent = u ? "Nova senha" : "Senha inicial";
  $("#usr-senha-dica").textContent = u ? "deixe em branco para manter a atual" : "mínimo de 8 caracteres";
  document.querySelectorAll('[name="usr-perfil"]').forEach((r) => {
    r.checked = r.value === (u?.perfil ?? "usuario");
    r.disabled = proprio;
  });
  $("#usr-perfil-proprio").hidden = !proprio;
  $("#usr-permissoes").innerHTML = camposDePermissao(u && u.perfil !== "admin" ? u.permissoes : PADRAO);
  mostrarAcesso();
  $("#usr-gaveta").showModal();
}

// O administrador tem acesso a tudo, então não há o que escolher.
const mostrarAcesso = () => ($("#usr-acesso").hidden = perfilEscolhido() === "admin");

async function salvarGaveta(e) {
  e.preventDefault();
  const perfil = perfilEscolhido(), email = $("#usr-email").value.trim(), senha = $("#usr-senha").value;
  const permissoes = perfil === "admin" ? {} : { permissoes: lerPermissoes() };
  // Resposta imediata na tela enquanto o servidor grava.
  const botao = $("#usr-salvar"), rotulo = botao.textContent;
  botao.disabled = true;
  botao.textContent = "Salvando…";
  try {
    let salvo;
    if (editando) {
      salvo = await api(`/api/usuarios/${encodeURIComponent(editando.id)}`, { metodo: "PUT", json: {
        ...permissoes,
        ...(perfil !== editando.perfil ? { perfil } : {}),
        ...(email !== editando.email ? { email } : {}),
        ...(senha ? { senha } : {}),
      } });
      if (editando.id === eu?.id) { eu.email = email.toLowerCase(); $("#c-email").value = eu.email; }
    } else {
      salvo = await api("/api/usuarios", { metodo: "POST", json: { login: $("#usr-login").value, email, senha, perfil, ...permissoes } });
    }
    // O servidor já devolve o usuário salvo: a lista é atualizada sem pedir tudo de novo.
    usuarios = [...usuarios.filter((u) => u.id !== salvo.id), salvo]
      .sort((a, b) => a.login.localeCompare(b.login, "pt-BR", { sensitivity: "base" }));
    renderUsuarios();
    $("#usr-gaveta").close();
    avisoCentral(editando ? "Alterações salvas com sucesso" : "Usuário criado com sucesso");
  } catch (erro) {
    toast(erro.message, "erro");
  } finally {
    botao.disabled = false;
    botao.textContent = rotulo;
  }
}

// O que é só do administrador continua protegido no servidor; aqui apenas some da tela.
export function aplicarPerfil(usuario) {
  eu = usuario;
  const admin = usuario.perfil === "admin";
  document.querySelectorAll("[data-admin]").forEach((p) => (p.hidden = !admin));
  document.querySelectorAll("[data-edita]").forEach((p) => (p.hidden = !pode(p.dataset.edita, "editar")));
  document.querySelectorAll("[data-so-ve]").forEach((p) => (p.hidden = pode(p.dataset.soVe, "editar")));
  document.querySelectorAll(".tabs button[data-view]").forEach((b) => (b.hidden = b.dataset.view !== "configuracoes" && !pode(b.dataset.view)));
  $("#cfg-entrou").innerHTML = usuario.login ? `Você entrou como <b>${esc(usuario.login)}</b> (${PERFIS[usuario.perfil]})` : "";
  $("#cfg-item-senha").hidden = !usuario.id;
  $("#foto-campo").hidden = !usuario.id;
  mostrarUsuarioLogado(usuario);
  if (!admin) return;
  mostrarVersao();
  carregarUsuarios();
}

// As abas abrem um item por vez; as do administrador nem aparecem para os demais.
export function abrirItem(item) {
  document.querySelectorAll("#cfg-menu [data-abre]").forEach((b) => b.setAttribute("aria-current", b.dataset.abre === item));
  document.querySelectorAll("[data-cfg]").forEach((p) => (p.hidden = p.dataset.cfg !== item));
}

export function iniciarConfiguracoes() {
  document.querySelectorAll("#cfg-menu [data-abre]").forEach((b) => (b.onclick = () => abrirItem(b.dataset.abre)));
  abrirItem("dados");
  $("#usr-novo").onclick = () => abrirGaveta();
  document.querySelectorAll('[name="usr-perfil"]').forEach((r) => (r.onchange = mostrarAcesso));
  document.querySelectorAll("#usr-gaveta [data-fechar]").forEach((b) => (b.onclick = () => $("#usr-gaveta").close()));
  $("#usr-form").onsubmit = salvarGaveta;
  $("#senha-form").onsubmit = async (e) => {
    e.preventDefault();
    const nova = $("#senha-nova").value;
    if (nova !== $("#senha-repete").value) { toast("A nova senha e a repetição estão diferentes.", "erro"); return; }
    try {
      await api("/api/eu/senha", { metodo: "PUT", json: { atual: $("#senha-atual").value, nova } });
      e.target.reset();
      avisoCentral("Senha alterada com sucesso");
    } catch (erro) {
      toast(erro.message, "erro");
    }
  };

  $("#cfg-atualizar").onclick = async () => {
    const botao = $("#cfg-atualizar");
    botao.disabled = true;
    msg("Procurando atualização…");
    try {
      const r = await api("/api/sistema/atualizar", { metodo: "POST", json: {} });
      if (r.ocupado) { msg(""); toast("Já existe uma atualização em andamento."); }
      else if (!r.atualizado) { msg(""); toast("O sistema já está na versão mais recente.", "sucesso"); }
      else if (!r.reiniciando) { msg("Versão nova baixada. Feche a janela do cotador e abra o iniciar.bat de novo para concluir."); toast("Versão nova baixada. Feche a janela do cotador e abra o iniciar.bat de novo para concluir."); }
      else {
        msg("Versão nova baixada. Reiniciando, o que pode levar alguns minutos…");
        if (!(await esperarVoltar())) { msg("O cotador não voltou. Verifique a janela do iniciar.bat no servidor."); toast("O cotador não voltou. Verifique a janela do iniciar.bat no servidor.", "erro"); }
        return;
      }
    } catch (e) {
      msg("");
      toast(`Não deu para atualizar: ${e.message}`, "erro");
    }
    botao.disabled = false;
  };
}
