// Estado compartilhado entre as telas, chamadas à API e pequenos utilitários de interface.
export const $ = (s) => document.querySelector(s);
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export const S = {
  plans: [], loaded: false, dbErr: null,
  eu: null, tipo: "PF", uf: "MG", municipio: "Uberlândia", recomecarHistorico: false, selected: [], over: {}, vidas: Array(10).fill(0),
  hist: [], histLoaded: false, histErr: null,
  cor: { nome: "", fone: "", empresa: "" },
  leituraDisponivel: false,
  linkAtivo: false,
  linkLocal: true,
};

let renderizar = () => {};
export const definirRender = (fn) => { renderizar = fn; };
export const render = () => renderizar();

// Confirmação em destaque, numa caixa no meio da tela, que some sozinha.
export function avisoCentral(texto) {
  const el = $("#aviso-central");
  el.querySelector("b").textContent = texto;
  el.hidden = false;
  el.classList.remove("saindo");
  clearTimeout(avisoCentral.t);
  clearTimeout(avisoCentral.fim);
  avisoCentral.t = setTimeout(() => {
    el.classList.add("saindo");
    avisoCentral.fim = setTimeout(() => (el.hidden = true), 250);
  }, 1800);
}

export function toast(t) {
  const el = $("#toast");
  el.textContent = t;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 2200);
}

// Só para decidir o que aparece na tela: a permissão de verdade é conferida no servidor.
export const eAdmin = () => S.eu?.perfil === "admin";
const ORDEM_NIVEIS = ["nenhum", "ver", "editar"];
export const pode = (tela, minimo = "ver") => ORDEM_NIVEIS.indexOf(S.eu?.permissoes?.[tela] ?? "nenhum") >= ORDEM_NIVEIS.indexOf(minimo);
export const VIEWS = ["cotacao", "planos", "documentos", "historico", "aceites", "configuracoes"];
export function show(telaPedida) {
  // Tela sem permissão abre a primeira permitida; Configurações é de todos.
  const permitida = (t) => !S.eu || t === "configuracoes" || pode(t);
  const v = permitida(telaPedida) ? telaPedida : VIEWS.find(permitida);
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", b.dataset.view === v);
  for (const id of VIEWS) $("#v-" + id).hidden = id !== v;
  if (location.hash.slice(1) !== v) history.replaceState(null, "", "#" + v);
}

export async function api(url, { metodo = "GET", json, corpo, tipo } = {}) {
  const opcoes = { method: metodo };
  if (json !== undefined) {
    opcoes.headers = { "Content-Type": "application/json" };
    opcoes.body = JSON.stringify(json);
  } else if (corpo !== undefined) {
    opcoes.headers = { "Content-Type": tipo };
    opcoes.body = corpo;
  }
  let r;
  try {
    r = await fetch(url, opcoes);
  } catch {
    throw new Error("Não consegui falar com o cotador. Verifique se a janela dele está aberta.");
  }
  if (r.status === 401) {
    location.href = "/login";
    throw new Error("Entre com o seu login para continuar.");
  }
  if (r.status === 204) return null;
  const dados = await r.json().catch(() => null);
  if (!r.ok) {
    const e = new Error(dados?.erro || "Erro inesperado no cotador.");
    e.codigo = dados?.codigo;
    e.status = r.status;
    throw e;
  }
  return dados;
}

export async function carregarPlanos() {
  S.plans = await api("/api/planos");
  S.loaded = true;
  S.dbErr = null;
  S.selected = S.selected.filter((id) => S.plans.some((p) => p.id === id));
}
