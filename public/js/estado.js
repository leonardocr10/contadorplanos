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

// Toda mensagem do sistema aparece numa caixa no meio da tela, que some sozinha ou com um clique.
// O tipo muda o ícone e a cor: sucesso, aviso (o que fazer a seguir) ou erro.
const ICONES_DO_AVISO = { sucesso: "✓", aviso: "i", erro: "!" };
// Toda mensagem fica o mesmo tempo na tela.
const TEMPO_DO_AVISO = 2500;
function esconderAviso() {
  const el = $("#aviso-central");
  clearTimeout(avisoCentral.t);
  el.classList.add("saindo");
  avisoCentral.fim = setTimeout(() => (el.hidden = true), 250);
}
export function avisoCentral(texto, tipo = "sucesso") {
  const el = $("#aviso-central");
  const destino = [...document.querySelectorAll("dialog[open]")].pop() ?? document.body;
  if (el.parentElement !== destino) destino.append(el);
  el.dataset.tipo = tipo;
  el.setAttribute("role", tipo === "erro" ? "alert" : "status");
  el.querySelector(".aviso-central-icone").textContent = ICONES_DO_AVISO[tipo];
  el.querySelector("b").textContent = texto;
  el.hidden = false;
  el.classList.remove("saindo");
  el.onclick = esconderAviso;
  clearTimeout(avisoCentral.t);
  clearTimeout(avisoCentral.fim);
  avisoCentral.t = setTimeout(esconderAviso, TEMPO_DO_AVISO);
}

export const toast = (texto, tipo = "aviso") => avisoCentral(texto, tipo);

// Sem HTTPS o navegador pode recusar a área de transferência: aí a cópia é feita pela seleção.
export async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const campo = document.createElement("textarea");
    campo.value = texto;
    campo.style.cssText = "position:fixed;opacity:0";
    document.body.append(campo);
    campo.select();
    const ok = document.execCommand("copy");
    campo.remove();
    return ok;
  }
}

// Só para decidir o que aparece na tela: a permissão de verdade é conferida no servidor.
export const eAdmin = () => S.eu?.perfil === "admin";
const ORDEM_NIVEIS = ["nenhum", "ver", "editar"];
export const pode = (tela, minimo = "ver") => ORDEM_NIVEIS.indexOf(S.eu?.permissoes?.[tela] ?? "nenhum") >= ORDEM_NIVEIS.indexOf(minimo);
export const VIEWS = ["cotacao", "planos", "documentos", "historico", "aceites", "leitor", "configuracoes"];
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
