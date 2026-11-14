// Tela "Histórico" e o quadro "Histórico deste número" da cotação.
import { brl, fmtFone, normFone } from "./calculo.js";
import { $, S, api, avisoCentral, esc, pode, render, show, toast } from "./estado.js";
import { linkConversaDireta, waHtml } from "./mensagem.js";
import { normalizar } from "./filtro-select.js";
import { botaoIcone, cabecalho, desenharCards, desenharPaginacao, guardarPorPagina, lerPorPagina, ordenarPor, paginar, proximaOrdem } from "./grade.js";

const STATUS = ["Enviada", "Em Negociação", "Vendida", "Negativa"];
const stClass = (s) => ({ "Em Negociação": "st-neg", "Vendida": "st-ok", "Negativa": "st-off" }[s] || "st-env");
const fmtData = (iso) => {
  try { return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); } catch { return ""; }
};
// Na grade, só a data (a hora continua nas cotações abertas abaixo da linha).
const fmtDiaHist = (iso) => {
  try { return new Date(iso).toLocaleDateString("pt-BR"); } catch { return ""; }
};

export async function carregarHistorico() {
  if (!pode("historico")) return;
  try {
    S.hist = await api("/api/cotacoes");
    S.histLoaded = true;
    S.histErr = null;
  } catch (e) {
    S.histErr = e.message;
  }
  renderHist();
  renderHistCli();
}

// Com id, atualiza a cotação em andamento; se ela foi excluída nesse meio-tempo, cria de novo.
export async function saveQuote(dados, id = null) {
  try {
    let salva = null;
    if (id) {
      try {
        salva = await api(`/api/cotacoes/${encodeURIComponent(id)}`, { metodo: "PUT", json: dados });
      } catch (e) {
        if (e.status !== 404) throw e;
      }
    }
    salva ||= await api("/api/cotacoes", { metodo: "POST", json: dados });
    await carregarHistorico();
    return salva;
  } catch (e) {
    toast(`Não deu para salvar no histórico: ${e.message}`, "erro");
    return null;
  }
}

function resumoPlanos(h) {
  return (h.planos || []).map((x) => `<b>${esc(x.nome)}</b>${x.enf != null ? ` · Enf. R$ ${brl(x.enf)}` : ""}${x.apto != null ? ` · Apto R$ ${brl(x.apto)}` : ""}`).join("<br>");
}

function quoteRow(h, withDelete) {
  const nv = (h.vidas || []).reduce((a, b) => a + b, 0);
  return `<div class="hq" data-hid="${esc(h.id)}">
    <div class="hq-top"><span class="hq-date">${fmtData(h.criadoEm)} · ${h.tipo === "CNPJ" ? "CNPJ" : "PF"}${h.municipio ? ` · ${esc(h.municipio)}` : ""}${nv ? ` · ${nv} ${nv === 1 ? "vida" : "vidas"}` : ""}${h.idades ? ` (${esc(h.idades)})` : ""}</span>
      <select class="hq-st ${stClass(h.status)}" aria-label="Situação da cotação" ${pode("historico", "editar") ? "" : "disabled"}>${STATUS.map((s) => `<option ${s === h.status ? "selected" : ""}>${s}</option>`).join("")}</select></div>
    <div class="hq-plans">${resumoPlanos(h)}</div>
    <div class="actions">${pode("cotacao") ? `<button class="btn" data-reopen="1">Reabrir cotação</button>` : ""}${withDelete && pode("historico", "editar") ? `<button class="btn danger" data-del="1">Excluir</button>` : ""}</div>
    <div class="status" data-confirm hidden>Excluir esta cotação do histórico? <span class="actions" style="margin-top:8px"><button class="btn danger" data-del2="1">Sim, excluir</button><button class="btn" data-delno="1">Manter</button></span></div>
    <details><summary>Ver mensagem enviada</summary><div class="bubble" style="margin-top:8px;max-width:100%">${waHtml(h.mensagem || "")}</div></details>
  </div>`;
}

function wireRows(box) {
  box.querySelectorAll(".hq").forEach((row) => {
    const h = S.hist.find((x) => x.id === row.dataset.hid);
    if (!h) return;
    const reabrir = row.querySelector("[data-reopen]");
    if (reabrir) reabrir.onclick = () => reopen(h);
    const st = row.querySelector(".hq-st");
    st.onchange = async () => {
      try {
        await api(`/api/cotacoes/${encodeURIComponent(h.id)}`, { metodo: "PATCH", json: { status: st.value } });
        await carregarHistorico();
        avisoCentral("Situação salva com sucesso");
      } catch (e) {
        toast(`Não deu para atualizar: ${e.message}`, "erro");
      }
    };
    const d = row.querySelector("[data-del]");
    if (d) {
      const c = row.querySelector("[data-confirm]");
      d.onclick = () => (c.hidden = false);
      row.querySelector("[data-delno]").onclick = () => (c.hidden = true);
      row.querySelector("[data-del2]").onclick = async () => {
        try {
          await api(`/api/cotacoes/${encodeURIComponent(h.id)}`, { metodo: "DELETE" });
          await carregarHistorico();
          avisoCentral("Cotação excluída com sucesso");
        } catch (e) {
          toast(`Não deu para excluir: ${e.message}`, "erro");
        }
      };
    }
  });
}

function reopen(h) {
  S.tipo = h.tipo === "CNPJ" ? "CNPJ" : "PF";
  for (const x of $("#tipo").children) x.setAttribute("aria-pressed", x.dataset.t === S.tipo);
  $("#cliente").value = h.cliente || "";
  $("#fone").value = fmtFone(h.fone || "");
  S.vidas = Array.isArray(h.vidas) && h.vidas.length === 10 ? [...h.vidas] : Array(10).fill(0);
  S.over = h.over && typeof h.over === "object" ? JSON.parse(JSON.stringify(h.over)) : {};
  const ids = (h.planos || []).map((x) => x.id);
  S.selected = ids.filter((id) => S.plans.some((p) => p.id === id));
  // Cotação antiga não tem cidade salva: reabre mostrando todos os planos.
  S.uf = h.uf || "";
  S.municipio = h.municipio || "";
  // Reabrir não cria cotação: só uma alteração gera outra, e a original fica como estava.
  S.recomecarHistorico = true;
  show("cotacao");
  render();
  renderHistCli();
  scrollTo({ top: 0, behavior: "auto" });
  avisoCentral(S.selected.length < ids.length ? "Cotação reaberta, mas algum plano não existe mais" : "Cotação reaberta com os valores atuais");
}

export function renderHistCli() {
  const box = $("#hist-cli"), f = normFone($("#fone").value);
  if (f.length < 10 || !pode("historico")) { box.innerHTML = ""; return; }
  if (!S.histLoaded) { box.innerHTML = `<div class="note">${S.histErr ? esc(S.histErr) : "Buscando histórico deste número…"}</div>`; return; }
  const list = S.hist.filter((h) => h.fone === f);
  if (!list.length) { box.innerHTML = `<div class="note">Cliente novo: nenhuma cotação anterior para ${fmtFone(f)}.</div>`; return; }
  box.innerHTML = `<details class="hist-box" open><summary>Histórico deste número · ${list.length} ${list.length === 1 ? "cotação" : "cotações"}</summary><div class="cat" style="margin-top:10px">${list.slice(0, 5).map((h) => quoteRow(h, false)).join("")}</div>${list.length > 5 ? `<p class="note">Veja todas na aba Histórico.</p>` : ""}</details>`;
  wireRows(box);
}

/* ---------- grade: um cliente por linha, com as cotações dele num painel ---------- */
const CHAVE_POR_PAGINA = "cotador.historico.porPagina";
let filtroSt = "Todas", pagina = 1, ordem = { campo: "ultima", dir: "desc" };
let porPagina = lerPorPagina(CHAVE_POR_PAGINA);
// Clientes com as cotações abertas.
const abertos = new Set();

const nomeDoGrupo = (l) => l.find((h) => h.cliente)?.cliente || "Sem nome";
const COLUNAS = [
  { campo: "cliente", rotulo: "Cliente", valor: (g) => normalizar(nomeDoGrupo(g.lista)) },
  { campo: "fone", rotulo: "Telefone", valor: (g) => g.lista[0].fone || "￿" },
  { campo: "planos", rotulo: "Última cotação", valor: (g) => normalizar((g.lista[0].planos || []).map((p) => p.nome).join(" ")) },
  { campo: "qtd", rotulo: "Cotações", valor: (g) => g.lista.length, centro: true, desc: true },
  { campo: "ultima", rotulo: "Última em", valor: (g) => g.lista[0].criadoEm, desc: true },
  { campo: "situacao", rotulo: "Situação", valor: (g) => STATUS.indexOf(g.lista[0].status || "Enviada") },
];

// Sem WhatsApp, as cotações são agrupadas pelo nome do cliente.
function grupos() {
  const mapa = new Map();
  for (const h of S.hist) {
    const chave = h.fone || `sem-whatsapp:${(h.cliente || "").trim().toLowerCase()}`;
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push(h);
  }
  return [...mapa.entries()].map(([chave, lista]) => ({ chave, lista }));
}

function linhaDoCliente(g) {
  const l = g.lista, h = l[0], f = h.fone, aberto = abertos.has(g.chave);
  const planos = (h.planos || []).map((p) => p.nome);
  const acoes = [
    botaoIcone("ver", aberto ? "Fechar as cotações" : `Ver ${l.length === 1 ? "a cotação" : `as ${l.length} cotações`}`, { atributos: `data-ver-cotacoes aria-expanded="${aberto}"`, numero: l.length > 1 ? l.length : 0 }),
    f ? botaoIcone("whatsapp", "Abrir conversa no WhatsApp", { href: linkConversaDireta(f, "", navigator.userAgent) }) : "",
    pode("cotacao") ? botaoIcone("reabrir", "Reabrir a última cotação", { atributos: "data-reabrir-ultima" }) : "",
  ].join("");
  return `<tr class="grade-linha" data-grupo="${esc(g.chave)}">
      <td><div class="grade-nome" title="${esc(nomeDoGrupo(l))}">${esc(nomeDoGrupo(l))}</div></td>
      <td class="grade-fone">${f ? esc(fmtFone(f)) : "Sem WhatsApp"}</td>
      <td><div class="grade-plano grade-plano-uma" title="${esc(planos.join(", "))}">${esc(planos[0] || "—")}${planos.length > 1 ? ` <span class="ctr-sub">+${planos.length - 1}</span>` : ""} <span class="ctr-sub">· ${h.tipo === "CNPJ" ? "CNPJ" : "PF"}</span></div></td>
      <td class="centro">${l.length}</td>
      <td class="grade-data">${esc(fmtDiaHist(h.criadoEm))}</td>
      <td><span class="pill ${stClass(h.status)}">${esc(h.status || "Enviada")}</span></td>
      <td><div class="grade-acoes">${acoes}</div></td>
    </tr>${aberto ? `<tr class="grade-painel-linha" data-grupo="${esc(g.chave)}"><td colspan="${COLUNAS.length + 1}"><div class="cat">${l.map((x) => quoteRow(x, true)).join("")}</div></td></tr>` : ""}`;
}

export function renderHist() {
  const box = $("#hist-list"), nav = $("#hist-paginacao");
  const todos = grupos();
  // Situação de cada cliente é a da cotação mais recente dele.
  const quantas = (s) => todos.filter((g) => (g.lista[0].status || "Enviada") === s).length;
  const sel = $("#hist-filtro");
  // Só troca as opções quando as contagens mudam, para não fechar a lista aberta.
  const opcoes = `<option value="Todas" data-icone="todos">Todas as situações</option><optgroup label="Situações">${STATUS.map((s) => `<option value="${s}"${S.histLoaded ? ` data-selo="${quantas(s)}"` : ""}>${s}</option>`).join("")}</optgroup>`;
  if (sel.dataset.opcoes !== opcoes) { sel.innerHTML = opcoes; sel.dataset.opcoes = opcoes; }
  sel.value = filtroSt;
  $("#hist-por-pagina").value = String(porPagina);
  const q = $("#hist-busca").value.trim();
  $("#hist-limpar").disabled = filtroSt === "Todas" && !q;
  desenharCards($("#hist-cards"), [{ chave: "Todas", rotulo: "Todos os clientes", qtd: todos.length }, ...STATUS.map((s) => ({ chave: s, rotulo: s, qtd: quantas(s) }))], filtroSt,
    (chave) => { filtroSt = chave === "todos" ? "Todas" : chave; pagina = 1; renderHist(); });
  if (!S.histLoaded) { box.innerHTML = `<div class="status">${S.histErr ? esc(S.histErr) : "Carregando histórico…"}</div>`; nav.innerHTML = ""; return; }
  $("#hist-count").textContent = `${todos.length} ${todos.length === 1 ? "cliente" : "clientes"} · ${S.hist.length} ${S.hist.length === 1 ? "cotação" : "cotações"}`;
  if (!S.hist.length) { box.innerHTML = `<div class="status">Nenhuma cotação salva ainda. Monte uma cotação em <b>Nova Cotação</b>: ela aparece aqui automaticamente.</div>`; nav.innerHTML = ""; return; }
  const qn = normalizar(q), qd = q.replace(/\D/g, "");
  const filtrados = todos.filter(({ lista: l }) => {
    if (filtroSt !== "Todas" && (l[0].status || "Enviada") !== filtroSt) return false;
    if (!q) return true;
    return (qd.length >= 3 && (l[0].fone || "").includes(qd)) || l.some((h) => normalizar(h.cliente || "").includes(qn) || (h.planos || []).some((p) => normalizar(p.nome).includes(qn)));
  });
  const pag = paginar(ordenarPor(filtrados, COLUNAS, ordem, (x, y) => String(y.lista[0].criadoEm).localeCompare(String(x.lista[0].criadoEm))), pagina, porPagina);
  pagina = pag.pagina;
  box.innerHTML = pag.quantos
    ? `<div class="grade-rolagem"><table class="grade-tabela grade-hist">${cabecalho(COLUNAS, ordem)}<tbody>${pag.itens.map(linhaDoCliente).join("")}</tbody></table></div>`
    : `<div class="status">Nenhum cliente encontrado com esses filtros.</div>`;
  desenharPaginacao(nav, pag, ["cliente", "clientes"], (p) => { pagina = p; renderHist(); box.scrollIntoView({ block: "nearest" }); });
  box.querySelectorAll("[data-ordem]").forEach((b) => (b.onclick = () => { ordem = proximaOrdem(ordem, b.dataset.ordem, COLUNAS); pagina = 1; renderHist(); }));
  const doGrupo = (el) => todos.find((g) => g.chave === el.closest("[data-grupo]").dataset.grupo);
  box.querySelectorAll("[data-ver-cotacoes]").forEach((b) => (b.onclick = () => {
    const g = doGrupo(b);
    if (abertos.has(g.chave)) abertos.delete(g.chave); else abertos.add(g.chave);
    renderHist();
  }));
  box.querySelectorAll("[data-reabrir-ultima]").forEach((b) => (b.onclick = () => reopen(doGrupo(b).lista[0])));
  wireRows(box);
}

export function iniciarHistorico() {
  $("#hist-busca").addEventListener("input", () => { pagina = 1; renderHist(); });
  $("#hist-filtro").onchange = () => { filtroSt = $("#hist-filtro").value; pagina = 1; renderHist(); };
  $("#hist-por-pagina").onchange = () => {
    porPagina = Number($("#hist-por-pagina").value) || 10;
    guardarPorPagina(CHAVE_POR_PAGINA, porPagina);
    pagina = 1;
    renderHist();
  };
  $("#hist-limpar").onclick = () => { $("#hist-busca").value = ""; filtroSt = "Todas"; pagina = 1; renderHist(); };
}
