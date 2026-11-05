// Tela "Histórico" e o quadro "Histórico deste número" da cotação.
import { brl, fmtFone, normFone } from "./calculo.js";
import { $, S, api, esc, render, show, toast } from "./estado.js";
import { linkConversaDireta, waHtml } from "./mensagem.js";

const STATUS = ["Enviada", "Em Negociação", "Vendida", "Negativa"];
const stClass = (s) => ({ "Em Negociação": "st-neg", "Vendida": "st-ok", "Negativa": "st-off" }[s] || "st-env");
const fmtData = (iso) => {
  try { return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); } catch { return ""; }
};

export async function carregarHistorico() {
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

export async function saveQuote(dados, silent) {
  if (dados.fone.length < 10) {
    toast(silent ? "Dica: informe o WhatsApp do cliente para guardar no histórico" : "Informe o WhatsApp do cliente para salvar no histórico");
    return false;
  }
  if (!dados.planos.length) return false;
  try {
    await api("/api/cotacoes", { metodo: "POST", json: dados });
    await carregarHistorico();
    return true;
  } catch (e) {
    toast(`Não deu para salvar no histórico: ${e.message}`);
    return false;
  }
}

function resumoPlanos(h) {
  return (h.planos || []).map((x) => `<b>${esc(x.nome)}</b>${x.enf != null ? ` · Enf. R$ ${brl(x.enf)}` : ""}${x.apto != null ? ` · Apto R$ ${brl(x.apto)}` : ""}`).join("<br>");
}

function quoteRow(h, withDelete) {
  const nv = (h.vidas || []).reduce((a, b) => a + b, 0);
  return `<div class="hq" data-hid="${esc(h.id)}">
    <div class="hq-top"><span class="hq-date">${fmtData(h.criadoEm)} · ${h.tipo === "CNPJ" ? "CNPJ" : "PF"}${h.municipio ? ` · ${esc(h.municipio)}` : ""}${nv ? ` · ${nv} ${nv === 1 ? "vida" : "vidas"}` : ""}${h.idades ? ` (${esc(h.idades)})` : ""}</span>
      <select class="hq-st ${stClass(h.status)}" aria-label="Situação da cotação">${STATUS.map((s) => `<option ${s === h.status ? "selected" : ""}>${s}</option>`).join("")}</select></div>
    <div class="hq-plans">${resumoPlanos(h)}</div>
    <div class="actions"><button class="btn" data-reopen="1">Reabrir cotação</button>${withDelete ? `<button class="btn danger" data-del="1">Excluir</button>` : ""}</div>
    <div class="status" data-confirm hidden>Excluir esta cotação do histórico? <span class="actions" style="margin-top:8px"><button class="btn danger" data-del2="1">Sim, excluir</button><button class="btn" data-delno="1">Manter</button></span></div>
    <details><summary>Ver mensagem enviada</summary><div class="bubble" style="margin-top:8px;max-width:100%">${waHtml(h.mensagem || "")}</div></details>
  </div>`;
}

function wireRows(box) {
  box.querySelectorAll(".hq").forEach((row) => {
    const h = S.hist.find((x) => x.id === row.dataset.hid);
    if (!h) return;
    row.querySelector("[data-reopen]").onclick = () => reopen(h);
    const st = row.querySelector(".hq-st");
    st.onchange = async () => {
      try {
        await api(`/api/cotacoes/${encodeURIComponent(h.id)}`, { metodo: "PATCH", json: { status: st.value } });
        await carregarHistorico();
        toast("Situação atualizada");
      } catch (e) {
        toast(`Não deu para atualizar: ${e.message}`);
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
          toast("Cotação excluída");
        } catch (e) {
          toast(`Não deu para excluir: ${e.message}`);
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
  show("cotacao");
  render();
  renderHistCli();
  scrollTo({ top: 0, behavior: "auto" });
  toast(S.selected.length < ids.length ? "Cotação reaberta (algum plano não existe mais)" : "Cotação reaberta com os valores atuais");
}

export function renderHistCli() {
  const box = $("#hist-cli"), f = normFone($("#fone").value);
  if (f.length < 10) { box.innerHTML = ""; return; }
  if (!S.histLoaded) { box.innerHTML = `<div class="note">${S.histErr ? esc(S.histErr) : "Buscando histórico deste número…"}</div>`; return; }
  const list = S.hist.filter((h) => h.fone === f);
  if (!list.length) { box.innerHTML = `<div class="note">Cliente novo: nenhuma cotação anterior para ${fmtFone(f)}.</div>`; return; }
  box.innerHTML = `<details class="hist-box" open><summary>Histórico deste número · ${list.length} ${list.length === 1 ? "cotação" : "cotações"}</summary><div class="cat" style="margin-top:10px">${list.slice(0, 5).map((h) => quoteRow(h, false)).join("")}</div>${list.length > 5 ? `<p class="note">Veja todas na aba Histórico.</p>` : ""}</details>`;
  wireRows(box);
}

let filtroSt = "Todas";
export function renderHist() {
  const box = $("#hist-list");
  $("#hist-filtro").innerHTML = ["Todas", ...STATUS].map((s) => `<label><input type="radio" name="hf" value="${s}" ${s === filtroSt ? "checked" : ""}> ${s}</label>`).join("");
  $("#hist-filtro").querySelectorAll("input").forEach((i) => (i.onchange = () => { filtroSt = i.value; renderHist(); }));
  if (!S.histLoaded) { box.innerHTML = `<div class="status">${S.histErr ? esc(S.histErr) : "Carregando histórico…"}</div>`; return; }
  const q = $("#hist-busca").value.trim().toLowerCase(), qd = q.replace(/\D/g, "");
  const groups = new Map();
  for (const h of S.hist) {
    if (!groups.has(h.fone)) groups.set(h.fone, []);
    groups.get(h.fone).push(h);
  }
  const gs = [...groups.entries()].filter(([f, l]) => {
    if (filtroSt !== "Todas" && l[0].status !== filtroSt) return false;
    if (!q) return true;
    return (qd.length >= 3 && f.includes(qd)) || l.some((h) => (h.cliente || "").toLowerCase().includes(q));
  });
  $("#hist-count").textContent = `${groups.size} ${groups.size === 1 ? "cliente" : "clientes"} · ${S.hist.length} ${S.hist.length === 1 ? "cotação" : "cotações"}`;
  if (!S.hist.length) { box.innerHTML = `<div class="status">Nenhuma cotação salva ainda. Monte uma cotação com o WhatsApp do cliente e clique em <b>Copiar mensagem</b>: ela aparece aqui.</div>`; return; }
  if (!gs.length) { box.innerHTML = `<div class="status">Nenhum cliente encontrado.</div>`; return; }
  // Mantém abertos os clientes que já estavam abertos ao redesenhar a lista.
  const abertos = new Set([...box.querySelectorAll("details.hg[open]")].map((d) => d.dataset.fone));
  box.innerHTML = gs.map(([f, l]) => {
    const nome = l.find((h) => h.cliente)?.cliente || "Sem nome";
    return `<details class="hg" data-fone="${esc(f)}" ${abertos.has(f) ? "open" : ""}><summary><span class="hg-name">${esc(nome)}</span><span class="hg-meta">${fmtFone(f)} · ${l.length} ${l.length === 1 ? "cotação" : "cotações"} · última em ${fmtData(l[0].criadoEm)}</span><span class="pill ${stClass(l[0].status)}">${esc(l[0].status || "Enviada")}</span></summary>
      <div class="cat" style="margin-top:10px"><div class="actions"><a class="btn" href="${esc(linkConversaDireta(f, "", navigator.userAgent))}" target="_blank" rel="noopener">Abrir conversa no WhatsApp</a></div>${l.map((h) => quoteRow(h, true)).join("")}</div></details>`;
  }).join("");
  wireRows(box);
}

export function iniciarHistorico() {
  $("#hist-busca").addEventListener("input", renderHist);
}
