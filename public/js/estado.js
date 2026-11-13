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

// Toda mensagem do sistema aparece numa caixa no canto de cima, com uma barra que mostra o tempo até ela sumir.
// Some sozinha, no × ou com um clique; com o mouse em cima, a barra para e a mensagem fica.
// O tipo muda o ícone e a cor: sucesso, aviso (o que fazer a seguir) ou erro.
const ICONE_SVG = (desenho) => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${desenho}</svg>`;
const ICONES_DO_AVISO = {
  sucesso: ICONE_SVG('<circle cx="12" cy="12" r="11" fill="currentColor"/><path d="m7 12.5 3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  aviso: ICONE_SVG('<circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M12 11v6" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="7.3" r="1.5" fill="#fff"/>'),
  erro: ICONE_SVG('<circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M12 6.5v7" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="17" r="1.5" fill="#fff"/>'),
};
// Toda mensagem fica o mesmo tempo na tela.
const TEMPO_DO_AVISO = 2500;
let barraDoAviso = null;
function esconderAviso() {
  const el = $("#aviso-central");
  barraDoAviso?.cancel();
  barraDoAviso = null;
  el.classList.add("saindo");
  clearTimeout(avisoCentral.fim);
  avisoCentral.fim = setTimeout(() => (el.hidden = true), 250);
}
export function avisoCentral(texto, tipo = "sucesso") {
  const el = $("#aviso-central");
  const destino = [...document.querySelectorAll("dialog[open]")].pop() ?? document.body;
  if (el.parentElement !== destino) destino.append(el);
  el.dataset.tipo = tipo;
  el.setAttribute("role", tipo === "erro" ? "alert" : "status");
  el.querySelector(".aviso-central-icone").innerHTML = ICONES_DO_AVISO[tipo];
  el.querySelector("b").textContent = texto;
  el.hidden = false;
  el.classList.remove("saindo");
  clearTimeout(avisoCentral.fim);
  el.onclick = esconderAviso;
  // A barra diminui até zero e, ao terminar, a mensagem some; o mouse em cima pausa as duas coisas.
  barraDoAviso?.cancel();
  barraDoAviso = el.querySelector(".aviso-central-tempo").animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: TEMPO_DO_AVISO, fill: "forwards" });
  barraDoAviso.onfinish = esconderAviso;
  el.onmouseenter = () => barraDoAviso?.pause();
  el.onmouseleave = () => barraDoAviso?.play();
}

export const toast = (texto, tipo = "aviso") => avisoCentral(texto, tipo);

// Só para decidir o que aparece na tela: a permissão de verdade é conferida no servidor.
export const eAdmin = () => S.eu?.perfil === "admin";
const ORDEM_NIVEIS = ["nenhum", "ver", "editar"];
export const pode = (tela, minimo = "ver") => ORDEM_NIVEIS.indexOf(S.eu?.permissoes?.[tela] ?? "nenhum") >= ORDEM_NIVEIS.indexOf(minimo);
export const VIEWS = ["cotacao", "planos", "documentos", "historico", "aceites", "contratos", "regras", "comissoes", "configuracoes"];
// Telas que são parte de outra na permissão (os submenus do Financeiro).
export const telaDaView = (v) => ({ regras: "financeiro", comissoes: "financeiro" }[v] ?? v);
export function show(telaPedida) {
  // Tela sem permissão abre a primeira permitida; Configurações é de todos.
  const permitida = (t) => !S.eu || t === "configuracoes" || pode(telaDaView(t));
  const v = permitida(telaPedida) ? telaPedida : VIEWS.find(permitida);
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", b.dataset.view === v);
  for (const id of VIEWS) $("#v-" + id).hidden = id !== v;
  if (location.hash.slice(1) !== v) history.replaceState(null, "", "#" + v);
}

export async function api(url, { metodo = "GET", json, corpo, tipo, cabecalhos } = {}) {
  const opcoes = { method: metodo };
  if (json !== undefined) {
    opcoes.headers = { "Content-Type": "application/json" };
    opcoes.body = JSON.stringify(json);
  } else if (corpo !== undefined) {
    opcoes.headers = { "Content-Type": tipo };
    opcoes.body = corpo;
  }
  if (cabecalhos) opcoes.headers = { ...opcoes.headers, ...cabecalhos };
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
