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
const regraPorId = () => new Map(corretoras.flatMap((c) => c.regras.map((r) => [r.id, { ...r, corretora: c.nome }])));

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
  if (!corretoras.some((c) => c.id === corretoraAtual)) corretoraAtual = corretoras[0]?.id ?? null;
  renderRegras();
  renderComissoes();
}

/* =================== Regras de pagamento =================== */
let corretoraAtual = null;
const CHAVE_PP_REGRAS = "cotador.regras.porPagina";
let buscaRegra = "", filtroSeg = "todos", paginaRegra = 1, ordemRegra = { campo: "ordem", dir: "asc" }, porPaginaRegra = lerPorPagina(CHAVE_PP_REGRAS);
let editandoRegra = null, excluindoRegra = null, formRegraAberto = false;

const grupoDoSegmento = (s) => s;
const GRUPOS = SEGMENTOS.map((s) => [s, rotuloDoSegmento(s)]);
const POSICOES = Array.from({ length: MAX_PARCELAS }, (_, i) => i);
const nomeDaCorretora = (r) => corretoras.find((c) => c.id === r.corretoraId)?.nome ?? "";
const COLUNAS_REGRAS = [
  { campo: "corretora", rotulo: "Corretora", valor: (r) => normalizar(nomeDaCorretora(r)) },
  { campo: "nome", rotulo: "Operadora", valor: (r) => normalizar(r.nome) },
  { campo: "segmento", rotulo: "Segmento", valor: (r) => normalizar(rotuloDoSegmento(r.segmento)) },
  { campo: "angariacao", rotulo: "Angariação", valor: (r) => r.angariacao, dir: true, desc: true },
  ...POSICOES.map((i) => ({ campo: `p${i}`, rotulo: `${i + 1}ª parcela`, valor: (r) => parcelaDe(r, i), dir: true, desc: true })),
  { campo: "total", rotulo: "Total", valor: (r) => totalDaRegra(r), dir: true, desc: true },
];

const opcoesSegmento = (atual) => SEGMENTOS.map((s) => `<option value="${esc(s)}"${s === atual ? " selected" : ""}>${esc(rotuloDoSegmento(s))}</option>`).join("");
const numeroBR = (n) => (n ? String(n).replace(".", ",") : "");

// Planos cadastrados no sistema para o segmento (Pessoa física: planos PF; PME: planos CNPJ), com busca.
// O plano que a regra já tem entra como opção, para a edição não perdê-lo se ele saiu da lista.
function opcoesDePlano(segmento, atual = "") {
  const nomes = [...new Set((S.plans ?? []).filter((p) => p.categoria === CATEGORIA_DO_SEGMENTO[segmento]).map((p) => p.nome))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const opcao = (n) => `<option value="${esc(n)}"${n === atual ? " selected" : ""}>${esc(n)}</option>`;
  return `<option value="">Selecionar plano</option>`
    + (atual && !nomes.includes(atual) ? `<optgroup label="Plano da regra">${opcao(atual)}</optgroup>` : "")
    + (nomes.length ? `<optgroup label="Planos ${esc(rotuloDoSegmento(segmento) === "PME" ? "PME (CNPJ)" : rotuloDoSegmento(segmento))}">${nomes.map(opcao).join("")}</optgroup>` : "");
}

// Campos de uma regra (cadastro no topo e edição na linha): segmento, plano, angariação, 4 parcelas e observação.
function camposDaRegra(pref, r = {}) {
  const segmento = SEGMENTOS.includes(r.segmento) ? r.segmento : "PF";
  return `<div class="field fin-seg"><label for="${pref}-segmento">Segmento</label><select id="${pref}-segmento" data-campo="segmento">${opcoesSegmento(segmento)}</select></div>
    <div class="field fin-nome"><label for="${pref}-nome">Operadora</label><select id="${pref}-nome" data-campo="nome" data-plano-regra data-busca="Buscar plano…" data-contagem="plano|planos">${opcoesDePlano(segmento, r.nome ?? "")}</select></div>
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
  return { nome: v("nome").trim(), segmento: v("segmento"), angariacao, parcelas, observacao: v("observacao").trim() };
}

// Troca a lista de planos quando o segmento muda, mantendo o plano escolhido se ele continuar na lista.
function trocarPlanos(form) {
  const sel = form.querySelector("[data-plano-regra]"), seg = form.querySelector("[data-campo=segmento]").value;
  const valor = sel.value, original = sel.dataset.original ?? "";
  const html = opcoesDePlano(seg, original);
  if (sel.dataset.html === html) return;
  sel.innerHTML = html;
  sel.dataset.html = html;
  sel.value = [...sel.options].some((o) => o.value === valor) ? valor : "";
}

// Os planos chegam do servidor depois da tela: as listas abertas se atualizam quando chegam ou mudam.
export function atualizarPlanosDaRegra() {
  document.querySelectorAll("#reg-form, [data-form-regra]").forEach((f) => f.querySelector("[data-plano-regra]") && trocarPlanos(f));
}

// Total ao vivo enquanto a regra é digitada.
function ligarTotal(form) {
  const saida = form.querySelector("[data-total]");
  const atualizar = () => {
    try { const r = lerCamposDaRegra(form); saida.textContent = `Total: ${pct(totalDaRegra(r))}`; } catch (e) { saida.textContent = e.message; }
  };
  form.querySelectorAll("input,select").forEach((el) => el.addEventListener("input", atualizar));
  const seg = form.querySelector("[data-campo=segmento]"), plano = form.querySelector("[data-plano-regra]");
  plano.dataset.original ??= plano.value;
  seg.addEventListener("change", () => { trocarPlanos(form); form.querySelector(".fin-ang").hidden = seg.value !== "PF"; atualizar(); });
  atualizar();
}

function linhaDaRegra(r) {
  const acoes = edita() ? [
    botaoIcone("editar", "Editar regra", { atributos: `data-editar-regra aria-expanded="${editandoRegra === r.id}"` }),
    botaoIcone("excluir", "Excluir regra", { atributos: `data-excluir-regra aria-expanded="${excluindoRegra === r.id}"`, classe: "perigo" }),
  ].join("") : "";
  const paineis = [
    editandoRegra === r.id ? `<form class="fin-form" data-form-regra="${esc(r.id)}" novalidate>${camposDaRegra("fin-ed", r)}<div class="actions fin-botoes"><span class="note" data-total></span><button class="btn primary" type="submit">Salvar</button><button class="btn" type="button" data-cancelar-regra>Cancelar</button></div></form>` : "",
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

export function renderRegras() {
  if (!pode("financeiro")) return;
  const sel = $("#reg-corretora");
  const opcoes = corretoras.length ? corretoras.map((c) => `<option value="${esc(c.id)}" data-selo="${c.regras.length}">${esc(c.nome)}</option>`).join("") : `<option value="">Nenhuma corretora</option>`;
  if (sel.dataset.opcoes !== opcoes) { sel.innerHTML = opcoes; sel.dataset.opcoes = opcoes; }
  sel.value = corretoraAtual ?? "";
  sel.disabled = !corretoras.length;
  const c = corretoras.find((x) => x.id === corretoraAtual);
  $("#reg-renomear").disabled = $("#reg-excluir").disabled = !c;
  // O cadastro de regra só aparece ao clicar em "Nova regra".
  $("#reg-nova-regra").disabled = !c;
  $("#reg-nova-regra").setAttribute("aria-expanded", String(formRegraAberto && !!c));
  $("#reg-form-bloco").hidden = !edita() || !c || !formRegraAberto;
  if ($("#reg-form-bloco").hidden === false) $("#reg-form-titulo").textContent = `Nova regra para ${c.nome}`;
  const regras = c?.regras ?? [];
  const quantos = (g) => regras.filter((r) => grupoDoSegmento(r.segmento) === g).length;
  const selSeg = $("#reg-filtro");
  const opSeg = `<option value="todos" data-icone="todos">Todos os segmentos</option><optgroup label="Segmentos">${GRUPOS.map(([g, rotulo]) => `<option value="${g}" data-selo="${quantos(g)}">${rotulo}</option>`).join("")}</optgroup>`;
  if (selSeg.dataset.opcoes !== opSeg) { selSeg.innerHTML = opSeg; selSeg.dataset.opcoes = opSeg; }
  selSeg.value = filtroSeg;
  $("#reg-por-pagina").value = String(porPaginaRegra);
  $("#reg-limpar").disabled = filtroSeg === "todos" && !buscaRegra.trim();

  const box = $("#reg-lista"), nav = $("#reg-paginacao");
  if (!carregado) { box.innerHTML = `<div class="status">${erro ? esc(erro) : "Carregando regras…"}</div>`; nav.innerHTML = ""; return; }
  if (!c) { box.innerHTML = `<div class="status">Nenhuma corretora cadastrada. ${edita() ? "Clique em <b>Nova corretora</b> e depois cadastre as regras." : ""}</div>`; nav.innerHTML = ""; return; }
  const termo = normalizar(buscaRegra.trim());
  const filtradas = regras.filter((r) => (filtroSeg === "todos" || grupoDoSegmento(r.segmento) === filtroSeg) && (!termo || normalizar(`${r.nome} ${rotuloDoSegmento(r.segmento)} ${r.observacao}`).includes(termo)));
  const posicao = new Map(regras.map((r, i) => [r.id, i]));
  const colunas = [...COLUNAS_REGRAS];
  const lista = ordemRegra.campo === "ordem" ? filtradas : ordenarPor(filtradas, colunas, ordemRegra, (x, y) => posicao.get(x.id) - posicao.get(y.id));
  const pag = paginar(lista, paginaRegra, porPaginaRegra);
  paginaRegra = pag.pagina;
  box.innerHTML = pag.quantos
    ? `<div class="grade-rolagem"><table class="grade-tabela fin-tabela">${cabecalho(colunas, ordemRegra, edita())}<tbody>${pag.itens.map(linhaDaRegra).join("")}</tbody></table></div>`
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
    ligarTotal(form);
    form.querySelector("[data-cancelar-regra]").onclick = () => { editandoRegra = null; renderRegras(); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api(`/api/financeiro/regras/${encodeURIComponent(form.dataset.formRegra)}`, { metodo: "PUT", json: lerCamposDaRegra(form) });
        editandoRegra = null;
        await carregarFinanceiro();
        avisoCentral("Regra salva com sucesso");
      } catch (erro) { toast(`Não deu para salvar: ${erro.message}`, "erro"); }
    };
  }
}

// Faixa abaixo da escolha da corretora: nome (nova ou renomear) ou confirmação da exclusão.
function abrirAcao(tipo) {
  const caixa = $("#reg-acao"), c = corretoras.find((x) => x.id === corretoraAtual);
  const fechar = () => { caixa.hidden = true; caixa.innerHTML = ""; };
  if (tipo === "excluir") {
    if (!c) return;
    caixa.innerHTML = `<span>Excluir a corretora <b>${esc(c.nome)}</b> e as ${c.regras.length} regras dela? Os contratos que usam essas regras ficam sem regra.</span>
      <div class="actions"><button type="button" class="btn danger" data-sim>Sim, excluir</button><button type="button" class="btn" data-nao>Manter</button></div>`;
    caixa.hidden = false;
    caixa.querySelector("[data-nao]").onclick = fechar;
    caixa.querySelector("[data-sim]").onclick = async (e) => {
      e.target.disabled = true;
      try { await api(`/api/financeiro/corretoras/${encodeURIComponent(c.id)}`, { metodo: "DELETE" }); fechar(); corretoraAtual = null; await carregarFinanceiro(); avisoCentral("Corretora excluída com sucesso"); } catch (erro) { e.target.disabled = false; toast(erro.message, "erro"); }
    };
    return;
  }
  const renomear = tipo === "renomear" && c;
  caixa.innerHTML = `<form class="fin-acao-form" style="display:contents" novalidate>
      <div class="field"><label for="reg-acao-nome">${renomear ? "Novo nome da corretora" : "Nome da nova corretora"}</label><input id="reg-acao-nome" type="text" maxlength="120" placeholder="Ex.: Corretora PJ" value="${renomear ? esc(c.nome) : ""}"></div>
      <div class="actions"><button type="submit" class="btn primary">${renomear ? "Salvar" : "Cadastrar corretora"}</button><button type="button" class="btn" data-nao>Cancelar</button></div>
    </form>`;
  caixa.hidden = false;
  const campo = caixa.querySelector("input");
  campo.focus();
  campo.select();
  caixa.querySelector("[data-nao]").onclick = fechar;
  caixa.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const nome = campo.value.trim();
    if (!nome) { toast("Informe o nome da corretora", "erro"); campo.focus(); return; }
    try {
      if (renomear) await api(`/api/financeiro/corretoras/${encodeURIComponent(c.id)}`, { metodo: "PUT", json: { nome } });
      else corretoraAtual = (await api("/api/financeiro/corretoras", { metodo: "POST", json: { nome } })).id;
      fechar();
      await carregarFinanceiro();
      avisoCentral(renomear ? "Corretora renomeada com sucesso" : "Corretora cadastrada com sucesso");
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
function opcoesDeRegra(atual) {
  return `<option value="">Sem regra</option>${corretoras.map((c) => `<optgroup label="${esc(c.nome)}">${c.regras.map((r) =>
    `<option value="${esc(r.id)}"${r.id === atual ? " selected" : ""}>${esc(`${r.nome} · ${rotuloDoSegmento(r.segmento)} · ${pct(totalDaRegra(r))}`)}</option>`).join("")}</optgroup>`).join("")}`;
}

function painelDaComissao(x) {
  const regras = regraPorId(), regra = regras.get(rascunho.regraId) ?? null;
  const conta = calcularComissao({ valor: x.c.valor, ativacao: x.c.ativacao }, regra);
  const podeEditar = edita();
  return `<form class="fin-comissao" data-form-comissao novalidate>
    <div class="fin-com-campos">
      <div class="field fin-com-regra"><label for="fin-com-regra">Regra de comissão</label><select id="fin-com-regra" data-busca="Buscar operadora…" ${podeEditar ? "" : "disabled"}>${opcoesDeRegra(rascunho.regraId)}</select></div>
      ${podeEditar ? `<div class="actions"><button class="btn primary" type="submit">Salvar</button><button class="btn" type="button" data-fechar-comissao>Fechar</button></div>` : ""}
    </div>
    ${regra ? `<p class="note" style="margin:0">${esc(regra.corretora)} · ${esc(regra.nome)} (${esc(rotuloDoSegmento(regra.segmento))})${regra.observacao ? ` · ${esc(regra.observacao)}` : ""}</p>` : `<p class="note" style="margin:0">Escolha a regra da corretora para calcular a comissão.</p>`}
    ${conta.itens.length ? `<div class="grade-rolagem"><table class="grade-tabela fin-detalhe"><thead><tr><th>Pagamento</th><th>Previsto para</th><th class="dir">Percentual</th><th class="dir">Base</th><th class="dir">Valor</th></tr></thead><tbody>
      ${conta.itens.map((i) => `<tr><td>${esc(i.rotulo)}</td><td class="grade-data">${esc(fmtDia(i.data))}</td><td class="dir">${pct(i.percentual)}</td><td class="dir">R$ ${brl(i.base)} <span class="ctr-sub">(mensalidade)</span></td><td class="dir">R$ ${brl(i.valor)}</td></tr>`).join("")}
      <tr class="fin-total"><td colspan="4">Total da comissão</td><td class="dir">R$ ${brl(conta.total)}</td></tr>
    </tbody></table></div>` : ""}
  </form>`;
}

function linhaDaComissao(x) {
  const aberto = abertoCom === x.c.id;
  const regraTxt = x.regra ? `${x.regra.corretora} · ${x.regra.nome}` : "";
  return `<tr class="grade-linha${x.regra ? "" : " grade-pendente"}" data-com="${esc(x.c.id)}">
      <td><div class="grade-nome" title="${esc(x.c.nome)}">${esc(x.c.nome)}</div></td>
      <td><div class="grade-plano" title="${esc(x.c.plano)}">${esc(x.c.plano)}</div></td>
      <td class="grade-valor dir">R$ ${brl(x.c.valor)}</td>
      <td><div class="grade-plano fin-regra" title="${esc(regraTxt)}">${x.regra ? esc(regraTxt) : `<span class="fin-falta">Sem regra</span>`}</div></td>
      <td class="grade-data">${esc(fmtDia(x.c.ativacao))}</td>
      <td class="grade-valor dir"><b>${x.regra ? `R$ ${brl(x.comissao.total)}` : "—"}</b></td>
      <td><div class="grade-acoes">${botaoIcone("calculadora", edita() ? "Definir a regra e ver o cálculo da comissão" : "Ver o cálculo da comissão", { atributos: `data-abrir-com aria-expanded="${aberto}"`, classe: x.regra ? "" : edita() ? "primario" : "" })}</div></td>
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
  const vendas = base.reduce((a, x) => a + x.c.valor, 0), comissao = base.reduce((a, x) => a + x.comissao.total, 0), semRegra = base.filter((x) => !x.regra).length;
  desenharCards($("#com-cards"), [
    { chave: "todos", rotulo: `Total de vendas · ${base.length} ${base.length === 1 ? "contrato" : "contratos"}`, qtd: `R$ ${brl(vendas)}` },
    { chave: "com", rotulo: "Comissão prevista", qtd: `R$ ${brl(comissao)}` },
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
  box.querySelectorAll("[data-abrir-com]").forEach((b) => (b.onclick = () => {
    const x = daLinha(b);
    abertoCom = abertoCom === x.c.id ? null : x.c.id;
    rascunho = abertoCom ? { regraId: x.c.regraId ?? "" } : null;
    renderComissoes();
  }));
  const form = box.querySelector("[data-form-comissao]");
  if (form) {
    const x = daLinha(form);
    // O cálculo acompanha a escolha da regra e o valor digitado, antes de salvar.
    form.querySelector("#fin-com-regra").onchange = (e) => { rascunho.regraId = e.target.value; renderComissoes(); };
    form.querySelector("[data-fechar-comissao]")?.addEventListener("click", () => { abertoCom = null; rascunho = null; renderComissoes(); });
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const novo = await api(`/api/contratos/${encodeURIComponent(x.c.id)}/comissao`, { metodo: "PATCH", json: { regraId: rascunho.regraId || null } });
        contratos = contratos.map((c) => (c.id === novo.id ? novo : c));
        abertoCom = null;
        rascunho = null;
        renderComissoes();
        avisoCentral("Comissão salva com sucesso");
      } catch (erro) { toast(`Não deu para salvar: ${erro.message}`, "erro"); }
    };
  }
}

/* =================== ligações da tela =================== */
export function iniciarFinanceiro() {
  // Regras
  $("#reg-corretora").onchange = () => { $("#reg-acao").hidden = true; corretoraAtual = $("#reg-corretora").value || null; paginaRegra = 1; editandoRegra = excluindoRegra = null; renderRegras(); };
  $("#reg-nova").onclick = () => abrirAcao("nova");
  $("#reg-renomear").onclick = () => abrirAcao("renomear");
  $("#reg-excluir").onclick = () => abrirAcao("excluir");
  const form = $("#reg-form");
  form.innerHTML = `${camposDaRegra("fin-nova")}<div class="actions fin-botoes"><span class="note" data-total></span><button class="btn primary" type="submit">Adicionar regra</button><button class="btn" type="button" data-fechar-nova>Fechar</button></div>`;
  ligarTotal(form);
  $("#reg-nova-regra").onclick = () => {
    formRegraAberto = !formRegraAberto;
    renderRegras();
    if (formRegraAberto) { $("#reg-form-bloco").scrollIntoView({ block: "nearest" }); form.querySelector("[data-campo=segmento]").focus(); }
  };
  form.querySelector("[data-fechar-nova]").onclick = () => { formRegraAberto = false; renderRegras(); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(`/api/financeiro/corretoras/${encodeURIComponent(corretoraAtual)}/regras`, { metodo: "POST", json: lerCamposDaRegra(form) });
      form.querySelectorAll("[data-campo=nome],[data-campo=angariacao],[data-campo=observacao],[data-parcela]").forEach((el) => (el.value = ""));
      form.querySelector("[data-campo=nome]").focus();
      await carregarFinanceiro();
      form.querySelector("[data-parcela]").dispatchEvent(new Event("input", { bubbles: true }));
      avisoCentral("Regra cadastrada com sucesso");
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
