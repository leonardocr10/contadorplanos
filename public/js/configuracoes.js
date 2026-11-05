// Aba "Configurações": senha de cada login e, para o administrador, usuários e atualização do sistema.
import { $, api, esc, pode, toast } from "./estado.js";

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const msg = (t) => ($("#cfg-msg").textContent = t);
const msgUsuarios = (t) => ($("#usr-msg").textContent = t);
const PERFIS = { admin: "Administrador", usuario: "Usuário" };
const TELAS = { cotacao: "Nova cotação", planos: "Planos e valores", documentos: "Documentos", historico: "Histórico", aceites: "Aceites" };
const NIVEIS = { nenhum: "Sem acesso", ver: "Visualização", editar: "Edição" };
const PADRAO = { cotacao: "editar", planos: "ver", documentos: "ver", historico: "editar", aceites: "editar" };

let eu = null, usuarios = [];

const camposDePermissao = (atuais) => `<div class="usr-permissoes" data-permissoes><div class="label">Acesso às telas</div>${Object.entries(TELAS).map(([tela, nome]) => `<div class="field"><label>${nome}<select data-tela="${tela}" aria-label="Acesso a ${nome}">${Object.entries(NIVEIS).map(([n, rotulo]) => `<option value="${n}" ${atuais[tela] === n ? "selected" : ""}>${rotulo}</option>`).join("")}</select></label></div>`).join("")}</div>`;
const lerPermissoes = (raiz) => Object.fromEntries([...raiz.querySelectorAll("[data-tela]")].map((s) => [s.dataset.tela, s.value]));
const resumoDePermissoes = (p) => Object.entries(TELAS).map(([t, nome]) => `${nome}: ${NIVEIS[p[t]]}`).join(" · ");

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
async function carregarUsuarios() {
  try {
    usuarios = await api("/api/usuarios");
    renderUsuarios();
  } catch (e) {
    msgUsuarios(e.message);
  }
}

function renderUsuarios() {
  const box = $("#usr-lista");
  box.innerHTML = usuarios.map((u) => {
    const proprio = u.id === eu?.id;
    const detalhes = [PERFIS[u.perfil], u.nome, u.email || "Sem e-mail", u.ativo ? "" : "Desativado"].filter(Boolean).join(" · ");
    return `<div class="usr-linha" data-id="${esc(u.id)}">
      <div class="usr-nome">${esc(u.login)}${proprio ? " (você)" : ""}<small>${esc(detalhes)}</small>${u.perfil === "admin" ? "" : `<small>${esc(resumoDePermissoes(u.permissoes))}</small>`}</div>
      <div class="actions">
        ${u.perfil === "admin" ? "" : `<button class="btn" type="button" data-telas>Telas</button>`}
        <button class="btn" type="button" data-email>E-mail</button>
        <button class="btn" type="button" data-senha>Redefinir senha</button>
        ${proprio ? "" : `<button class="btn" type="button" data-perfil>${u.perfil === "admin" ? "Tornar usuário" : "Tornar administrador"}</button>
        <button class="btn" type="button" data-ativo>${u.ativo ? "Desativar" : "Ativar"}</button>
        <button class="btn danger" type="button" data-excluir>Excluir</button>`}
      </div>
      ${u.perfil === "admin" ? "" : `<form class="usr-senha" data-form-telas hidden>${camposDePermissao(u.permissoes)}<button class="btn primary" type="submit">Salvar telas</button></form>`}
      <form class="usr-senha" data-form-email hidden autocomplete="off">
        <input type="email" required autocapitalize="none" value="${esc(u.email)}" placeholder="E-mail para recuperar a senha" aria-label="E-mail de ${esc(u.login)}">
        <button class="btn primary" type="submit">Salvar e-mail</button>
      </form>
      <form class="usr-senha" data-form-senha hidden autocomplete="off">
        <input class="campo-senha" type="password" minlength="8" required autocomplete="new-password" placeholder="Nova senha (mínimo de 8 caracteres)" aria-label="Nova senha de ${esc(u.login)}">
        <button class="btn primary" type="submit">Salvar senha</button>
      </form>
      <div class="status" data-confirma hidden style="width:100%">Excluir o usuário <b>${esc(u.login)}</b>? As cotações e propostas dele continuam visíveis para o administrador. <span class="actions" style="margin-top:8px"><button class="btn danger" type="button" data-sim>Sim, excluir</button><button class="btn" type="button" data-nao>Manter</button></span></div>
    </div>`;
  }).join("");
  box.querySelectorAll(".usr-linha").forEach((linha) => {
    const u = usuarios.find((x) => x.id === linha.dataset.id);
    const alterar = async (dados, aviso) => {
      msgUsuarios("");
      try {
        await api(`/api/usuarios/${encodeURIComponent(u.id)}`, { metodo: "PUT", json: dados });
        toast(aviso);
        await carregarUsuarios();
      } catch (e) {
        msgUsuarios(e.message);
      }
    };
    const formEmail = linha.querySelector("[data-form-email]");
    linha.querySelector("[data-email]").onclick = () => { formEmail.hidden = !formEmail.hidden; if (!formEmail.hidden) formEmail.querySelector("input").focus(); };
    formEmail.onsubmit = (e) => { e.preventDefault(); alterar({ email: formEmail.querySelector("input").value }, "E-mail alterado"); };
    const formTelas = linha.querySelector("[data-form-telas]");
    if (formTelas) {
      linha.querySelector("[data-telas]").onclick = () => (formTelas.hidden = !formTelas.hidden);
      formTelas.onsubmit = (e) => { e.preventDefault(); alterar({ permissoes: lerPermissoes(formTelas) }, "Acesso às telas alterado"); };
    }
    const form = linha.querySelector("[data-form-senha]");
    linha.querySelector("[data-senha]").onclick = () => { form.hidden = !form.hidden; if (!form.hidden) form.querySelector("input").focus(); };
    form.onsubmit = (e) => { e.preventDefault(); alterar({ senha: form.querySelector("input").value }, "Senha redefinida"); };
    const perfil = linha.querySelector("[data-perfil]");
    if (!perfil) return;
    perfil.onclick = () => alterar({ perfil: u.perfil === "admin" ? "usuario" : "admin" }, "Perfil alterado");
    linha.querySelector("[data-ativo]").onclick = () => alterar({ ativo: !u.ativo }, u.ativo ? "Usuário desativado" : "Usuário ativado");
    const confirma = linha.querySelector("[data-confirma]");
    linha.querySelector("[data-excluir]").onclick = () => (confirma.hidden = false);
    linha.querySelector("[data-nao]").onclick = () => (confirma.hidden = true);
    linha.querySelector("[data-sim]").onclick = async () => {
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

// O que é só do administrador continua protegido no servidor; aqui apenas some da tela.
export function aplicarPerfil(usuario) {
  eu = usuario;
  const admin = usuario.perfil === "admin";
  document.querySelectorAll("[data-admin]").forEach((p) => (p.hidden = !admin));
  document.querySelectorAll("[data-edita]").forEach((p) => (p.hidden = !pode(p.dataset.edita, "editar")));
  document.querySelectorAll("[data-so-ve]").forEach((p) => (p.hidden = pode(p.dataset.soVe, "editar")));
  document.querySelectorAll(".tabs button[data-view]").forEach((b) => (b.hidden = b.dataset.view !== "configuracoes" && !pode(b.dataset.view)));
  $("#cfg-entrou").textContent = usuario.login ? `Você entrou como ${usuario.login} (${PERFIS[usuario.perfil]}).` : "";
  $("#cfg-item-senha").hidden = !usuario.id;
  if (!admin) return;
  mostrarVersao();
  carregarUsuarios();
}

// O menu abre um item por vez; os itens do administrador nem aparecem no menu dos demais.
function abrirItem(item) {
  document.querySelectorAll("#cfg-menu [data-abre]").forEach((b) => b.setAttribute("aria-current", b.dataset.abre === item));
  document.querySelectorAll("[data-cfg]").forEach((p) => (p.hidden = p.dataset.cfg !== item));
  $("#cfg-vazio").hidden = true;
}

export function iniciarConfiguracoes() {
  document.querySelectorAll("#cfg-menu [data-abre]").forEach((b) => (b.onclick = () => abrirItem(b.dataset.abre)));
  $("#usr-permissoes").innerHTML = camposDePermissao(PADRAO);
  // O administrador tem acesso a tudo, então não há o que escolher.
  $("#usr-perfil").addEventListener("change", () => ($("#usr-permissoes").hidden = $("#usr-perfil").value === "admin"));
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

  $("#usr-form").onsubmit = async (e) => {
    e.preventDefault();
    msgUsuarios("");
    try {
      const perfil = $("#usr-perfil").value;
      await api("/api/usuarios", { metodo: "POST", json: {
        login: $("#usr-login").value, email: $("#usr-email").value, senha: $("#usr-senha").value, perfil,
        ...(perfil === "admin" ? {} : { permissoes: lerPermissoes($("#usr-permissoes")) }),
      } });
      e.target.reset();
      $("#usr-perfil").value = "usuario";
      $("#usr-permissoes").innerHTML = camposDePermissao(PADRAO);
      $("#usr-permissoes").hidden = false;
      toast("Usuário criado");
      await carregarUsuarios();
    } catch (erro) {
      msgUsuarios(erro.message);
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
