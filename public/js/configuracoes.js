// Aba "Configurações": senha de cada login e, para o administrador, usuários e atualização do sistema.
import { $, api, esc, pode, toast } from "./estado.js";

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const msg = (t) => ($("#cfg-msg").textContent = t);
const msgUsuarios = (t) => ($("#usr-msg").textContent = t);
const PERFIS = { admin: "Administrador", usuario: "Usuário" };
const TELAS = { cotacao: "Nova cotação", planos: "Planos e valores", documentos: "Documentos", historico: "Histórico", aceites: "Aceites" };
const NIVEIS = { nenhum: "Sem acesso", ver: "Ver", editar: "Editar" };
const NOMES_NIVEIS = { nenhum: "sem acesso", ver: "visualização", editar: "edição" };
const PADRAO = { cotacao: "editar", planos: "ver", documentos: "ver", historico: "editar", aceites: "editar" };

let eu = null, usuarios = [], editando = null;

const camposDePermissao = (atuais) => Object.entries(TELAS).map(([tela, nome]) => `<div class="usr-tela"><span>${nome}</span><div class="usr-niveis" role="radiogroup" aria-label="Acesso a ${nome}">${Object.entries(NIVEIS).map(([n, rotulo]) => `<label><input type="radio" name="perm-${tela}" value="${n}" ${atuais[tela] === n ? "checked" : ""}><span>${rotulo}</span></label>`).join("")}</div></div>`).join("");
const lerPermissoes = () => Object.fromEntries([...$("#usr-permissoes").querySelectorAll("input:checked")].map((r) => [r.name.slice(5), r.value]));
const perfilEscolhido = () => document.querySelector('[name="usr-perfil"]:checked').value;
const nivelNaTela = (u, tela) => (u.perfil === "admin" ? "editar" : u.permissoes?.[tela] ?? "nenhum");
const chipsDeAcesso = (u) => Object.entries(TELAS).map(([tela, nome]) => {
  const nivel = nivelNaTela(u, tela);
  return `<span class="chip-tela ${nivel}">${nome}<span class="so-leitor">: ${NOMES_NIVEIS[nivel]}</span></span>`;
}).join("");

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
      <td><div class="usr-quem"><span class="usr-avatar" aria-hidden="true">${esc(u.login.charAt(0).toUpperCase())}</span><div><b>${esc(u.login)}</b>${proprio ? " <span class=\"usr-voce\">(você)</span>" : ""}<small>${esc(detalhes)}</small></div></div></td>
      <td><span class="usr-selo ${u.perfil}">${PERFIS[u.perfil]}</span>${u.ativo ? "" : '<span class="usr-selo desativado">Desativado</span>'}</td>
      <td><div class="usr-chips">${chipsDeAcesso(u)}</div></td>
      <td><div class="usr-acoes">
        <button class="btn" type="button" data-editar>Editar</button>
        ${proprio ? "" : `<button class="btn" type="button" data-ativo>${u.ativo ? "Desativar" : "Ativar"}</button>
        <button class="btn danger" type="button" data-excluir>Excluir</button>`}
      </div></td>
    </tr>
    <tr class="usr-confirma" data-confirma="${esc(u.id)}" hidden><td colspan="4"><div class="status">Excluir o usuário <b>${esc(u.login)}</b>? As cotações e propostas dele continuam visíveis para o administrador. <span class="actions" style="margin-top:8px"><button class="btn danger" type="button" data-sim>Sim, excluir</button><button class="btn" type="button" data-nao>Manter</button></span></div></td></tr>`;
  }).join("");
  box.querySelectorAll("tr[data-id]").forEach((linha) => {
    const u = usuarios.find((x) => x.id === linha.dataset.id);
    linha.querySelector("[data-editar]").onclick = () => abrirGaveta(u);
    if (!linha.querySelector("[data-ativo]")) return;
    linha.querySelector("[data-ativo]").onclick = async () => {
      msgUsuarios("");
      try {
        await api(`/api/usuarios/${encodeURIComponent(u.id)}`, { metodo: "PUT", json: { ativo: !u.ativo } });
        toast(u.ativo ? "Usuário desativado" : "Usuário ativado");
        await carregarUsuarios();
      } catch (e) {
        msgUsuarios(e.message);
      }
    };
    const confirma = linha.nextElementSibling;
    linha.querySelector("[data-excluir]").onclick = () => (confirma.hidden = false);
    confirma.querySelector("[data-nao]").onclick = () => (confirma.hidden = true);
    confirma.querySelector("[data-sim]").onclick = async () => {
      msgUsuarios("");
      try {
        await api(`/api/usuarios/${encodeURIComponent(u.id)}`, { metodo: "DELETE" });
        toast("Usuário excluído");
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
  $("#usr-gaveta-msg").textContent = "";
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
  $("#usr-gaveta-msg").textContent = "";
  const perfil = perfilEscolhido(), email = $("#usr-email").value.trim(), senha = $("#usr-senha").value;
  const permissoes = perfil === "admin" ? {} : { permissoes: lerPermissoes() };
  try {
    if (editando) {
      await api(`/api/usuarios/${encodeURIComponent(editando.id)}`, { metodo: "PUT", json: {
        ...permissoes,
        ...(perfil !== editando.perfil ? { perfil } : {}),
        ...(email !== editando.email ? { email } : {}),
        ...(senha ? { senha } : {}),
      } });
      if (editando.id === eu?.id) { eu.email = email.toLowerCase(); $("#c-email").value = eu.email; }
    } else {
      await api("/api/usuarios", { metodo: "POST", json: { login: $("#usr-login").value, email, senha, perfil, ...permissoes } });
    }
    const aviso = editando ? "Usuário alterado" : "Usuário criado";
    $("#usr-gaveta").close();
    toast(aviso);
    await carregarUsuarios();
  } catch (erro) {
    $("#usr-gaveta-msg").textContent = erro.message;
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
  if (!admin) return;
  mostrarVersao();
  carregarUsuarios();
}

// As abas abrem um item por vez; as do administrador nem aparecem para os demais.
function abrirItem(item) {
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
    const nova = $("#senha-nova").value, aviso = (t) => ($("#senha-msg").textContent = t);
    if (nova !== $("#senha-repete").value) { aviso("A nova senha e a repetição estão diferentes."); return; }
    try {
      await api("/api/eu/senha", { metodo: "PUT", json: { atual: $("#senha-atual").value, nova } });
      e.target.reset();
      aviso("");
      toast("Senha alterada");
    } catch (erro) {
      aviso(erro.message);
    }
  };

  $("#cfg-atualizar").onclick = async () => {
    const botao = $("#cfg-atualizar");
    botao.disabled = true;
    msg("Procurando atualização…");
    try {
      const r = await api("/api/sistema/atualizar", { metodo: "POST", json: {} });
      if (r.ocupado) msg("Já existe uma atualização em andamento.");
      else if (!r.atualizado) msg("O sistema já está na versão mais recente.");
      else if (!r.reiniciando) msg("Versão nova baixada. Feche a janela do cotador e abra o iniciar.bat de novo para concluir.");
      else {
        msg("Versão nova baixada. Reiniciando, o que pode levar alguns minutos…");
        if (!(await esperarVoltar())) msg("O cotador não voltou. Verifique a janela do iniciar.bat no servidor.");
        return;
      }
    } catch (e) {
      msg(`Não deu para atualizar: ${e.message}`);
    }
    botao.disabled = false;
  };
}
