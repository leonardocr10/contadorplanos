// Menu Financeiro: "Regras de pagamento" (corretoras e as regras de comissão de cada uma) e
// "Comissões" (a comissão de cada contrato vendido, pela regra escolhida).
import { brl, parseBRL } from "./calculo.js";
import { $, S, api, avisoCentral, esc, pode, toast } from "./estado.js";
import { normalizar } from "./filtro-select.js";
import { calcularComissao, CATEGORIA_DO_SEGMENTO, MAX_PARCELAS, parcelaDe, rotuloDoSegmento, SEGMENTOS, totalDaRegra } from "./comissao.js";
import { botaoIcone, cabecalho, desenharCards, desenharPaginacao, guardarPorPagina, lerPorPagina, ordenarPor, paginar, proximaOrdem } from "./grade.js";

let corretoras = [], contratos = [], carregado = false, erro = null;
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const nomeDoMes = (aaaamm) => `${MESES[Number(aaaamm.slice(5, 7)) - 1]} de ${aaaamm.slice(0, 4)}`;
const fmtDia = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
const pct = (n) => `${String(Math.round(n * 100) / 100).replace(".", ",")}%`;
const edita = () => pode("financeiro", "editar");
let mapaDeRegras = { de: null, mapa: new Map() };
const regraPorId = () => {
  if (mapaDeRegras.de !== corretoras) mapaDeRegras = { de: corretoras, mapa: new Map(corretoras.flatMap((c) => c.regras.map((r) => [r.id, { ...r, corretora: c.nome }]))) };
  return mapaDeRegras.mapa;
};

export async function carregarFinanceiro() {
  if (!pode("financeiro")) return;
  try {
    const [cs, ks] = await Promise.all([api("/api/financeiro/corretoras"), pode("contratos") ? api("/api/contratos") : []]);
    corretoras = cs;
    contratos = ks;
    carregado = true;
    erro = null;
  } catch (e) {
    erro = e.message;
  }
  // A corretora aberta que deixou de existir volta para a lista.
  if (!corretoras.some((c) => c.id === corretoraAtual)) corretoraAtual = null;
  renderRegras();
  renderComissoes();
}

/* =================== Regras de pagamento =================== */
let corretoraAtual = null;
const CHAVE_PP_REGRAS = "cotador.regras.porPagina";
let buscaRegra = "", filtroSeg = "todos", paginaRegra = 1, ordemRegra = { campo: "ordem", dir: "asc" }, porPaginaRegra = lerPorPagina(CHAVE_PP_REGRAS);
let editandoRegra = null, excluindoRegra = null, formRegraAberto = false;

const GRUPOS = SEGMENTOS.map((s) => [s, rotuloDoSegmento(s)]);
const POSICOES = Array.from({ length: MAX_PARCELAS }, (_, i) => i);
const nomeDaCorretora = (r) => corretoras.find((c) => c.id === r.corretoraId)?.nome ?? "";
const COLUNAS_REGRAS = [
  { campo: "corretora", rotulo: "Corretora", valor: (r) => normalizar(nomeDaCorretora(r)) },
  { campo: "nome", rotulo: "Operadora", valor: (r) => normalizar(r.nome) },
  { campo: "segmento", rotulo: "Segmento", valor: (r) => normalizar(rotuloDoSegmento(r.segmento)) },
  { campo: "angariacao", rotulo: "Angariação", valor: (r) => r.angariacao, dir: true, desc: true },
  ...POSICOES.map((i) => ({ campo: `p${i}`, rotulo: `${i + 1}ª parc.`, valor: (r) => parcelaDe(r, i), dir: true, desc: true })),
  { campo: "total", rotulo: "Total", valor: (r) => totalDaRegra(r), dir: true, desc: true },
];

const opcoesSegmento = (atual) => SEGMENTOS.map((s) => `<option value="${esc(s)}"${s === atual ? " selected" : ""}>${esc(rotuloDoSegmento(s))}</option>`).join("");
const numeroBR = (n) => (n ? String(n).replace(".", ",") : "");

// Planos cadastrados no sistema para o segmento (Pessoa física: planos PF; PME: planos CNPJ), com busca.
// O plano que a regra já tem entra como opção, para a edição não perdê-lo se ele saiu da lista.
function opcoesDePlano(segmento, atual = "", multiplo = false) {
  const nomes = [...new Set((S.plans ?? []).filter((p) => p.categoria === CATEGORIA_DO_SEGMENTO[segmento]).map((p) => p.nome))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const opcao = (n) => `<option value="${esc(n)}"${n === atual ? " selected" : ""}>${esc(n)}</option>`;
  return (multiplo ? "" : `<option value="">Selecionar plano</option>`)
    + (atual && !nomes.includes(atual) ? `<optgroup label="Plano da regra">${opcao(atual)}</optgroup>` : "")
    + (nomes.length ? `<optgroup label="Planos ${esc(rotuloDoSegmento(segmento) === "PME" ? "PME (CNPJ)" : rotuloDoSegmento(segmento))}">${nomes.map(opcao).join("")}</optgroup>` : "");
}

// Campos de uma regra (cadastro no topo e edição na linha): segmento, plano, angariação, 4 parcelas e observação.
// No cadastro, dá para marcar vários planos: a mesma regra é criada para cada um.
function camposDaRegra(pref, r = {}, { multiplo = false } = {}) {
  const segmento = SEGMENTOS.includes(r.segmento) ? r.segmento : "PF";
  return `<div class="field fin-seg"><label for="${pref}-segmento">Segmento</label><select id="${pref}-segmento" data-campo="segmento">${opcoesSegmento(segmento)}</select></div>
    <div class="field fin-nome"><label for="${pref}-nome">${multiplo ? "Operadoras (pode marcar mais de uma)" : "Operadora"}</label><select id="${pref}-nome" data-campo="nome" data-plano-regra data-busca="Buscar plano…" data-contagem="plano|planos"${multiplo ? ` multiple data-vazio="Selecionar planos"` : ""}>${opcoesDePlano(segmento, r.nome ?? "", multiplo)}</select></div>
    <div class="field fin-obs"><label for="${pref}-observacao">Observação</label><input id="${pref}-observacao" data-campo="observacao" type="text" maxlength="300" placeholder="Opcional" value="${esc(r.observacao ?? "")}"></div>
    <div class="field fin-parcela fin-ang"${segmento === "PF" ? "" : " hidden"}><label for="${pref}-angariacao" title="Só para Pessoa física: porcentagem sobre a mensalidade, paga no ato da venda">Angariação (%)</label><input id="${pref}-angariacao" data-campo="angariacao" type="text" inputmode="decimal" placeholder="0" value="${esc(numeroBR(r.angariacao))}"></div>
    ${POSICOES.map((i) => `<div class="field fin-parcela"><label for="${pref}-p${i}" title="Porcentagem sobre a mensalidade, paga no ${i + 1}º mês a partir da ativação">${i + 1}ª parcela (%)</label><input id="${pref}-p${i}" data-parcela="${i}" type="text" inputmode="decimal" placeholder="0" value="${esc(numeroBR(parcelaDe(r, i)))}"></div>`).join("")}`;
}

function lerCamposDaRegra(form) {
  const v = (c) => form.querySelector(`[data-campo="${c}"]`).value;
  const parcelas = POSICOES.map((i) => {
    const t = form.querySelector(`[data-parcela="${i}"]`).value.replace("%", "").trim();
    if (!t) return 0;
    const n = parseBRL(t);
    if (n == null || n < 0 || n > 1000) throw new Error(`Porcentagem da ${i + 1}ª parcela inválida.`);
    return n;
  });
  while (parcelas.length && !parcelas.at(-1)) parcelas.pop();
  // A angariação só vale para Pessoa física.
  const ta = v("segmento") === "PF" ? v("angariacao").replace("%", "").trim() : "";
  const angariacao = ta ? parseBRL(ta) : 0;
  if (angariacao == null || angariacao < 0 || angariacao > 1000) throw new Error("Porcentagem da angariação inválida.");
  const sel = form.querySelector("[data-campo=nome]");
  const nomes = sel.multiple ? [...sel.selectedOptions].map((o) => o.value) : [sel.value.trim()];
  return { nome: nomes[0] ?? "", nomes, segmento: v("segmento"), angariacao, parcelas, observacao: v("observacao").trim() };
}
// O que vai para o servidor: uma regra por plano marcado.
const regrasDoForm = ({ nomes, ...regra }) => nomes.map((nome) => ({ ...regra, nome }));

// Troca a lista de planos quando o segmento muda, mantendo o plano escolhido se ele continuar na lista.
function trocarPlanos(form) {
  const sel = form.querySelector("[data-plano-regra]"), seg = form.querySelector("[data-campo=segmento]").value;
  const marcados = new Set([...sel.selectedOptions].map((o) => o.value)), original = sel.dataset.original ?? "";
  const html = opcoesDePlano(seg, original, sel.multiple);
  if (sel.dataset.html === html) return;
  sel.innerHTML = html;
  sel.dataset.html = html;
  for (const o of sel.options) o.selected = marcados.has(o.value);
  if (!sel.multiple && !sel.selectedOptions.length) sel.value = "";
  sel.dispatchEvent(new Event("change"));
}

// Os planos chegam do servidor depois da tela: as listas abertas se atualizam quando chegam ou mudam.
export function atualizarPlanosDaRegra() {
  document.querySelectorAll("#reg-form, [data-form-regra]").forEach((f) => f.querySelector("[data-plano-regra]") && trocarPlanos(f));
}

// Trocar o segmento troca a lista de planos e mostra a angariação só para pessoa física.
function ligarSegmento(form) {
  const seg = form.querySelector("[data-campo=segmento]"), plano = form.querySelector("[data-plano-regra]");
  plano.dataset.original ??= plano.multiple ? "" : plano.value;
  seg.addEventListener("change", () => { trocarPlanos(form); form.querySelector(".fin-ang").hidden = seg.value !== "PF"; });
}

function linhaDaRegra(r) {
  const acoes = edita() ? [
    botaoIcone("editar", "Editar regra", { atributos: `data-editar-regra aria-expanded="${editandoRegra === r.id}"` }),
    botaoIcone("excluir", "Excluir regra", { atributos: `data-excluir-regra aria-expanded="${excluindoRegra === r.id}"`, classe: "perigo" }),
  ].join("") : "";
  const paineis = [
    editandoRegra === r.id ? `<form class="fin-form" data-form-regra="${esc(r.id)}" novalidate>${camposDaRegra("fin-ed", r)}<div class="actions fin-botoes"><button class="btn primary" type="submit">Salvar</button><button class="btn" type="button" data-cancelar-regra>Cancelar</button></div></form>` : "",
    excluindoRegra === r.id ? `<div class="status" data-confirma>Excluir a regra <b>${esc(r.nome)} (${esc(rotuloDoSegmento(r.segmento))})</b>? Os contratos que usam esta regra ficam sem regra. <span class="actions" style="margin-top:8px"><button class="btn danger" data-sim-regra>Sim, excluir</button><button class="btn" data-nao-regra>Manter</button></span></div>` : "",
  ].join("");
  return `<tr class="grade-linha" data-regra="${esc(r.id)}">
      <td><div class="grade-plano" title="${esc(nomeDaCorretora(r))}">${esc(nomeDaCorretora(r))}</div></td>
      <td><div class="grade-nome" title="${esc(r.nome)}">${esc(r.nome)}</div>${r.observacao ? `<div class="note fin-obs-linha" title="${esc(r.observacao)}">${esc(r.observacao)}</div>` : ""}</td>
      <td><span class="pill st-env">${esc(rotuloDoSegmento(r.segmento))}</span></td>
      <td class="dir">${r.segmento === "PF" && r.angariacao ? pct(r.angariacao) : "—"}</td>
      ${POSICOES.map((i) => `<td class="dir">${parcelaDe(r, i) ? pct(parcelaDe(r, i)) : "—"}</td>`).join("")}
      <td class="dir"><b>${pct(totalDaRegra(r))}</b></td>
      ${edita() ? `<td><div class="grade-acoes">${acoes}</div></td>` : ""}
    </tr>${paineis ? `<tr class="grade-painel-linha" data-regra="${esc(r.id)}"><td colspan="${COLUNAS_REGRAS.length + (edita() ? 1 : 0)}">${paineis}</td></tr>` : ""}`;
}

/* ---------- Tela 1: lista das corretoras ---------- */
let buscaCor = "", ordemCor = { campo: "nome", dir: "asc" }, renomeandoCor = null, excluindoCor = null;
const COLUNAS_COR = [
  { campo: "nome", rotulo: "Corretora", valor: (c) => normalizar(c.nome) },
  { campo: "regras", rotulo: "Regras", valor: (c) => c.regras.length, dir: true, desc: true },
  { campo: "pf", rotulo: "Pessoa física", valor: (c) => c.regras.filter((r) => r.segmento === "PF").length, dir: true, desc: true },
  { campo: "pme", rotulo: "PME", valor: (c) => c.regras.filter((r) => r.segmento === "PME").length, dir: true, desc: true },
];

// Abre a tela das regras de uma corretora; com "novaRegra", já com o cadastro aberto.
function abrirCorretora(id, { novaRegra = false } = {}) {
  corretoraAtual = id;
  formRegraAberto = novaRegra && edita();
  buscaRegra = ""; $("#reg-busca").value = ""; filtroSeg = "todos"; paginaRegra = 1; editandoRegra = excluindoRegra = null;
  $("#reg-acao").hidden = true;
  renderRegras();
  $("#v-regras").scrollIntoView({ block: "start" });
  if (formRegraAberto) $("#reg-form [data-campo=segmento]").focus();
}

function linhaDaCorretora(c, colunas) {
  const qtd = (s) => c.regras.filter((r) => r.segmento === s).length;
  const acoes = [
    edita() ? `<button type="button" class="btn fin-btn-linha" data-nova-regra-cor title="Cadastrar uma regra de comissão para ${esc(c.nome)}">Nova regra</button>` : "",
    botaoIcone("ver", "Abrir as regras desta corretora", { atributos: "data-abrir-cor" }),
    edita() ? botaoIcone("editar", "Renomear corretora", { atributos: `data-renomear-cor aria-expanded="${renomeandoCor === c.id}"` }) : "",
    edita() ? botaoIcone("excluir", "Excluir corretora", { atributos: `data-excluir-cor aria-expanded="${excluindoCor === c.id}"`, classe: "perigo" }) : "",
  ].join("");
  const painel = renomeandoCor === c.id
    ? `<form class="fin-acao" data-form-renomear novalidate><div class="field"><label for="cor-ren-nome">Novo nome da corretora</label><input id="cor-ren-nome" type="text" maxlength="120" value="${esc(c.nome)}"></div><div class="actions"><button type="submit" class="btn primary">Salvar</button><button type="button" class="btn" data-cancelar-cor>Cancelar</button></div></form>`
    : excluindoCor === c.id
      ? `<div class="status">Excluir a corretora <b>${esc(c.nome)}</b> e as ${c.regras.length} regras dela? Os contratos que usam essas regras ficam sem regra. <span class="actions" style="margin-top:8px"><button class="btn danger" data-sim-cor>Sim, excluir</button><button class="btn" data-cancelar-cor>Manter</button></span></div>`
      : "";
  return `<tr class="grade-linha fin-linha-cor" data-cor="${esc(c.id)}" title="Clique para abrir as regras de ${esc(c.nome)}">
      <td><div class="grade-nome">${esc(c.nome)}</div></td>
      <td class="dir"><b>${c.regras.length}</b></td>
      <td class="dir">${qtd("PF")}</td>
      <td class="dir">${qtd("PME")}</td>
      <td><div class="grade-acoes">${acoes}</div></td>
    </tr>${painel ? `<tr class="grade-painel-linha" data-cor="${esc(c.id)}"><td colspan="${colunas.length + 1}">${painel}</td></tr>` : ""}`;
}

function renderCorretoras() {
  const box = $("#cor-lista");
  if (!carregado) { box.innerHTML = `<div class="status">${erro ? esc(erro) : "Carregando corretoras…"}</div>`; return; }
  if (!corretoras.length) { box.innerHTML = `<div class="status">Nenhuma corretora cadastrada. ${edita() ? "Clique em <b>Nova corretora</b> para começar." : ""}</div>`; return; }
  const termo = normalizar(buscaCor.trim());
  const lista = ordenarPor(corretoras.filter((c) => !termo || normalizar(c.nome).includes(termo)), COLUNAS_COR, ordemCor, (x, y) => x.nome.localeCompare(y.nome, "pt-BR"));
  box.innerHTML = lista.length
    ? `<div class="grade-rolagem"><table class="grade-tabela fin-tabela">${cabecalho(COLUNAS_COR, ordemCor, true)}<tbody>${lista.map((c) => linhaDaCorretora(c, COLUNAS_COR)).join("")}</tbody></table></div>`
    : `<div class="status">Nenhuma corretora encontrada com essa busca.</div>`;
  box.querySelectorAll("[data-ordem]").forEach((b) => (b.onclick = () => { ordemCor = proximaOrdem(ordemCor, b.dataset.ordem, COLUNAS_COR); renderCorretoras(); }));
  const daLinha = (el) => corretoras.find((c) => c.id === el.closest("[data-cor]").dataset.cor);
  // Clicar na linha (fora dos botões) abre a corretora.
  box.querySelectorAll("tr.fin-linha-cor").forEach((tr) => (tr.onclick = (e) => { if (!e.target.closest("button,a,input,form")) abrirCorretora(tr.dataset.cor); }));
  box.querySelectorAll("[data-abrir-cor]").forEach((b) => (b.onclick = () => abrirCorretora(daLinha(b).id)));
  box.querySelectorAll("[data-nova-regra-cor]").forEach((b) => (b.onclick = () => abrirCorretora(daLinha(b).id, { novaRegra: true })));
  box.querySelectorAll("[data-renomear-cor]").forEach((b) => (b.onclick = () => { const c = daLinha(b); renomeandoCor = renomeandoCor === c.id ? null : c.id; excluindoCor = null; renderCorretoras(); box.querySelector("#cor-ren-nome")?.select(); }));
  box.querySelectorAll("[data-excluir-cor]").forEach((b) => (b.onclick = () => { const c = daLinha(b); excluindoCor = excluindoCor === c.id ? null : c.id; renomeandoCor = null; renderCorretoras(); }));
  box.querySelectorAll("[data-cancelar-cor]").forEach((b) => (b.onclick = () => { renomeandoCor = excluindoCor = null; renderCorretoras(); }));
  box.querySelectorAll("[data-sim-cor]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { await api(`/api/financeiro/corretoras/${encodeURIComponent(daLinha(b).id)}`, { metodo: "DELETE" }); excluindoCor = null; await carregarFinanceiro(); avisoCentral("Corretora excluída com sucesso"); } catch (e) { b.disabled = false; toast(e.message, "erro"); }
  }));
  const ren = box.querySelector("[data-form-renomear]");
  if (ren) ren.onsubmit = async (e) => {
    e.preventDefault();
    const nome = ren.querySelector("input").value.trim();
    if (!nome) { toast("Informe o nome da corretora", "erro"); return; }
    try { await api(`/api/financeiro/corretoras/${encodeURIComponent(daLinha(ren).id)}`, { metodo: "PUT", json: { nome } }); renomeandoCor = null; await carregarFinanceiro(); avisoCentral("Corretora renomeada com sucesso"); } catch (erro) { toast(erro.message, "erro"); }
  };
}

/* ---------- Tela 2: regras da corretora aberta ---------- */
export function renderRegras() {
  if (!pode("financeiro")) return;
  const c = corretoras.find((x) => x.id === corretoraAtual);
  $("#reg-tela-corretoras").hidden = !!c;
  $("#reg-tela-regras").hidden = !c;
  if (!c) { formRegraAberto = false; renderCorretoras(); return; }
  $("#reg-titulo").textContent = `Regras de ${c.nome}`;
  // O cadastro de regra só aparece ao clicar em "Nova regra".
  $("#reg-nova-regra").setAttribute("aria-expanded", String(formRegraAberto));
  $("#reg-form-bloco").hidden = !edita() || !formRegraAberto;
  if ($("#reg-form-bloco").hidden === false) $("#reg-form-titulo").textContent = `Nova regra para ${c.nome}`;
  const regras = c?.regras ?? [];
  const quantos = (g) => regras.filter((r) => r.segmento === g).length;
  const selSeg = $("#reg-filtro");
  const opSeg = `<option value="todos" data-icone="todos">Todos os segmentos</option><optgroup label="Segmentos">${GRUPOS.map(([g, rotulo]) => `<option value="${g}" data-selo="${quantos(g)}">${rotulo}</option>`).join("")}</optgroup>`;
  if (selSeg.dataset.opcoes !== opSeg) { selSeg.innerHTML = opSeg; selSeg.dataset.opcoes = opSeg; }
  selSeg.value = filtroSeg;
  $("#reg-por-pagina").value = String(porPaginaRegra);
  $("#reg-limpar").disabled = filtroSeg === "todos" && !buscaRegra.trim();

  const box = $("#reg-lista"), nav = $("#reg-paginacao");
  if (!carregado) { box.innerHTML = `<div class="status">${erro ? esc(erro) : "Carregando regras…"}</div>`; nav.innerHTML = ""; return; }
  const termo = normalizar(buscaRegra.trim());
  const filtradas = regras.filter((r) => (filtroSeg === "todos" || r.segmento === filtroSeg) && (!termo || normalizar(`${r.nome} ${rotuloDoSegmento(r.segmento)} ${r.observacao}`).includes(termo)));
  const posicao = new Map(regras.map((r, i) => [r.id, i]));
  const colunas = [...COLUNAS_REGRAS];
  const lista = ordemRegra.campo === "ordem" ? filtradas : ordenarPor(filtradas, colunas, ordemRegra, (x, y) => posicao.get(x.id) - posicao.get(y.id));
  const pag = paginar(lista, paginaRegra, porPaginaRegra);
  paginaRegra = pag.pagina;
  box.innerHTML = pag.quantos
    ? `<div class="grade-rolagem"><table class="grade-tabela fin-tabela fin-tabela-regras">${cabecalho(colunas, ordemRegra, edita())}<tbody>${pag.itens.map(linhaDaRegra).join("")}</tbody></table></div>`
    : `<div class="status">${regras.length ? "Nenhuma regra encontrada com esses filtros." : "Esta corretora ainda não tem regras."}</div>`;
  desenharPaginacao(nav, pag, ["regra", "regras"], (p) => { paginaRegra = p; renderRegras(); box.scrollIntoView({ block: "nearest" }); });
  box.querySelectorAll("[data-ordem]").forEach((b) => (b.onclick = () => { ordemRegra = proximaOrdem(ordemRegra, b.dataset.ordem, colunas); paginaRegra = 1; renderRegras(); }));

  const daLinha = (el) => regras.find((r) => r.id === el.closest("[data-regra]").dataset.regra);
  box.querySelectorAll("[data-editar-regra]").forEach((b) => (b.onclick = () => { const r = daLinha(b); editandoRegra = editandoRegra === r.id ? null : r.id; excluindoRegra = null; renderRegras(); }));
  box.querySelectorAll("[data-excluir-regra]").forEach((b) => (b.onclick = () => { const r = daLinha(b); excluindoRegra = excluindoRegra === r.id ? null : r.id; editandoRegra = null; renderRegras(); }));
  box.querySelectorAll("[data-nao-regra]").forEach((b) => (b.onclick = () => { excluindoRegra = null; renderRegras(); }));
  box.querySelectorAll("[data-sim-regra]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try {
      await api(`/api/financeiro/regras/${encodeURIComponent(daLinha(b).id)}`, { metodo: "DELETE" });
      excluindoRegra = null;
      await carregarFinanceiro();
      avisoCentral("Regra excluída com sucesso");
    } catch (e) { b.disabled = false; toast(e.message, "erro"); }
  }));
  const form = box.querySelector("[data-form-regra]");
  if (form) {
    ligarSegmento(form);
    form.querySelector("[data-cancelar-regra]").onclick = () => { editandoRegra = null; renderRegras(); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const { nomes, ...regra } = lerCamposDaRegra(form);
        await api(`/api/financeiro/regras/${encodeURIComponent(form.dataset.formRegra)}`, { metodo: "PUT", json: regra });
        editandoRegra = null;
        await carregarFinanceiro();
        avisoCentral("Regra salva com sucesso");
      } catch (erro) { toast(`Não deu para salvar: ${erro.message}`, "erro"); }
    };
  }
}

// Faixa abaixo de "Nova corretora": o nome da corretora nova. Ela entra na lista.
function abrirNovaCorretora() {
  const caixa = $("#reg-acao");
  const fechar = () => { caixa.hidden = true; caixa.innerHTML = ""; };
  caixa.innerHTML = `<form class="fin-acao-form" style="display:contents" novalidate>
      <div class="field"><label for="reg-acao-nome">Nome da nova corretora</label><input id="reg-acao-nome" type="text" maxlength="120" placeholder="Ex.: Corretora PJ"></div>
      <div class="actions"><button type="submit" class="btn primary">Cadastrar corretora</button><button type="button" class="btn" data-nao>Cancelar</button></div>
    </form>`;
  caixa.hidden = false;
  const campo = caixa.querySelector("input");
  campo.focus();
  caixa.querySelector("[data-nao]").onclick = fechar;
  caixa.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const nome = campo.value.trim();
    if (!nome) { toast("Informe o nome da corretora", "erro"); campo.focus(); return; }
    try {
      await api("/api/financeiro/corretoras", { metodo: "POST", json: { nome } });
      fechar();
      await carregarFinanceiro();
      avisoCentral("Corretora cadastrada com sucesso");
    } catch (erro) { toast(erro.message, "erro"); }
  };
}

/* =================== Comissões =================== */
const CHAVE_PP_COM = "cotador.comissoes.porPagina";
let buscaCom = "", filtroCom = "todos", corretoraCom = "todas", mesCom = "todos", paginaCom = 1, ordemCom = { campo: "ativacao", dir: "desc" }, porPaginaCom = lerPorPagina(CHAVE_PP_COM);
let abertoCom = null, rascunho = null;

const COLUNAS_COM = [
  { campo: "nome", rotulo: "Cliente", valor: (x) => normalizar(x.c.nome) },
  { campo: "plano", rotulo: "Plano", valor: (x) => normalizar(x.c.plano) },
  { campo: "valor", rotulo: "Mensalidade", valor: (x) => x.c.valor, dir: true, desc: true },
  { campo: "regra", rotulo: "Regra", valor: (x) => (x.regra ? normalizar(`${x.regra.corretora} ${x.regra.nome}`) : "￿") },
  { campo: "ativacao", rotulo: "Ativação", valor: (x) => x.c.ativacao, desc: true },
  { campo: "comissao", rotulo: "Comissão", valor: (x) => x.comissao.total, dir: true, desc: true },
];

// Seletor da regra: agrupado por corretora, com busca.
// Regras do plano do contrato: a comparação do plano é feita antes, então cada opção mostra só a corretora
// (e o segmento, quando a mesma corretora tem regra de pessoa física e de PME para esse plano).
// Uma regra já escolhida de outro plano continua na lista, para não sumir.
function regrasDoPlano(plano) {
  return corretoras.flatMap((c) => c.regras.filter((r) => r.nome === plano).map((r) => ({ ...r, corretora: c.nome })));
}
function opcoesDeRegra(atual, plano = "") {
  const doPlano = regrasDoPlano(plano);
  const atualDeOutro = atual && !doPlano.some((r) => r.id === atual) ? regraPorId().get(atual) : null;
  const repetida = (r) => doPlano.filter((x) => x.corretoraId === r.corretoraId).length > 1;
  const opcao = (r, texto) => `<option value="${esc(r.id)}"${r.id === atual ? " selected" : ""}>${esc(texto)}</option>`;
  return `<option value="">${doPlano.length ? "Sem regra" : "Nenhuma regra para este plano"}</option>`
    + doPlano.map((r) => opcao(r, repetida(r) ? `${r.corretora} · ${rotuloDoSegmento(r.segmento)}` : r.corretora)).join("")
    + (atualDeOutro ? `<optgroup label="Regra de outro plano">${opcao(atualDeOutro, `${atualDeOutro.corretora} · ${atualDeOutro.nome}`)}</optgroup>` : "");
}

function painelDaComissao(x) {
  const regras = regraPorId(), regra = regras.get(rascunho.regraId) ?? null;
  const conta = calcularComissao({ valor: x.c.valor, ativacao: x.c.ativacao, ajustes: rascunho.ajustes }, regra);
  const podeEditar = edita();
  const algumAjuste = conta.itens.some((i) => i.ajustado);
  // A regra é escolhida na linha da grade; aqui ficam o detalhamento e os ajustes, salvos ao mudar cada campo.
  return `<form class="fin-comissao" data-form-comissao novalidate>
    <div class="fin-com-cabecalho">
      ${regra ? `<p class="note" style="margin:0">${esc(regra.corretora)} · ${esc(regra.nome)} (${esc(rotuloDoSegmento(regra.segmento))})${regra.observacao ? ` · ${esc(regra.observacao)}` : ""}${podeEditar ? " · altere o percentual ou a data de um pagamento: salva na hora." : ""}</p>` : `<p class="note" style="margin:0">Escolha a regra na coluna Regra para calcular a comissão.</p>`}
      ${podeEditar && algumAjuste ? `<button class="btn" type="button" data-restaurar-comissao title="Volta os percentuais e as datas para o que a regra calcula">Voltar ao da regra</button>` : ""}
    </div>
    ${conta.itens.length ? `<div class="grade-rolagem"><table class="grade-tabela fin-detalhe"><thead><tr><th>Pagamento</th><th>Previsto para</th><th class="dir">Percentual</th><th class="dir">Base</th><th class="dir">Valor</th></tr></thead><tbody>
      ${conta.itens.map((i) => `<tr data-item="${i.chave}"${i.ajustado ? ' class="fin-ajustado"' : ""}><td>${esc(i.rotulo)}${i.ajustado ? ' <span class="ctr-sub" title="Alterado neste contrato">(alterado)</span>' : ""}</td>
        <td class="grade-data">${podeEditar ? `<input type="date" class="fin-aj-data" data-aj-data value="${esc(i.data)}" aria-label="Data prevista: ${esc(i.rotulo)}" title="Pela regra: ${esc(fmtDia(i.dataDaRegra))}">` : esc(fmtDia(i.data))}</td>
        <td class="dir">${podeEditar ? `<input type="text" inputmode="decimal" class="fin-aj-pct" data-aj-pct value="${esc(String(i.percentual).replace(".", ","))}" aria-label="Percentual: ${esc(i.rotulo)}" title="Pela regra: ${pct(i.percentualDaRegra)}"> %` : pct(i.percentual)}</td><td class="dir">R$ ${brl(i.base)} <span class="ctr-sub">(mensalidade)</span></td><td class="dir">R$ ${brl(i.valor)}</td></tr>`).join("")}
      <tr class="fin-total"><td colspan="4">Total da comissão</td><td class="dir">R$ ${brl(conta.total)}</td></tr>
    </tbody></table></div>` : ""}
  </form>`;
}

function linhaDaComissao(x) {
  const aberto = abertoCom === x.c.id;
  const regraTxt = x.regra ? (x.regra.nome === x.c.plano ? x.regra.corretora : `${x.regra.corretora} · ${x.regra.nome}`) : "";
  return `<tr class="grade-linha${x.regra ? "" : " grade-pendente"}" data-com="${esc(x.c.id)}">
      <td><div class="grade-nome" title="${esc(x.c.nome)}">${esc(x.c.nome)}</div></td>
      <td><div class="grade-plano" title="${esc(x.c.plano)}">${esc(x.c.plano)}</div></td>
      <td class="grade-valor dir">R$ ${brl(x.c.valor)}</td>
      <td class="fin-regra-celula">${edita()
        ? `<select data-regra-linha data-busca="Buscar corretora…" data-contagem="corretora|corretoras" aria-label="Regra de comissão de ${esc(x.c.nome)}" class="${x.regra ? "" : "fin-sem-regra"}">${opcoesDeRegra(x.c.regraId ?? "", x.c.plano)}</select>`
        : `<div class="grade-plano fin-regra" title="${esc(regraTxt)}">${x.regra ? esc(regraTxt) : `<span class="fin-falta">Sem regra</span>`}</div>`}</td>
      <td class="grade-data">${esc(fmtDia(x.c.ativacao))}</td>
      <td class="grade-valor dir"><b>${x.regra ? `R$ ${brl(x.comissao.total)}` : "—"}</b></td>
      <td><div class="grade-acoes">${botaoIcone("calculadora", edita() ? "Ver o cálculo da comissão e ajustar os pagamentos" : "Ver o cálculo da comissão", { atributos: `data-abrir-com aria-expanded="${aberto}"` })}</div></td>
    </tr>${aberto ? `<tr class="grade-painel-linha" data-com="${esc(x.c.id)}"><td colspan="${COLUNAS_COM.length + 1}">${painelDaComissao(x)}</td></tr>` : ""}`;
}

export function renderComissoes() {
  if (!pode("financeiro")) return;
  const regras = regraPorId();
  const linhas = contratos.map((c) => {
    const regra = c.regraId ? regras.get(c.regraId) ?? null : null;
    return { c, regra, comissao: calcularComissao(c, regra) };
  });
  // Filtros de corretora e mês valem para os cards também: eles mostram o total do que está na grade.
  const meses = [...new Set(contratos.map((c) => c.ativacao.slice(0, 7)))].sort().reverse();
  if (mesCom !== "todos" && !meses.includes(mesCom)) mesCom = "todos";
  const selMes = $("#com-mes");
  const opMes = `<option value="todos" data-icone="todos">Todos os meses</option>${meses.length ? `<optgroup label="Meses">${meses.map((m) => `<option value="${m}">${nomeDoMes(m)}</option>`).join("")}</optgroup>` : ""}`;
  if (selMes.dataset.opcoes !== opMes) { selMes.innerHTML = opMes; selMes.dataset.opcoes = opMes; }
  selMes.value = mesCom;
  if (corretoraCom !== "todas" && corretoraCom !== "sem" && !corretoras.some((c) => c.id === corretoraCom)) corretoraCom = "todas";
  const selCor = $("#com-corretora");
  const opCor = `<option value="todas" data-icone="todos">Todas as corretoras</option><option value="sem">Sem regra</option>${corretoras.length ? `<optgroup label="Corretoras">${corretoras.map((c) => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("")}</optgroup>` : ""}`;
  if (selCor.dataset.opcoes !== opCor) { selCor.innerHTML = opCor; selCor.dataset.opcoes = opCor; }
  selCor.value = corretoraCom;
  $("#com-por-pagina").value = String(porPaginaCom);
  $("#com-limpar").disabled = !buscaCom.trim() && filtroCom === "todos" && corretoraCom === "todas" && mesCom === "todos";

  const termo = normalizar(buscaCom.trim());
  const base = linhas.filter((x) =>
    (mesCom === "todos" || x.c.ativacao.startsWith(mesCom))
    && (corretoraCom === "todas" || (corretoraCom === "sem" ? !x.regra : x.regra?.corretoraId === corretoraCom))
    && (!termo || normalizar(`${x.c.nome} ${x.c.plano} ${x.regra?.nome ?? ""} ${x.regra?.corretora ?? ""}`).includes(termo)));
  // Comissão prevista: só os pagamentos com data prevista no mês atual (a angariação e as parcelas que caem nele).
  const hoje = new Date(), mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  const doMes = (x) => x.comissao.itens.filter((i) => i.data?.startsWith(mesAtual)).reduce((a, i) => a + i.valor, 0);
  const vendas = base.reduce((a, x) => a + x.c.valor, 0), comissao = Math.round(base.reduce((a, x) => a + doMes(x), 0) * 100) / 100, semRegra = base.filter((x) => !x.regra).length;
  desenharCards($("#com-cards"), [
    { chave: "todos", rotulo: `Total de vendas · ${base.length} ${base.length === 1 ? "contrato" : "contratos"}`, qtd: `R$ ${brl(vendas)}` },
    { chave: "com", rotulo: `Comissão prevista · ${nomeDoMes(mesAtual)}`, qtd: `R$ ${brl(comissao)}` },
    { chave: "sem", rotulo: "Contratos sem regra", qtd: semRegra },
  ], filtroCom, (chave) => { filtroCom = chave; paginaCom = 1; renderComissoes(); });
  $("#com-count").textContent = `${contratos.length} ${contratos.length === 1 ? "contrato" : "contratos"} · ${corretoras.length} ${corretoras.length === 1 ? "corretora" : "corretoras"}`;

  const box = $("#com-lista"), nav = $("#com-paginacao");
  if (!carregado) { box.innerHTML = `<div class="status">${erro ? esc(erro) : "Carregando comissões…"}</div>`; nav.innerHTML = ""; return; }
  if (!pode("contratos")) { box.innerHTML = `<div class="status">Para ver as comissões, peça ao administrador acesso à tela Contratos Vendidos.</div>`; nav.innerHTML = ""; return; }
  if (!contratos.length) { box.innerHTML = `<div class="status">Nenhum contrato vendido ainda. Os contratos de <b>Contratos Vendidos</b> aparecem aqui.</div>`; nav.innerHTML = ""; return; }
  const filtrados = base.filter((x) => filtroCom === "todos" || (filtroCom === "com" ? !!x.regra : !x.regra));
  const pag = paginar(ordenarPor(filtrados, COLUNAS_COM, ordemCom, (x, y) => y.c.ativacao.localeCompare(x.c.ativacao)), paginaCom, porPaginaCom);
  paginaCom = pag.pagina;
  box.innerHTML = pag.quantos
    ? `<div class="grade-rolagem"><table class="grade-tabela">${cabecalho(COLUNAS_COM, ordemCom)}<tbody>${pag.itens.map(linhaDaComissao).join("")}</tbody></table></div>`
    : `<div class="status">Nenhum contrato encontrado com esses filtros.</div>`;
  desenharPaginacao(nav, pag, ["contrato", "contratos"], (p) => { paginaCom = p; renderComissoes(); box.scrollIntoView({ block: "nearest" }); });
  box.querySelectorAll("[data-ordem]").forEach((b) => (b.onclick = () => { ordemCom = proximaOrdem(ordemCom, b.dataset.ordem, COLUNAS_COM); paginaCom = 1; renderComissoes(); }));
  const daLinha = (el) => linhas.find((x) => x.c.id === el.closest("[data-com]").dataset.com);
  // Trocar a regra na própria linha salva na hora; os ajustes da regra anterior saem.
  box.querySelectorAll("[data-regra-linha]").forEach((sel) => (sel.onchange = async () => {
    const x = daLinha(sel), regraId = sel.value || null;
    if (regraId === (x.c.regraId ?? null)) return;
    sel.disabled = true;
    try {
      const novo = await api(`/api/contratos/${encodeURIComponent(x.c.id)}/comissao`, { metodo: "PATCH", json: { regraId, ajustes: {} } });
      contratos = contratos.map((c) => (c.id === novo.id ? novo : c));
      if (abertoCom === novo.id) rascunho = { regraId: novo.regraId ?? "", ajustes: {} };
      renderComissoes();
      avisoCentral(regraId ? "Regra salva com sucesso" : "Contrato ficou sem regra");
    } catch (e) { sel.disabled = false; sel.value = x.c.regraId ?? ""; toast(`Não deu para salvar: ${e.message}`, "erro"); }
  }));
  box.querySelectorAll("[data-abrir-com]").forEach((b) => (b.onclick = () => {
    const x = daLinha(b);
    abertoCom = abertoCom === x.c.id ? null : x.c.id;
    rascunho = abertoCom ? { regraId: x.c.regraId ?? "", ajustes: structuredClone(x.c.ajustes ?? {}) } : null;
    renderComissoes();
  }));
  const form = box.querySelector("[data-form-comissao]");
  if (form) {
    const x = daLinha(form);
    // Os ajustes são salvos na hora; se o servidor recusar, a tela volta ao que estava salvo.
    const salvar = async () => {
      try {
        const novo = await api(`/api/contratos/${encodeURIComponent(x.c.id)}/comissao`, { metodo: "PATCH", json: { regraId: x.c.regraId || null, ajustes: rascunho.ajustes } });
        contratos = contratos.map((c) => (c.id === novo.id ? novo : c));
        if (abertoCom === novo.id) rascunho = { regraId: novo.regraId ?? "", ajustes: structuredClone(novo.ajustes ?? {}) };
        renderComissoes();
        avisoCentral("Comissão salva com sucesso");
      } catch (erro) {
        rascunho = { regraId: x.c.regraId ?? "", ajustes: structuredClone(x.c.ajustes ?? {}) };
        renderComissoes();
        toast(`Não deu para salvar: ${erro.message}`, "erro");
      }
    };
    // Percentual e data de cada linha: o que for igual ao da regra deixa de ser ajuste.
    const regraAberta = () => regraPorId().get(rascunho.regraId) ?? null;
    const ajustar = (chave, campo, valor) => {
      const item = calcularComissao({ valor: x.c.valor, ativacao: x.c.ativacao }, regraAberta()).itens.find((i) => i.chave === chave);
      const daRegra = campo === "data" ? item?.data : item?.percentual;
      const a = { ...(rascunho.ajustes[chave] ?? {}) };
      if (valor === "" || valor === null || valor === daRegra) delete a[campo]; else a[campo] = valor;
      if (Object.keys(a).length) rascunho.ajustes[chave] = a; else delete rascunho.ajustes[chave];
      salvar();
    };
    form.querySelectorAll("[data-aj-data]").forEach((el) => (el.onchange = () => ajustar(el.closest("[data-item]").dataset.item, "data", el.value)));
    form.querySelectorAll("[data-aj-pct]").forEach((el) => (el.onchange = () => {
      const t = el.value.replace("%", "").trim();
      const n = t ? parseBRL(t) : null;
      if (t && (n == null || n < 0 || n > 1000)) { toast("Percentual inválido.", "erro"); el.focus(); return; }
      ajustar(el.closest("[data-item]").dataset.item, "percentual", n);
    }));
    form.querySelectorAll("[data-aj-pct]").forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); el.dispatchEvent(new Event("change")); } }));
    form.querySelector("[data-restaurar-comissao]")?.addEventListener("click", () => { rascunho.ajustes = {}; salvar(); });
    form.onsubmit = (e) => e.preventDefault();
  }
}

/* =================== ligações da tela =================== */
export function iniciarFinanceiro() {
  // Regras
  $("#reg-nova").onclick = () => abrirNovaCorretora();
  $("#cor-busca").oninput = () => { buscaCor = $("#cor-busca").value; renderCorretoras(); };
  $("#reg-voltar").onclick = () => { corretoraAtual = null; renderRegras(); };
  const form = $("#reg-form");
  form.innerHTML = `${camposDaRegra("fin-nova", {}, { multiplo: true })}<div class="actions fin-botoes"><button class="btn primary" type="submit">Adicionar regra</button><button class="btn" type="button" data-fechar-nova>Fechar</button></div>`;
  ligarSegmento(form);
  $("#reg-nova-regra").onclick = () => {
    formRegraAberto = !formRegraAberto;
    renderRegras();
    if (formRegraAberto) { $("#reg-form-bloco").scrollIntoView({ block: "nearest" }); form.querySelector("[data-campo=segmento]").focus(); }
  };
  form.querySelector("[data-fechar-nova]").onclick = () => { formRegraAberto = false; renderRegras(); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const regras = regrasDoForm(lerCamposDaRegra(form));
      if (!regras.length || !regras[0].nome) { toast("Escolha ao menos um plano.", "erro"); return; }
      await api(`/api/financeiro/corretoras/${encodeURIComponent(corretoraAtual)}/regras`, { metodo: "POST", json: regras });
      const planos = form.querySelector("[data-campo=nome]");
      for (const o of planos.options) o.selected = false;
      planos.dispatchEvent(new Event("change"));
      form.querySelectorAll("[data-campo=angariacao],[data-campo=observacao],[data-parcela]").forEach((el) => (el.value = ""));
      avisoCentral(regras.length === 1 ? "Regra cadastrada com sucesso" : `${regras.length} regras cadastradas com sucesso`);
      await carregarFinanceiro();
    } catch (erro) { toast(`Não deu para cadastrar: ${erro.message}`, "erro"); }
  };
  $("#reg-busca").oninput = () => { buscaRegra = $("#reg-busca").value; paginaRegra = 1; renderRegras(); };
  $("#reg-filtro").onchange = () => { filtroSeg = $("#reg-filtro").value; paginaRegra = 1; renderRegras(); };
  $("#reg-por-pagina").onchange = () => { porPaginaRegra = Number($("#reg-por-pagina").value) || 10; guardarPorPagina(CHAVE_PP_REGRAS, porPaginaRegra); paginaRegra = 1; renderRegras(); };
  $("#reg-limpar").onclick = () => { buscaRegra = ""; $("#reg-busca").value = ""; filtroSeg = "todos"; paginaRegra = 1; renderRegras(); };
  // Comissões
  $("#com-busca").oninput = () => { buscaCom = $("#com-busca").value; paginaCom = 1; renderComissoes(); };
  $("#com-corretora").onchange = () => { corretoraCom = $("#com-corretora").value; paginaCom = 1; renderComissoes(); };
  $("#com-mes").onchange = () => { mesCom = $("#com-mes").value; paginaCom = 1; renderComissoes(); };
  $("#com-por-pagina").onchange = () => { porPaginaCom = Number($("#com-por-pagina").value) || 10; guardarPorPagina(CHAVE_PP_COM, porPaginaCom); paginaCom = 1; renderComissoes(); };
  $("#com-limpar").onclick = () => { buscaCom = ""; $("#com-busca").value = ""; filtroCom = "todos"; corretoraCom = "todas"; mesCom = "todos"; paginaCom = 1; renderComissoes(); };
}
