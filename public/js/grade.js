// Peças comuns das grades (Aceites, Contratos Vendidos e Histórico): cards por situação, cabeçalho que ordena,
// páginas, quantidade por página guardada no navegador e botões de ícone.
import { esc } from "./estado.js";

export const POR_PAGINA = [10, 25, 50, 100];

const ICONES = {
  whatsapp: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9 10h.01M12 10h.01M15 10h.01"/>',
  documentos: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  enviada: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  excluir: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M10 11v6M14 11v6"/>',
  editar: '<path d="M12 20h9"/><path d="M16.4 3.6a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/>',
  contato: '<path d="M20 6 9 17l-5-5"/>',
  desfazer: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  ver: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  reabrir: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  contrato: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  calculadora: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h4"/>',
};

export const icone = (nome) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[nome]}</svg>`;

// Botão de ícone com dica; "numero" aparece num selo no canto (ex.: quantidade de documentos).
export function botaoIcone(nome, dica, { atributos = "", classe = "", numero = 0, href = "" } = {}) {
  const selo = numero ? `<span class="grade-num">${numero}</span>` : "";
  if (href) return `<a class="grade-ico ${classe}" href="${esc(href)}" target="_blank" rel="noopener" title="${esc(dica)}" aria-label="${esc(dica)}" ${atributos}>${icone(nome)}${selo}</a>`;
  return `<button type="button" class="grade-ico ${classe}" title="${esc(dica)}" aria-label="${esc(dica)}" ${atributos}>${icone(nome)}${selo}</button>`;
}

// Cards com a quantidade de cada situação; o ativo fica marcado. Clicar no ativo volta para "todos".
export function desenharCards(caixa, itens, ativo, aoEscolher) {
  caixa.innerHTML = itens.map((s) =>
    `<button type="button" class="grade-card" data-chave="${esc(s.chave)}" aria-pressed="${ativo === s.chave}"><b>${s.qtd}</b><span>${esc(s.rotulo)}</span></button>`).join("");
  caixa.querySelectorAll("[data-chave]").forEach((b) => (b.onclick = () => aoEscolher(ativo === b.dataset.chave && b.dataset.chave !== "todos" ? "todos" : b.dataset.chave)));
}

// Ordena pela coluna escolhida; o desempate mantém uma ordem estável e previsível.
export function ordenarPor(lista, colunas, ordem, desempate = () => 0) {
  const col = colunas.find((c) => c.campo === ordem.campo) ?? colunas[0];
  const sinal = ordem.dir === "asc" ? 1 : -1;
  return [...lista].sort((x, y) => {
    const a = col.valor(x), b = col.valor(y);
    const r = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "pt-BR");
    return r * sinal || desempate(x, y);
  });
}

// Texto começa de A a Z; número e data começam do maior.
export const proximaOrdem = (ordem, campo, colunas) => {
  if (ordem.campo === campo) return { campo, dir: ordem.dir === "asc" ? "desc" : "asc" };
  return { campo, dir: colunas.find((c) => c.campo === campo)?.desc ? "desc" : "asc" };
};

export function cabecalho(colunas, ordem, comAcoes = true) {
  return `<thead><tr>${colunas.map((c) => {
    const ativa = ordem.campo === c.campo;
    const seta = ativa ? (ordem.dir === "asc" ? "▲" : "▼") : "▲▼";
    return `<th class="${c.dir ? "dir" : ""}" aria-sort="${ativa ? (ordem.dir === "asc" ? "ascending" : "descending") : "none"}"><button type="button" class="grade-ordem" data-ordem="${c.campo}"${ativa ? " data-ativa" : ""} title="Ordenar por ${esc(c.rotulo.toLowerCase())}">${esc(c.rotulo)} <i aria-hidden="true">${seta}</i></button></th>`;
  }).join("")}${comAcoes ? `<th class="dir">Ações</th>` : ""}</tr></thead>`;
}

// Recorta a página atual; a página volta para dentro do limite quando a lista encolhe.
export function paginar(lista, pagina, porPagina) {
  const total = Math.max(1, Math.ceil(lista.length / porPagina));
  const atual = Math.min(Math.max(1, pagina), total);
  const inicio = (atual - 1) * porPagina;
  return { pagina: atual, total, inicio, itens: lista.slice(inicio, inicio + porPagina), quantos: lista.length };
}

// Números das páginas: a primeira, a última e as vizinhas da atual, com "…" no meio.
function numeros(pagina, total) {
  const lista = [...new Set([1, total, pagina - 1, pagina, pagina + 1])].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const saida = [];
  lista.forEach((p, i) => { if (i && p - lista[i - 1] > 1) saida.push(null); saida.push(p); });
  return saida;
}

export function desenharPaginacao(nav, pag, [um, varios], aoMudar) {
  if (!pag.quantos) { nav.innerHTML = ""; return; }
  nav.innerHTML = `<span class="note">${pag.inicio + 1}–${pag.inicio + pag.itens.length} de ${pag.quantos} ${pag.quantos === 1 ? um : varios}</span>
    ${pag.total > 1 ? `<div class="grade-paginas">
      <button type="button" class="btn" data-pagina="${pag.pagina - 1}" ${pag.pagina === 1 ? "disabled" : ""} aria-label="Página anterior">‹ Anterior</button>
      ${numeros(pag.pagina, pag.total).map((p) => p === null ? `<span class="reticencias">…</span>` : `<button type="button" class="btn" data-pagina="${p}"${p === pag.pagina ? ` aria-current="page"` : ""} aria-label="Página ${p}">${p}</button>`).join("")}
      <button type="button" class="btn" data-pagina="${pag.pagina + 1}" ${pag.pagina === pag.total ? "disabled" : ""} aria-label="Próxima página">Próxima ›</button>
    </div>` : ""}`;
  nav.querySelectorAll("[data-pagina]").forEach((b) => (b.onclick = () => aoMudar(Number(b.dataset.pagina))));
}

export function lerPorPagina(chave) {
  try {
    const v = Number(localStorage.getItem(chave));
    return POR_PAGINA.includes(v) ? v : 10;
  } catch {
    return 10;
  }
}

export function guardarPorPagina(chave, n) {
  try { localStorage.setItem(chave, String(n)); } catch {}
}

// Opções do seletor "Por página".
export const opcoesPorPagina = () => POR_PAGINA.map((n) => `<option value="${n}">${n} por página</option>`).join("");
