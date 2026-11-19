// Configurações > Mensalidades (só o administrador): busca dos corretores, cobrança mensal de cada um,
// pagamento marcado à mão, o bloqueio automático por atraso e o registro de alterações de cada corretor.
import { brl, fmtFone, normFone, parseBRL } from "./calculo.js";
import { $, api, avisoCentral, esc, toast } from "./estado.js";
import { linkConversaDireta } from "./mensagem.js";
import { normalizar } from "./filtro-select.js";
import { botaoIcone, desenharCards, desenharPaginacao, guardarPorPagina, lerPorPagina, paginar } from "./grade.js";
import { avatarDoUsuario } from "./configuracoes.js";
import { DIA_MAX, DIA_MIN, FORMAS, SITUACOES, SITUACOES_CORRETOR, mensagemDeCobranca, nomeDaCompetencia, previaDaCobranca, situacaoDaMensalidade } from "./mensalidade.js";

const CHAVE_POR_PAGINA = "cotador.mensalidades.porPagina";
const maiuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const fmtDia = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");

let dados = null, carregando = false, erro = "";
let filtro = "todos", busca = "", pagina = 1, porPagina = lerPorPagina(CHAVE_POR_PAGINA);
let aberto = null, pagando = null, editando = null;

export async function carregarMensalidades() {
  if (carregando) return;
  carregando = true;
  try {
    dados = await api("/api/mensalidades");
    erro = "";
  } catch (e) {
    erro = e.message;
  } finally {
    carregando = false;
  }
  render();
}

const nomeDe = (c) => c.nome || c.login;
const mesAtual = () => dados.hoje.slice(0, 7);
// Filtros que não são uma situação: vêm dos cards de resumo e do card Bloqueado.
const FILTROS_EXTRA = {
  ativas: (c) => !!c.assinatura?.ativa,
  pago_mes: (c) => c.mensalidades.some((m) => m.competencia === mesAtual() && m.pagoEm),
  falta_mes: (c) => c.mensalidades.some((m) => m.competencia === mesAtual() && !m.pagoEm && !m.dispensada),
  bloqueado: (c) => !!c.assinatura?.bloqueado,
};
const passaNoFiltro = (c) => filtro === "todos" || (FILTROS_EXTRA[filtro] ? FILTROS_EXTRA[filtro](c) : c.situacao === filtro);
const escolherFiltro = (chave) => { filtro = filtro === chave && chave !== "todos" ? "todos" : chave; pagina = 1; render(); };
const fmtQuando = (iso) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

const trocarFicha = (ficha) => {
  dados.corretores = dados.corretores.map((c) => (c.id === ficha.id ? ficha : c));
  render();
};

function selo() {
  const atrasados = dados?.corretores.filter((c) => c.situacao === "atrasado").length ?? 0;
  const s = $("#men-selo");
  s.hidden = !atrasados;
  s.textContent = atrasados;
  s.title = `${atrasados} ${atrasados === 1 ? "corretor com mensalidade atrasada" : "corretores com mensalidade atrasada"}`;
}

function resumo() {
  const mes = mesAtual();
  const todas = dados.corretores.flatMap((c) => c.mensalidades);
  const doMes = todas.filter((m) => m.competencia === mes && !m.dispensada);
  const soma = (l) => l.reduce((a, m) => a + m.valor, 0);
  const recebido = soma(doMes.filter((m) => m.pagoEm));
  const aReceber = soma(doMes.filter((m) => !m.pagoEm));
  const atrasado = dados.corretores.reduce((a, c) => a + c.valorAtrasado, 0);
  const ativos = dados.corretores.filter((c) => c.assinatura?.ativa).length;
  const previsto = dados.corretores.filter((c) => c.assinatura?.ativa).reduce((a, c) => a + c.assinatura.valor, 0);
  // Cada card filtra a lista pelos corretores que entram na conta dele; clicar de novo tira o filtro.
  const caixa = $("#men-resumo");
  caixa.innerHTML = [
    ["ativas", "Previsto por mês", `R$ ${brl(previsto)}`, `${ativos} ${ativos === 1 ? "cobrança ativa" : "cobranças ativas"}`],
    ["pago_mes", `Recebido em ${nomeDaCompetencia(mes)}`, `R$ ${brl(recebido)}`, "ver quem pagou"],
    ["falta_mes", `Falta receber em ${nomeDaCompetencia(mes)}`, `R$ ${brl(aReceber)}`, "ver quem falta pagar"],
    ["atrasado", "Em atraso", `R$ ${brl(atrasado)}`, "todos os meses vencidos", atrasado > 0],
  ].map(([chave, rotulo, valor, dica, alerta]) => `<button type="button" class="men-numero${alerta ? " alerta" : ""}" data-resumo="${chave}" aria-pressed="${filtro === chave}"><span>${esc(rotulo)}</span><b>${esc(valor)}</b><small>${esc(dica)}</small></button>`).join("");
  caixa.querySelectorAll("[data-resumo]").forEach((b) => (b.onclick = () => escolherFiltro(b.dataset.resumo)));
}

const textoBusca = (c) => normalizar([c.nome, c.login, c.email, c.fone, normFone(c.fone)].join(" "));

function linhaDoCorretor(c) {
  const a = c.assinatura;
  const cobranca = a ? `<b>R$ ${brl(a.valor)}</b><small>todo dia ${a.dia}</small>` : `<span class="vazio">—</span>`;
  const atraso = c.atrasadas
    ? `<b class="men-atraso">R$ ${brl(c.valorAtrasado)}</b><small>${c.atrasadas} ${c.atrasadas === 1 ? "mês" : "meses"} · ${c.diasDeAtraso} ${c.diasDeAtraso === 1 ? "dia" : "dias"}</small>`
    : `<span class="vazio">—</span>`;
  const fone = normFone(c.fone);
  const ultima = c.mensalidades[0];
  const stUltima = ultima && situacaoDaMensalidade(ultima, dados.hoje);
  const celulaUltima = ultima
    ? `<span class="men-situacao" data-situacao="${stUltima === "atrasada" ? "atrasado" : stUltima}">${esc(SITUACOES[stUltima])}</span><small>${esc(maiuscula(nomeDaCompetencia(ultima.competencia)))} · R$ ${brl(ultima.valor)}</small>`
    : `<span class="vazio">—</span>`;
  const temPainel = c.mensalidades.length || c.alteracoes.length;
  const acoes = [
    botaoIcone("calculadora", a ? "Editar a cobrança" : "Programar a cobrança mensal", { atributos: `data-cobranca` }),
    temPainel ? botaoIcone("ver", "Ver os meses e as alterações", { atributos: `data-meses aria-haspopup="dialog"`, numero: c.atrasadas }) : "",
    fone && ["atrasado", "vence"].includes(c.situacao) ? botaoIcone("whatsapp", "Cobrar pelo WhatsApp", { atributos: `data-whatsapp` }) : "",
  ].join("");
  const bloqueio = a?.bloqueado ? `<span class="usr-selo desativado" title="Login desativado pelo atraso. Volta sozinho quando o atraso for pago.">Bloqueado</span>` : !c.ativo ? `<span class="usr-selo desativado">Desativado</span>` : "";
  return `<tr class="grade-linha${c.situacao === "atrasado" ? " grade-pendente" : ""}" data-id="${esc(c.id)}">
      <td><div class="usr-quem" title="${esc([`Login: ${c.login}`, c.email || "Sem e-mail"].join(" · "))}"><span class="usr-avatar" aria-hidden="true">${avatarDoUsuario(c)}</span><span class="men-nome"><b>${esc(nomeDe(c))}</b><small>${esc(fone ? fmtFone(fone) : c.login)}</small></span></div></td>
      <td><div class="men-duas">${cobranca}</div></td>
      <td><span class="men-situacao" data-situacao="${c.situacao}">${esc(SITUACOES_CORRETOR[c.situacao])}</span>${bloqueio}</td>
      <td><div class="men-duas men-ultima">${celulaUltima}</div></td>
      <td class="grade-data">${c.proximoVencimento ? esc(fmtDia(c.proximoVencimento)) : `<span class="vazio">—</span>`}</td>
      <td><div class="men-duas">${atraso}</div></td>
      <td><div class="grade-acoes">${acoes}</div></td>
    </tr>`;
}

function painelDosMeses(c) {
  const linhas = c.mensalidades.map((m) => {
    const st = situacaoDaMensalidade(m, dados.hoje);
    const detalhe = st === "paga" ? `Pago em ${fmtDia(m.pagoEm)}${m.forma ? ` · ${esc(m.forma)}` : ""}` : st === "dispensada" ? "Não será cobrado" : `Vence em ${fmtDia(m.vencimento)}`;
    let botoes;
    if (pagando === m.id) {
      botoes = `<form class="men-pagar" data-pagar="${esc(m.id)}">
          <label>Pago em <input type="date" name="data" value="${esc(dados.hoje)}" max="${esc(dados.hoje)}" required></label>
          <label>Forma <select name="forma">${FORMAS.map((f) => `<option>${esc(f)}</option>`).join("")}</select></label>
          <button class="btn primary" type="submit">Confirmar</button>
          <button class="btn" type="button" data-cancelar>Cancelar</button>
        </form>`;
    } else if (st === "paga") {
      botoes = `<button class="btn" type="button" data-desfazer="${esc(m.id)}">Desfazer pagamento</button>`;
    } else if (st === "dispensada") {
      botoes = `<button class="btn" type="button" data-cobrar="${esc(m.id)}">Voltar a cobrar</button>`;
    } else {
      botoes = `<button class="btn primary" type="button" data-pago="${esc(m.id)}">Marcar como pago</button>
        <button class="btn" type="button" data-dispensar="${esc(m.id)}" title="Não cobra este mês (ex.: cortesia)">Dispensar</button>`;
    }
    return `<li class="men-mes" data-situacao="${st}">
        <span class="men-mes-nome"><b>${esc(maiuscula(nomeDaCompetencia(m.competencia)))}</b><small>${detalhe}</small></span>
        <span class="men-mes-valor">R$ ${brl(m.valor)}</span>
        <span class="men-situacao" data-situacao="${st === "atrasada" ? "atrasado" : st}">${esc(SITUACOES[st])}</span>
        <span class="men-mes-acoes">${botoes}</span>
      </li>`;
  }).join("");
  const obs = c.assinatura?.observacao ? `<p class="note" style="margin:0">Observação: ${esc(c.assinatura.observacao)}</p>` : "";
  const alteracoes = c.alteracoes.length
    ? `<details class="men-registro" open><summary>Registro de alterações (${c.alteracoes.length})</summary><ol>${c.alteracoes.map((a) =>
        `<li><time datetime="${esc(a.em)}">${esc(fmtQuando(a.em))}</time><span>${esc(a.descricao)}</span><small>${esc(a.autor)}</small></li>`).join("")}</ol></details>`
    : "";
  return `<div class="men-meses">${obs}${linhas ? `<ul>${linhas}</ul>` : ""}${alteracoes}</div>`;
}

function render() {
  if ($("#men-modal").open) desenharMeses();
  if (!dados && !erro) { $("#men-lista").innerHTML = `<div class="status">Carregando mensalidades…</div>`; return; }
  if (erro) { $("#men-lista").innerHTML = `<div class="status">${esc(erro)}</div>`; $("#men-paginacao").innerHTML = ""; return; }
  selo();
  resumo();
  desenharRegua();
  const corretores = dados.corretores;
  $("#men-total").textContent = `· ${corretores.length}`;
  const quantos = (k) => corretores.filter((c) => c.situacao === k).length;
  const bloqueados = corretores.filter(FILTROS_EXTRA.bloqueado).length;
  desenharCards($("#men-cards"), [
    { chave: "todos", rotulo: "Todos", qtd: corretores.length },
    ...Object.entries(SITUACOES_CORRETOR).filter(([k]) => k !== "pausada" || quantos(k)).map(([k, rotulo]) => ({ chave: k, rotulo, qtd: quantos(k) })),
    ...(bloqueados || filtro === "bloqueado" ? [{ chave: "bloqueado", rotulo: "Bloqueado", qtd: bloqueados }] : []),
  ], filtro, (chave) => { filtro = chave; pagina = 1; render(); });
  const box = $("#men-lista"), nav = $("#men-paginacao");
  if (!corretores.length) {
    box.innerHTML = `<div class="status">Nenhum corretor cadastrado ainda. Crie os logins em <b>Usuários</b>, com o perfil Usuário.</div>`;
    nav.innerHTML = "";
    return;
  }
  const termo = normalizar(busca.trim());
  const ordem = { atrasado: 0, vence: 1, sem_cobranca: 2, em_dia: 3, pausada: 4 };
  const filtrados = corretores
    .filter((c) => passaNoFiltro(c) && (!termo || textoBusca(c).includes(termo)))
    .sort((a, b) => ordem[a.situacao] - ordem[b.situacao] || b.diasDeAtraso - a.diasDeAtraso || nomeDe(a).localeCompare(nomeDe(b), "pt-BR"));
  const pag = paginar(filtrados, pagina, porPagina);
  pagina = pag.pagina;
  box.innerHTML = pag.quantos
    ? `<div class="grade-rolagem"><table class="grade-tabela men-tabela"><thead><tr><th>Corretor</th><th>Mensalidade</th><th>Situação</th><th>Última cobrança</th><th>Próximo vencimento</th><th>Em atraso</th><th class="dir">Ações</th></tr></thead><tbody>${pag.itens.map(linhaDoCorretor).join("")}</tbody></table></div>`
    : `<div class="status">Nenhum corretor encontrado com esses filtros.</div>`;
  desenharPaginacao(nav, pag, ["corretor", "corretores"], (p) => { pagina = p; render(); box.scrollIntoView({ block: "nearest" }); });
  ligarLinhas(box);
}

function ligarLinhas(box) {
  const doItem = (el) => dados.corretores.find((c) => c.id === el.closest("[data-id]").dataset.id);
  box.querySelectorAll("[data-cobranca]").forEach((b) => (b.onclick = () => abrirGaveta(doItem(b))));
  box.querySelectorAll("[data-meses]").forEach((b) => (b.onclick = () => abrirMeses(doItem(b))));
  box.querySelectorAll("[data-whatsapp]").forEach((b) => (b.onclick = () => {
    const c = doItem(b);
    window.open(linkConversaDireta(normFone(c.fone), mensagemDeCobranca(nomeDe(c), c.mensalidades, dados.hoje), navigator.userAgent), "_blank", "noopener");
  }));
}

/* ---------- modal dos meses e do registro de alterações ---------- */
function abrirMeses(c) {
  aberto = c.id;
  pagando = null;
  desenharMeses();
  $("#men-modal").showModal();
}

// Redesenha o modal aberto com a ficha atual (depois de um pagamento, por exemplo).
function desenharMeses() {
  const c = dados?.corretores.find((x) => x.id === aberto);
  const modal = $("#men-modal");
  if (!c) { if (modal.open) modal.close(); return; }
  $("#men-modal-titulo").textContent = nomeDe(c);
  const a = c.assinatura;
  $("#men-modal-quem").textContent = [a ? `R$ ${brl(a.valor)} todo dia ${a.dia}` : "Sem cobrança", SITUACOES_CORRETOR[c.situacao]].join(" · ");
  const corpo = $("#men-modal-corpo");
  corpo.innerHTML = painelDosMeses(c);
  ligarMeses(corpo);
}

function ligarMeses(painel) {
  const enviar = async (id, json, aviso) => {
    try {
      trocarFicha(await api(`/api/mensalidades/${encodeURIComponent(id)}`, { metodo: "PATCH", json }));
      avisoCentral(aviso);
    } catch (e) {
      toast(e.message, "erro");
    }
  };
  painel.querySelectorAll("[data-pago]").forEach((b) => (b.onclick = () => { pagando = b.dataset.pago; render(); }));
  painel.querySelectorAll("[data-cancelar]").forEach((b) => (b.onclick = () => { pagando = null; render(); }));
  painel.querySelectorAll("[data-pagar]").forEach((f) => (f.onsubmit = (e) => {
    e.preventDefault();
    const id = f.dataset.pagar;
    pagando = null;
    enviar(id, { pago: true, pagoEm: f.elements.data.value, forma: f.elements.forma.value }, "Pagamento registrado com sucesso");
  }));
  painel.querySelectorAll("[data-desfazer]").forEach((b) => (b.onclick = () => enviar(b.dataset.desfazer, { pago: false }, "Pagamento desfeito")));
  painel.querySelectorAll("[data-dispensar]").forEach((b) => (b.onclick = () => enviar(b.dataset.dispensar, { dispensada: true }, "Mês dispensado")));
  painel.querySelectorAll("[data-cobrar]").forEach((b) => (b.onclick = () => enviar(b.dataset.cobrar, { dispensada: false }, "O mês voltou a ser cobrado")));
}

/* ---------- régua de cobrança ---------- */
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

// Resumo do título, que aparece com o bloco fechado.
function resumoDaRegua(r, diasBloqueio) {
  const canais = [r.whatsapp && "WhatsApp", r.email && "e-mail"].filter(Boolean);
  const etapas = [r.antes && `${plural(r.antes, "dia", "dias")} antes`, r.noDia && "no dia", r.depois && `${plural(r.depois, "dia", "dias")} depois`].filter(Boolean);
  const lembretes = canais.length && etapas.length ? `Lembretes por ${canais.join(" e ")}: ${etapas.join(", ")}` : "Lembretes desligados";
  return `${lembretes} · ${diasBloqueio ? `bloqueio com ${plural(diasBloqueio, "dia", "dias")} de atraso` : "sem bloqueio"}`;
}

// A tela mostra só o resumo; os campos ficam no modal, preenchidos ao abrir.
function desenharRegua() {
  const r = dados.regua, diasBloqueio = dados.config.diasBloqueio;
  $("#men-regua-resumo").textContent = resumoDaRegua(r, diasBloqueio);
}

function abrirRegua() {
  if (!dados?.regua) return;
  const r = dados.regua, diasBloqueio = dados.config.diasBloqueio;
  $("#men-regua-antes").value = r.antes;
  $("#men-regua-dia").checked = r.noDia;
  $("#men-regua-depois").value = r.depois;
  $("#men-bloqueio").value = diasBloqueio;
  $("#men-regua-whatsapp").checked = r.whatsapp;
  $("#men-regua-email").checked = r.email;
  $("#men-regua-pagar").value = r.comoPagar;
  $("#men-regua-whatsapp").disabled = !r.whatsappConfigurado && !r.whatsapp;
  $("#men-regua-email").disabled = !r.emailConfigurado && !r.email;
  const dicas = [
    !r.whatsappConfigurado ? "WhatsApp: o servidor ainda não tem a Evolution API configurada."
      : r.whatsapp && r.remetente ? `WhatsApp: sai pelo número de ${r.remetente}, conectado na tela Resgate.`
      : "WhatsApp: sai pelo seu número, conectado na tela Resgate.",
    !r.emailConfigurado ? "E-mail: o servidor ainda não tem o envio de e-mail configurado (SMTP no .env)." : "E-mail: vai para o e-mail do cadastro do corretor.",
  ];
  $("#men-regua-canais-dica").textContent = dicas.join(" ");
  $("#men-bloqueio-dica").textContent = diasBloqueio
    ? "O login volta sozinho quando o atraso é pago. 0 não bloqueia."
    : "0 não bloqueia";
  $("#men-regua-modal").showModal();
}

async function salvarRegua(e) {
  e.preventDefault();
  const numero = (id) => Number($(id).value || 0);
  const botao = $("#men-regua-salvar");
  botao.disabled = true;
  try {
    // A régua primeiro: se um canal não puder ser ligado, nada muda.
    dados.regua = await api("/api/mensalidades/regua", { metodo: "PUT", json: {
      antes: numero("#men-regua-antes"), noDia: $("#men-regua-dia").checked, depois: numero("#men-regua-depois"),
      whatsapp: $("#men-regua-whatsapp").checked, email: $("#men-regua-email").checked, comoPagar: $("#men-regua-pagar").value,
    } });
    await api("/api/mensalidades/config", { metodo: "PUT", json: { diasBloqueio: numero("#men-bloqueio") } });
    $("#men-regua-modal").close();
    avisoCentral("Régua de cobrança salva com sucesso");
    await carregarMensalidades();
  } catch (erro) {
    toast(erro.message, "erro");
  } finally {
    botao.disabled = false;
  }
}

/* ---------- janela lateral da cobrança ---------- */
function abrirGaveta(c) {
  editando = c;
  const a = c.assinatura;
  $("#men-form").reset();
  $("#men-titulo").textContent = a ? "Editar cobrança" : "Programar cobrança";
  $("#men-quem").innerHTML = `Corretor: <b>${esc(nomeDe(c))}</b> (${esc(c.login)})`;
  $("#men-valor").value = a ? brl(a.valor) : "";
  $("#men-dia").value = a?.dia ?? 10;
  $("#men-inicio").value = a?.inicio ?? dados.hoje.slice(0, 7);
  $("#men-ativa").checked = a ? a.ativa : true;
  $("#men-obs").value = a?.observacao ?? "";
  atualizarPrevia();
  $("#men-gaveta").showModal();
}

// Prévia do que vai ser cobrado, refeita a cada mudança nos campos da janela.
function atualizarPrevia() {
  const texto = previaDaCobranca({
    valor: parseBRL($("#men-valor").value), dia: Number($("#men-dia").value), inicio: $("#men-inicio").value, ativa: $("#men-ativa").checked,
  }, dados.hoje, { nova: !editando?.assinatura });
  const caixa = $("#men-previa");
  caixa.hidden = !texto;
  caixa.textContent = texto;
}

async function salvarGaveta(e) {
  e.preventDefault();
  const valor = parseBRL($("#men-valor").value), dia = Number($("#men-dia").value), inicio = $("#men-inicio").value;
  if (!valor || valor <= 0) return toast("Informe o valor da mensalidade.", "erro");
  if (!Number.isInteger(dia) || dia < DIA_MIN || dia > DIA_MAX) return toast(`O dia do vencimento precisa ser de ${DIA_MIN} a ${DIA_MAX}.`, "erro");
  if (!/^\d{4}-\d{2}$/.test(inicio)) return toast("Informe o primeiro mês cobrado.", "erro");
  const botao = $("#men-salvar");
  botao.disabled = true;
  try {
    const ficha = await api(`/api/mensalidades/corretores/${encodeURIComponent(editando.id)}/assinatura`, { metodo: "PUT", json: {
      valor, dia, inicio, ativa: $("#men-ativa").checked, observacao: $("#men-obs").value,
    } });
    const nova = !editando.assinatura;
    trocarFicha(ficha);
    $("#men-gaveta").close();
    avisoCentral(nova ? "Cobrança programada com sucesso" : "Cobrança salva com sucesso");
  } catch (erro) {
    toast(erro.message, "erro");
  } finally {
    botao.disabled = false;
  }
}

export function iniciarMensalidades() {
  $("#men-por-pagina").value = String(porPagina);
  $("#men-por-pagina").onchange = (e) => { porPagina = Number(e.target.value); guardarPorPagina(CHAVE_POR_PAGINA, porPagina); pagina = 1; render(); };
  $("#men-busca").addEventListener("input", (e) => { busca = e.target.value; pagina = 1; render(); });
  document.querySelectorAll("#men-gaveta [data-fechar]").forEach((b) => (b.onclick = () => $("#men-gaveta").close()));
  $("#men-form").onsubmit = salvarGaveta;
  $("#men-form").addEventListener("input", atualizarPrevia);
  $("#men-form").addEventListener("change", atualizarPrevia);
  $("#men-regua-form").onsubmit = salvarRegua;
  $("#men-regua-abrir").onclick = abrirRegua;
  document.querySelectorAll("#men-regua-modal [data-fechar]").forEach((b) => (b.onclick = () => $("#men-regua-modal").close()));
  $("#men-regua-modal").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $("#men-modal").addEventListener("close", () => { aberto = null; pagando = null; });
  $("#men-modal [data-fechar]").onclick = () => $("#men-modal").close();
  // Clicar fora da caixa fecha o modal.
  $("#men-modal").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
}
