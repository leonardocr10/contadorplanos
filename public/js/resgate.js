// Tela "Resgate": clientes que estão sem cotar há mais dias que o escolhido pelo corretor (padrão: 90), que não fecharam e não estão como Negativa. A mensagem sai sozinha pelo WhatsApp
// de cada vendedor (Evolution API, no servidor); aqui ele conecta o número, ajusta o texto e acompanha os envios.
import { fmtFone } from "./calculo.js";
import { $, api, avisoCentral, esc, pode, toast } from "./estado.js";
import { MENSAGEM_RESGATE_PADRAO, linkConversaDireta, waHtml } from "./mensagem.js";
import { normalizar } from "./filtro-select.js";
import { botaoIcone, cabecalho, desenharCards, desenharPaginacao, desenharSeletorDeMes, guardarPorPagina, lerPorPagina, mesLocal, ordenarPor, paginar, proximaOrdem } from "./grade.js";

const SITUACOES = [
  { chave: "pendente", rotulo: "Na fila", classe: "st-neg" },
  { chave: "enviado", rotulo: "Enviada", classe: "st-ok" },
  { chave: "erro", rotulo: "Não enviada", classe: "st-off" },
  { chave: "cancelado", rotulo: "Cancelada", classe: "st-env" },
];
const situacao = (s) => SITUACOES.find((x) => x.chave === s) ?? SITUACOES[0];
const dia = (iso) => { try { return new Date(iso).toLocaleDateString("pt-BR"); } catch { return ""; } };
const diaHora = (iso) => { try { return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); } catch { return ""; } };

let dados = null, erro = null, wa = null;
const CHAVE_POR_PAGINA = "cotador.resgate.porPagina";
let filtro = "todos", mes = "todos", pagina = 1, ordem = { campo: "cotacao", dir: "asc" }, porPagina = lerPorPagina(CHAVE_POR_PAGINA);
const abertos = new Set();

export async function carregarResgate({ comWhatsApp = false } = {}) {
  if (!pode("historico")) return;
  try {
    dados = await api("/api/resgate");
    erro = null;
  } catch (e) {
    erro = e.message;
  }
  renderResgate();
  if (comWhatsApp) await verificarWhatsApp();
}

/* ---------- WhatsApp do vendedor ---------- */
let esperaQr = null;
async function verificarWhatsApp() {
  try {
    wa = await api("/api/resgate/whatsapp");
  } catch (e) {
    wa = { configurado: true, estado: "falha", numero: "", erro: e.message };
  }
  desenharWhatsApp();
  return wa;
}

function desenharWhatsApp() {
  const caixa = $("#res-wa-estado"), conectar = $("#res-conectar"), desconectar = $("#res-desconectar");
  const conectado = wa?.estado === "open";
  if (!wa) { caixa.textContent = "Verificando a conexão…"; return; }
  if (!wa.configurado) {
    caixa.innerHTML = "O envio automático ainda não foi ligado no servidor. A lista acima continua sendo montada; as mensagens começam a sair quando o administrador configurar a Evolution API.";
  } else if (wa.estado === "falha") {
    caixa.innerHTML = `Não deu para ver a conexão agora: ${esc(wa.erro)}`;
  } else if (conectado) {
    caixa.innerHTML = `<b>Conectado${wa.numero ? `: ${esc(fmtFone(wa.numero.replace(/^55(?=\d{10,11}$)/, "")))}` : ""}.</b> ${dados?.ativo === false ? "O envio automático está desligado." : "As mensagens da fila saem sozinhas."}`;
  } else {
    caixa.innerHTML = "<b>WhatsApp desconectado.</b> Conecte o seu número para as mensagens da fila saírem sozinhas.";
  }
  caixa.classList.toggle("res-ok", conectado);
  conectar.hidden = !wa.configurado || conectado;
  desconectar.hidden = !wa.configurado || !conectado;
  if (conectado) pararQr();
}

function pararQr() {
  clearTimeout(esperaQr);
  esperaQr = null;
  $("#res-qr").hidden = true;
}

// Mostra o QR Code e confere a cada 3 s se o vendedor já leu; o código é renovado a cada 30 s, por até 3 minutos.
async function conectarWhatsApp() {
  const botao = $("#res-conectar");
  botao.disabled = true;
  pararQr();
  const inicio = Date.now();
  let ultimoQr = 0;
  const passo = async () => {
    try {
      if (Date.now() - ultimoQr > 30_000) {
        const { qr } = await api("/api/resgate/whatsapp/conectar", { metodo: "POST" });
        ultimoQr = Date.now();
        if (qr) {
          $("#res-qr img").src = qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`;
          $("#res-qr").hidden = false;
        }
      }
      const atual = await verificarWhatsApp();
      if (atual.estado === "open") { avisoCentral("WhatsApp conectado com sucesso"); return; }
      if (Date.now() - inicio > 180_000) { pararQr(); toast("O código expirou. Clique em Conectar meu WhatsApp para tentar de novo."); return; }
      esperaQr = setTimeout(passo, 3000);
    } catch (e) {
      pararQr();
      toast(`Não deu para conectar: ${e.message}`, "erro");
    }
  };
  await passo();
  botao.disabled = false;
}

async function desconectarWhatsApp() {
  if (!confirm("Desconectar o seu WhatsApp do cotador? As mensagens de resgate param de sair até você conectar de novo.")) return;
  try {
    await api("/api/resgate/whatsapp/desconectar", { metodo: "POST" });
    await verificarWhatsApp();
    avisoCentral("WhatsApp desconectado");
  } catch (e) {
    toast(`Não deu para desconectar: ${e.message}`, "erro");
  }
}

/* ---------- mensagem ---------- */
async function salvarConfig(json, aviso) {
  try {
    const cfg = await api("/api/resgate/config", { metodo: "PUT", json });
    Object.assign(dados, cfg);
    desenharWhatsApp();
    avisoCentral(aviso);
  } catch (e) {
    toast(`Não deu para salvar: ${e.message}`, "erro");
  }
}

// Parâmetros do topo: dias sem cotar, mensagens por dia e intervalo entre uma e outra (em minutos).
const PARAMETROS = [
  { chave: "dias", campo: "#res-dias", faixa: (r) => [r.diasMin, r.diasMax], nome: "os dias sem cotar" },
  { chave: "limite", campo: "#res-limite", faixa: (r) => [r.limiteMin, r.limiteMax], nome: "as mensagens por dia" },
  { chave: "intervaloMin", campo: "#res-int-min", faixa: (r) => [r.intervaloMin, r.intervaloMax], nome: "o intervalo mínimo" },
  { chave: "intervaloMax", campo: "#res-int-max", faixa: (r) => [r.intervaloMin, r.intervaloMax], nome: "o intervalo máximo" },
];
const editandoParametro = () => PARAMETROS.some((p) => document.activeElement === $(p.campo));

// Com outros dias, o servidor refaz a fila na hora; a lista é carregada de novo para mostrar quem entrou e quem saiu.
async function salvarParametros() {
  const json = {};
  for (const p of PARAMETROS) {
    const [min, max] = p.faixa(dados.regras);
    const texto = $(p.campo).value.trim(), valor = Number(texto);
    if (!/^\d+$/.test(texto) || valor < min || valor > max) {
      toast(`Informe ${p.nome} de ${min} a ${max}.`, "erro");
      $(p.campo).focus();
      return;
    }
    if (valor !== dados[p.chave]) json[p.chave] = valor;
  }
  if ((json.intervaloMin ?? dados.intervaloMin) > (json.intervaloMax ?? dados.intervaloMax)) {
    toast("O intervalo mínimo não pode ser maior que o máximo.", "erro");
    return;
  }
  if (!Object.keys(json).length) return;
  $("#res-dias-salvar").disabled = true;
  try {
    await api("/api/resgate/config", { metodo: "PUT", json });
    document.activeElement?.blur();
    await carregarResgate();
    avisoCentral("Parâmetros do resgate salvos");
  } catch (e) {
    toast(`Não deu para salvar: ${e.message}`, "erro");
  }
  $("#res-dias-salvar").disabled = false;
}

const minutos = (n) => `${n} ${n === 1 ? "minuto" : "minutos"}`;
const intervaloTexto = ({ intervaloMin: a, intervaloMax: b }) => (a === b ? minutos(a) : `${a} a ${minutos(b)}`);

/* ---------- grade ---------- */
const COLUNAS = [
  { campo: "cliente", rotulo: "Cliente", valor: (r) => normalizar(r.cliente || "") },
  { campo: "fone", rotulo: "Telefone", valor: (r) => r.fone },
  { campo: "plano", rotulo: "Plano cotado", valor: (r) => normalizar(r.plano || "") },
  { campo: "cotacao", rotulo: "Última cotação", valor: (r) => r.cotacaoEm },
  { campo: "situacao", rotulo: "Situação", valor: (r) => SITUACOES.findIndex((s) => s.chave === r.status) },
  { campo: "envio", rotulo: "Data do envio", valor: (r) => (r.status === "enviado" && r.enviadoEm) || "" },
];

function linha(r) {
  const s = situacao(r.status), aberto = abertos.has(r.id), editar = pode("historico", "editar");
  const dica = r.status === "enviado" ? `Enviada em ${diaHora(r.enviadoEm)}` : r.status === "erro" ? r.erro : r.status === "pendente" ? (r.erro ? `Vai tentar de novo. Última falha: ${r.erro}` : "Sai na próxima vez que houver envio") : "Não será enviada";
  const acoes = [
    r.mensagem ? botaoIcone("ver", aberto ? "Fechar a mensagem" : "Ver a mensagem enviada", { atributos: `data-ver aria-expanded="${aberto}"` }) : "",
    botaoIcone("whatsapp", "Abrir conversa no WhatsApp", { href: linkConversaDireta(r.fone, "", navigator.userAgent) }),
    editar && r.status === "pendente" ? botaoIcone("excluir", "Não enviar para este cliente", { atributos: "data-cancelar" }) : "",
    editar && ["erro", "cancelado"].includes(r.status) ? botaoIcone("desfazer", "Colocar na fila de novo", { atributos: "data-reenviar" }) : "",
  ].join("");
  return `<tr class="grade-linha" data-id="${esc(r.id)}">
      <td><div class="grade-nome" title="${esc(r.cliente)}">${esc(r.cliente || "Sem nome")}</div></td>
      <td class="grade-fone">${esc(fmtFone(r.fone))}</td>
      <td><div class="grade-plano grade-plano-uma" title="${esc(r.plano)}">${esc(r.plano || "—")}</div></td>
      <td class="grade-data">${esc(dia(r.cotacaoEm))}</td>
      <td><span class="pill ${s.classe}" title="${esc(dica)}">${s.rotulo}</span></td>
      <td class="grade-data">${r.status === "enviado" && r.enviadoEm ? esc(diaHora(r.enviadoEm)) : "—"}</td>
      <td><div class="grade-acoes">${acoes}</div></td>
    </tr>${aberto ? `<tr class="grade-painel-linha" data-id="${esc(r.id)}"><td colspan="${COLUNAS.length + 1}"><div class="bubble res-previa">${waHtml(r.mensagem)}</div></td></tr>` : ""}`;
}

export function renderResgate() {
  const box = $("#res-list"), nav = $("#res-paginacao");
  const todosOsItens = dados?.itens ?? [];
  const naFila = todosOsItens.filter((r) => r.status === "pendente").length;
  $("#res-selo").hidden = !naFila;
  $("#res-selo").textContent = naFila;
  if (!dados) { box.innerHTML = `<div class="status">${erro ? esc(erro) : "Carregando o resgate…"}</div>`; nav.innerHTML = ""; return; }
  const { dias, limite } = dados, { horario } = dados.regras;
  if (!editandoParametro()) for (const p of PARAMETROS) $(p.campo).value = String(dados[p.chave]);
  $("#res-regras").textContent = `Clientes cuja última cotação tem mais de ${dias} dias, que não fecharam e não estão como Negativa. As mensagens saem de segunda a sexta, das ${horario.inicio}h às ${horario.fim}h (horário de Brasília), até ${limite} por dia e com ${intervaloTexto(dados)} entre uma e outra. Muitas mensagens por dia ou intervalos curtos aumentam o risco de o WhatsApp bloquear o número.`;
  $("#res-count").textContent = `${todosOsItens.length} ${todosOsItens.length === 1 ? "cliente" : "clientes"}`;
  // O mês do topo é o da última cotação, como no Histórico; vale para os cards e a lista.
  mes = desenharSeletorDeMes($("#res-mes"), todosOsItens.map((r) => mesLocal(r.cotacaoEm)), mes);
  const itens = todosOsItens.filter((r) => mes === "todos" || mesLocal(r.cotacaoEm) === mes);
  const quantos = (chave) => itens.filter((r) => r.status === chave).length;
  // O texto só é trocado quando a pessoa não está editando.
  if (document.activeElement !== $("#res-mensagem") && !$("#res-mensagem").dataset.alterado) $("#res-mensagem").value = dados.mensagem || dados.mensagemPadrao;
  $("#res-ativo").checked = dados.ativo;
  // Sem card de "todos": clicar de novo no card escolhido volta a mostrar todas as situações.
  desenharCards($("#res-cards"), [...SITUACOES.map((s) => ({ chave: s.chave, rotulo: s.rotulo, qtd: quantos(s.chave) }))], filtro,
    (chave) => { filtro = chave; pagina = 1; renderResgate(); });
  const sel = $("#res-filtro");
  const opcoes = `<option value="todos" data-icone="todos">Todas as situações</option><optgroup label="Situações">${SITUACOES.map((s) => `<option value="${s.chave}" data-selo="${quantos(s.chave)}">${s.rotulo}</option>`).join("")}</optgroup>`;
  if (sel.dataset.opcoes !== opcoes) { sel.innerHTML = opcoes; sel.dataset.opcoes = opcoes; }
  sel.value = filtro;
  $("#res-por-pagina").value = String(porPagina);
  const q = $("#res-busca").value.trim(), qn = normalizar(q), qd = q.replace(/\D/g, "");
  $("#res-limpar").disabled = filtro === "todos" && !q;
  if (!todosOsItens.length) {
    box.innerHTML = `<div class="status">Nenhum cliente para resgatar ainda. Quem fizer a última cotação há mais de ${dias} dias, não fechar e não estiver como Negativa aparece aqui sozinho.</div>`;
    nav.innerHTML = "";
    return;
  }
  const filtrados = itens.filter((r) => (filtro === "todos" || r.status === filtro) &&
    (!q || (qd.length >= 3 && r.fone.includes(qd)) || normalizar(r.cliente || "").includes(qn) || normalizar(r.plano || "").includes(qn)));
  const pag = paginar(ordenarPor(filtrados, COLUNAS, ordem, (a, b) => a.id.localeCompare(b.id)), pagina, porPagina);
  pagina = pag.pagina;
  box.innerHTML = pag.quantos
    ? `<div class="grade-rolagem"><table class="grade-tabela grade-resgate">${cabecalho(COLUNAS, ordem)}<tbody>${pag.itens.map(linha).join("")}</tbody></table></div>`
    : `<div class="status">Nenhum cliente encontrado com esses filtros.</div>`;
  desenharPaginacao(nav, pag, ["cliente", "clientes"], (p) => { pagina = p; renderResgate(); box.scrollIntoView({ block: "nearest" }); });
  box.querySelectorAll("[data-ordem]").forEach((b) => (b.onclick = () => { ordem = proximaOrdem(ordem, b.dataset.ordem, COLUNAS); pagina = 1; renderResgate(); }));
  const doItem = (el) => itens.find((r) => r.id === el.closest("[data-id]").dataset.id);
  box.querySelectorAll("[data-ver]").forEach((b) => (b.onclick = () => {
    const { id } = doItem(b);
    if (abertos.has(id)) abertos.delete(id); else abertos.add(id);
    renderResgate();
  }));
  const acao = (nome, aviso) => (b) => (b.onclick = async () => {
    try {
      const novo = await api(`/api/resgate/${encodeURIComponent(doItem(b).id)}`, { metodo: "PATCH", json: { acao: nome } });
      Object.assign(doItem(b), novo);
      renderResgate();
      avisoCentral(aviso);
    } catch (e) {
      toast(e.message, "erro");
    }
  });
  box.querySelectorAll("[data-cancelar]").forEach(acao("cancelar", "Este cliente não vai receber a mensagem"));
  box.querySelectorAll("[data-reenviar]").forEach(acao("reenviar", "Cliente de volta na fila"));
}

export function iniciarResgate() {
  $("#res-conectar").onclick = conectarWhatsApp;
  $("#res-desconectar").onclick = desconectarWhatsApp;
  $("#res-mensagem").addEventListener("input", () => { $("#res-mensagem").dataset.alterado = "1"; });
  $("#res-salvar").onclick = async () => {
    const texto = $("#res-mensagem").value.trim();
    await salvarConfig({ mensagem: texto === dados.mensagemPadrao ? "" : texto }, "Mensagem salva com sucesso");
    delete $("#res-mensagem").dataset.alterado;
  };
  $("#res-padrao").onclick = () => {
    $("#res-mensagem").value = dados?.mensagemPadrao ?? MENSAGEM_RESGATE_PADRAO;
    $("#res-mensagem").dataset.alterado = "1";
  };
  $("#res-dias-salvar").onclick = salvarParametros;
  for (const p of PARAMETROS) $(p.campo).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); salvarParametros(); } });
  $("#res-ativo").onchange = () => salvarConfig({ ativo: $("#res-ativo").checked }, $("#res-ativo").checked ? "Envio automático ligado" : "Envio automático desligado");
  $("#res-busca").addEventListener("input", () => { pagina = 1; renderResgate(); });
  $("#res-filtro").onchange = () => { filtro = $("#res-filtro").value; pagina = 1; renderResgate(); };
  $("#res-mes").onchange = () => { mes = $("#res-mes").value; pagina = 1; renderResgate(); };
  $("#res-por-pagina").onchange = () => {
    porPagina = Number($("#res-por-pagina").value) || 10;
    guardarPorPagina(CHAVE_POR_PAGINA, porPagina);
    pagina = 1;
    renderResgate();
  };
  $("#res-limpar").onclick = () => { $("#res-busca").value = ""; filtro = "todos"; pagina = 1; renderResgate(); };
  // Aberta pelo endereço (#resgate) ou pelo menu, a tela confere a lista e a conexão do WhatsApp.
  addEventListener("hashchange", () => { if (location.hash === "#resgate") carregarResgate({ comWhatsApp: true }); });
}
