// Menu Financeiro: "Regras de pagamento" (corretoras e as regras de comissão de cada uma) e
// "Comissões" (a comissão de cada contrato vendido, pela regra escolhida).
import { brl, parseBRL } from "./calculo.js";
import { $, api, avisoCentral, esc, pode, toast } from "./estado.js";
import { normalizar } from "./filtro-select.js";
import { calcularComissao, lerParcelas, SEGMENTOS, textoDasParcelas, totalDaRegra, usaAdesao } from "./comissao.js";
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
let editandoRegra = null, excluindoRegra = null;

const grupoDoSegmento = (s) => (s.startsWith("Adesão") ? "adesao" : s === "PF" ? "pf" : s === "PME" ? "pme" : "pfpme");
const GRUPOS = [["pf", "PF"], ["pme", "PME"], ["pfpme", "PF e PME"], ["adesao", "Coletivo por adesão"]];
const COLUNAS_REGRAS = [
  { campo: "nome", rotulo: "Operadora / administradora", valor: (r) => normalizar(r.nome) },
  { campo: "segmento", rotulo: "Segmento", valor: (r) => SEGMENTOS.indexOf(r.segmento) },
  { campo: "angariacao", rotulo: "Angariação", valor: (r) => r.angariacao, dir: true, desc: true },
  { campo: "parcelas", rotulo: "Parcelas (mensalidade)", valor: (r) => r.parcelas.length },
  { campo: "total", rotulo: "Total", valor: (r) => totalDaRegra(r), dir: true, desc: true },
];

const opcoesSegmento = (atual) => SEGMENTOS.map((s) => `<option value="${esc(s)}"${s === atual ? " selected" : ""}>${esc(s)}</option>`).join("");

// Campos de uma regra (cadastro no topo e edição na linha).
function camposDaRegra(pref, r = {}) {
  return `<div class="field fin-nome"><label for="${pref}-nome">Operadora ou administradora</label><input id="${pref}-nome" data-campo="nome" type="text" maxlength="120" placeholder="Ex.: Amil Saúde" value="${esc(r.nome ?? "")}"></div>
    <div class="field"><label for="${pref}-segmento">Segmento</label><select id="${pref}-segmento" data-campo="segmento">${opcoesSegmento(r.segmento ?? "PME")}</select></div>
    <div class="field"><label for="${pref}-angariacao" title="Percentual sobre o valor da adesão, pago no ato da venda (coletivo por adesão)">Angariação (% da adesão)</label><input id="${pref}-angariacao" data-campo="angariacao" type="text" inputmode="decimal" placeholder="0" value="${r.angariacao ? esc(String(r.angariacao).replace(".", ",")) : ""}"></div>
    <div class="field"><label for="${pref}-parcelas" title="Percentual sobre a mensalidade, uma parcela por mês. Use 10x30 para 10 parcelas de 30%.">Parcelas (% da mensalidade)</label><input id="${pref}-parcelas" data-campo="parcelas" type="text" placeholder="100; 100; 50 ou 10x30" value="${esc(r.parcelas ? r.parcelas.join("; ").replace(/\./g, ",") : "")}"></div>
    <div class="field fin-obs"><label for="${pref}-observacao">Observação</label><input id="${pref}-observacao" data-campo="observacao" type="text" maxlength="300" placeholder="Opcional" value="${esc(r.observacao ?? "")}"></div>`;
}

function lerCamposDaRegra(form) {
  const v = (c) => form.querySelector(`[data-campo="${c}"]`).value;
  const parcelas = lerParcelas(v("parcelas"));
  if (parcelas === null) throw new Error("Parcelas inválidas: use 100; 100; 50 ou 10x30.");
  const angariacao = v("angariacao").trim() ? parseBRL(v("angariacao").replace("%", "")) : 0;
  if (angariacao == null) throw new Error("Taxa de angariação inválida.");
  return { nome: v("nome").trim(), segmento: v("segmento"), angariacao, parcelas, observacao: v("observacao").trim() };
}

// Total ao vivo enquanto a regra é digitada.
function ligarTotal(form) {
  const saida = form.querySelector("[data-total]");
  const atualizar = () => {
    try { const r = lerCamposDaRegra(form); saida.textContent = `Total: ${pct(totalDaRegra(r))}`; } catch { saida.textContent = "Total: confira as parcelas"; }
  };
  form.querySelectorAll("input,select").forEach((el) => el.addEventListener("input", atualizar));
  atualizar();
}

function linhaDaRegra(r) {
  const acoes = edita() ? [
    botaoIcone("editar", "Editar regra", { atributos: `data-editar-regra aria-expanded="${editandoRegra === r.id}"` }),
    botaoIcone("excluir", "Excluir regra", { atributos: `data-excluir-regra aria-expanded="${excluindoRegra === r.id}"`, classe: "perigo" }),
  ].join("") : "";
  const paineis = [
    editandoRegra === r.id ? `<form class="fin-form" data-form-regra="${esc(r.id)}" novalidate>${camposDaRegra("fin-ed", r)}<div class="actions fin-botoes"><span class="note" data-total></span><button class="btn primary" type="submit">Salvar</button><button class="btn" type="button" data-cancelar-regra>Cancelar</button></div></form>` : "",
    excluindoRegra === r.id ? `<div class="status" data-confirma>Excluir a regra <b>${esc(r.nome)} (${esc(r.segmento)})</b>? Os contratos que usam esta regra ficam sem regra. <span class="actions" style="margin-top:8px"><button class="btn danger" data-sim-regra>Sim, excluir</button><button class="btn" data-nao-regra>Manter</button></span></div>` : "",
  ].join("");
  return `<tr class="grade-linha" data-regra="${esc(r.id)}">
      <td><div class="grade-nome" title="${esc(r.nome)}">${esc(r.nome)}</div>${r.observacao ? `<div class="note fin-obs-linha" title="${esc(r.observacao)}">${esc(r.observacao)}</div>` : ""}</td>
      <td><span class="pill st-env">${esc(r.segmento)}</span></td>
      <td class="dir">${r.angariacao ? pct(r.angariacao) : "—"}</td>
      <td>${esc(textoDasParcelas(r.parcelas))}</td>
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
  $("#reg-form-bloco").hidden = !edita() || !c;
  if ($("#reg-form-bloco").hidden === false) $("#reg-form-titulo").textContent = `Nova regra para ${c.nome}`;
  const regras = c?.regras ?? [];
  const quantos = (g) => regras.filter((r) => grupoDoSegmento(r.segmento) === g).length;
  desenharCards($("#reg-cards"), [{ chave: "todos", rotulo: "Todas as regras", qtd: regras.length }, ...GRUPOS.map(([g, rotulo]) => ({ chave: g, rotulo, qtd: quantos(g) }))], filtroSeg,
    (chave) => { filtroSeg = chave; paginaRegra = 1; renderRegras(); });
  const selSeg = $("#reg-filtro");
  const opSeg = `<option value="todos" data-icone="todos">Todos os segmentos</option><optgroup label="Segmentos">${GRUPOS.map(([g, rotulo]) => `<option value="${g}" data-selo="${quantos(g)}">${rotulo}</option>`).join("")}</optgroup>`;
  if (selSeg.dataset.opcoes !== opSeg) { selSeg.innerHTML = opSeg; selSeg.dataset.opcoes = opSeg; }
  selSeg.value = filtroSeg;
  $("#reg-por-pagina").value = String(porPaginaRegra);
  $("#reg-limpar").disabled = filtroSeg === "todos" && !buscaRegra.trim();

  const box = $("#reg-lista"), nav = $("#reg-paginacao");
  if (!carregado) { box.innerHTML = `<div class="status">${erro ? esc(erro) : "Carregando regras…"}</div>`; nav.innerHTML = ""; return; }
  if (!c) { box.innerHTML = `<div class="status">Nenhuma corretora cadastrada. ${edita() ? "Clique em <b>Nova corretora</b> e depois cadastre as regras, ou use <b>Importar tabela</b>." : ""}</div>`; nav.innerHTML = ""; return; }
  const termo = normalizar(buscaRegra.trim());
  const filtradas = regras.filter((r) => (filtroSeg === "todos" || grupoDoSegmento(r.segmento) === filtroSeg) && (!termo || normalizar(`${r.nome} ${r.segmento} ${r.observacao}`).includes(termo)));
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

// Importa uma tabela em JSON: { "corretora": "Nome", "regras": [ { nome, segmento, angariacao, parcelas, observacao } ] }.
// A corretora do arquivo é criada se ainda não existir.
async function importarTabela(arquivo) {
  let dados;
  try { dados = JSON.parse(await arquivo.text()); } catch { toast("Este arquivo não é uma tabela de comissão válida (JSON).", "erro"); return; }
  const regras = Array.isArray(dados) ? dados : dados?.regras;
  if (!Array.isArray(regras) || !regras.length) { toast("O arquivo não traz nenhuma regra.", "erro"); return; }
  try {
    let alvo = dados?.corretora ? corretoras.find((c) => normalizar(c.nome) === normalizar(dados.corretora)) : corretoras.find((c) => c.id === corretoraAtual);
    if (!alvo && dados?.corretora) alvo = await api("/api/financeiro/corretoras", { metodo: "POST", json: { nome: String(dados.corretora) } });
    if (!alvo) { toast("Crie uma corretora antes de importar.", "erro"); return; }
    await api(`/api/financeiro/corretoras/${encodeURIComponent(alvo.id)}/regras`, { metodo: "POST", json: regras });
    corretoraAtual = alvo.id;
    await carregarFinanceiro();
    avisoCentral(`${regras.length} regras importadas para ${alvo.nome}`);
  } catch (e) {
    toast(`Não deu para importar: ${e.message}`, "erro");
  }
}

/* =================== Comissões =================== */
const CHAVE_PP_COM = "cotador.comissoes.porPagina";
let buscaCom = "", filtroCom = "todos", corretoraCom = "todas", mesCom = "todos", paginaCom = 1, ordemCom = { campo: "ativacao", dir: "desc" }, porPaginaCom = lerPorPagina(CHAVE_PP_COM);
let abertoCom = null, rascunho = null;

const COLUNAS_COM = [
  { campo: "nome", rotulo: "Cliente", valor: (x) => normalizar(x.c.nome) },
  { campo: "plano", rotulo: "Plano", valor: (x) => normalizar(x.c.plano) },
  { campo: "valor", rotulo: "Mensalidade", valor: (x) => x.c.valor, dir: true, desc: true },
  { campo: "adesao", rotulo: "Adesão", valor: (x) => x.c.adesao ?? -1, dir: true, desc: true },
  { campo: "regra", rotulo: "Regra", valor: (x) => (x.regra ? normalizar(`${x.regra.corretora} ${x.regra.nome}`) : "￿") },
  { campo: "ativacao", rotulo: "Ativação", valor: (x) => x.c.ativacao, desc: true },
  { campo: "comissao", rotulo: "Comissão", valor: (x) => x.comissao.total, dir: true, desc: true },
];

// Seletor da regra: agrupado por corretora, com busca.
function opcoesDeRegra(atual) {
  return `<option value="">Sem regra</option>${corretoras.map((c) => `<optgroup label="${esc(c.nome)}">${c.regras.map((r) =>
    `<option value="${esc(r.id)}"${r.id === atual ? " selected" : ""}>${esc(`${r.nome} · ${r.segmento} · ${pct(totalDaRegra(r))}`)}</option>`).join("")}</optgroup>`).join("")}`;
}

function painelDaComissao(x) {
  const regras = regraPorId(), regra = regras.get(rascunho.regraId) ?? null;
  const adesao = rascunho.adesao === "" ? null : parseBRL(rascunho.adesao);
  const conta = calcularComissao({ valor: x.c.valor, ativacao: x.c.ativacao, adesao }, regra);
  const podeEditar = edita();
  return `<form class="fin-comissao" data-form-comissao novalidate>
    <div class="fin-com-campos">
      <div class="field fin-com-regra"><label for="fin-com-regra">Regra de comissão</label><select id="fin-com-regra" data-busca="Buscar operadora…" ${podeEditar ? "" : "disabled"}>${opcoesDeRegra(rascunho.regraId)}</select></div>
      <div class="field"><label for="fin-com-adesao" title="Valor da taxa de adesão paga pelo cliente (coletivo por adesão)">Valor da adesão (R$)</label><input id="fin-com-adesao" type="text" inputmode="decimal" placeholder="${usaAdesao(regra) ? "0,00" : "Não se aplica"}" value="${esc(rascunho.adesao)}" ${podeEditar && usaAdesao(regra) ? "" : "disabled"}></div>
      ${podeEditar ? `<div class="actions"><button class="btn primary" type="submit">Salvar</button><button class="btn" type="button" data-fechar-comissao>Fechar</button></div>` : ""}
    </div>
    ${regra ? `<p class="note" style="margin:0">${esc(regra.corretora)} · ${esc(regra.nome)} (${esc(regra.segmento)})${regra.observacao ? ` · ${esc(regra.observacao)}` : ""}${usaAdesao(regra) && adesao == null ? " · <b>Informe o valor da adesão para calcular a angariação.</b>" : ""}</p>` : `<p class="note" style="margin:0">Escolha a regra da corretora para calcular a comissão.</p>`}
    ${conta.itens.length ? `<div class="grade-rolagem"><table class="grade-tabela fin-detalhe"><thead><tr><th>Pagamento</th><th>Previsto para</th><th class="dir">Percentual</th><th class="dir">Base</th><th class="dir">Valor</th></tr></thead><tbody>
      ${conta.itens.map((i) => `<tr><td>${esc(i.rotulo)}</td><td class="grade-data">${esc(fmtDia(i.data))}</td><td class="dir">${pct(i.percentual)}</td><td class="dir">R$ ${brl(i.base)} <span class="ctr-sub">(${i.tipoBase})</span></td><td class="dir">R$ ${brl(i.valor)}</td></tr>`).join("")}
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
      <td class="grade-valor dir">${x.c.adesao != null ? `R$ ${brl(x.c.adesao)}` : usaAdesao(x.regra) ? `<span class="fin-falta" title="Esta regra paga angariação sobre a adesão">Informar</span>` : "—"}</td>
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
    rascunho = abertoCom ? { regraId: x.c.regraId ?? "", adesao: x.c.adesao != null ? brl(x.c.adesao) : "" } : null;
    renderComissoes();
  }));
  const form = box.querySelector("[data-form-comissao]");
  if (form) {
    const x = daLinha(form);
    // O cálculo acompanha a escolha da regra e o valor digitado, antes de salvar.
    form.querySelector("#fin-com-regra").onchange = (e) => { rascunho.regraId = e.target.value; renderComissoes(); };
    const ades = form.querySelector("#fin-com-adesao");
    ades.onchange = () => { rascunho.adesao = ades.value; renderComissoes(); };
    ades.oninput = () => (rascunho.adesao = ades.value);
    form.querySelector("[data-fechar-comissao]")?.addEventListener("click", () => { abertoCom = null; rascunho = null; renderComissoes(); });
    form.onsubmit = async (e) => {
      e.preventDefault();
      rascunho.adesao = ades.value;
      const regra = regraPorId().get(rascunho.regraId);
      const adesao = usaAdesao(regra) && rascunho.adesao.trim() ? parseBRL(rascunho.adesao) : null;
      if (usaAdesao(regra) && rascunho.adesao.trim() && adesao == null) { toast("Valor da adesão inválido.", "erro"); return; }
      try {
        const novo = await api(`/api/contratos/${encodeURIComponent(x.c.id)}/comissao`, { metodo: "PATCH", json: { regraId: rascunho.regraId || null, adesao } });
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
  const arquivo = $("#reg-arquivo");
  $("#reg-importar").onclick = () => arquivo.click();
  arquivo.onchange = () => { const f = arquivo.files[0]; arquivo.value = ""; if (f) importarTabela(f); };
  const form = $("#reg-form");
  form.innerHTML = `${camposDaRegra("fin-nova")}<div class="actions fin-botoes"><span class="note" data-total></span><button class="btn primary" type="submit">Adicionar regra</button></div>`;
  ligarTotal(form);
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(`/api/financeiro/corretoras/${encodeURIComponent(corretoraAtual)}/regras`, { metodo: "POST", json: lerCamposDaRegra(form) });
      for (const c of ["nome", "angariacao", "parcelas", "observacao"]) form.querySelector(`[data-campo="${c}"]`).value = "";
      form.querySelector("[data-campo=nome]").focus();
      await carregarFinanceiro();
      ligarTotal(form);
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
