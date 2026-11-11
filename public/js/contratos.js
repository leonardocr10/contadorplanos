// Tela "Contratos vendidos": cadastro dos planos vendidos e o aviso de contato no dia da ativação.
import { brl, fmtFone, normFone, parseBRL } from "./calculo.js";
import { $, S, api, avisoCentral, esc, pode, show, toast } from "./estado.js";
import { linkConversaDireta, mensagemAtivacao } from "./mensagem.js";

let contratos = [], carregados = false, erro = null, editando = null, filtro = "todos";
// O aviso aparece uma vez por dia, e de novo só quando surge outro contrato para contatar.
let avisados = -1, diaDoAviso = "";

// Data de hoje no relógio do computador, no formato da data de ativação (aaaa-mm-dd).
const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtDia = (iso) => (iso ? iso.split("-").reverse().join("/") : "");

// pendente: ativou hoje ou antes e o contato ainda não foi feito.
function situacao(c, dia = hoje()) {
  if (c.contatoEm) return { chave: "feito", rotulo: "CONTATO FEITO", classe: "st-ok" };
  if (c.ativacao === dia) return { chave: "pendente", rotulo: "ENTRAR EM CONTATO HOJE", classe: "st-off" };
  if (c.ativacao < dia) return { chave: "pendente", rotulo: "CONTATO ATRASADO", classe: "st-off" };
  return { chave: "aguardando", rotulo: `ATIVA EM ${fmtDia(c.ativacao)}`, classe: "st-env" };
}
const FILTROS = { todos: "Todos os contratos", pendente: "Entrar em contato", aguardando: "Aguardando ativação", feito: "Contato feito" };
const ORDEM = { pendente: 0, aguardando: 1, feito: 2 };
const ordenar = (lista, dia) => [...lista].sort((a, b) => {
  const sa = situacao(a, dia).chave, sb = situacao(b, dia).chave;
  if (sa !== sb) return ORDEM[sa] - ORDEM[sb];
  return sa === "feito" ? b.ativacao.localeCompare(a.ativacao) : a.ativacao.localeCompare(b.ativacao);
});
const pendentes = (dia = hoje()) => contratos.filter((c) => situacao(c, dia).chave === "pendente");

export async function carregarContratos() {
  if (!pode("contratos")) return;
  try {
    contratos = await api("/api/contratos");
    carregados = true;
    erro = null;
  } catch (e) {
    erro = e.message;
  }
  renderContratos();
}

// Selo da aba, faixa de alerta no topo e o aviso na tela no dia da ativação.
function avisar() {
  const dia = hoje(), lista = pendentes(dia), n = lista.length;
  const selo = $("#ctr-selo");
  selo.textContent = n;
  selo.hidden = !n;
  const alerta = $("#ctr-alerta");
  alerta.hidden = !n;
  if (n) {
    const nomes = lista.slice(0, 3).map((c) => c.nome.split(/\s+/)[0]).join(", ") + (n > 3 ? ` e mais ${n - 3}` : "");
    alerta.innerHTML = `<b>Plano ativado: entre em contato ${n === 1 ? "com o cliente" : `com ${n} clientes`}</b><span>${esc(nomes)} · Ver contratos</span>`;
  }
  if (!carregados) return;
  if (dia !== diaDoAviso) { diaDoAviso = dia; avisados = -1; }
  if (n > avisados && n > 0) {
    avisoCentral(n === 1 ? `Hoje é dia de entrar em contato com ${lista[0].nome}: o plano foi ativado` : `Hoje é dia de entrar em contato com ${n} clientes: os planos foram ativados`, "aviso");
  }
  avisados = n;
}

export function renderContratos() {
  if (!pode("contratos")) return;
  avisar();
  const dia = hoje();
  const sel = $("#ctr-filtro"), quantos = (k) => contratos.filter((c) => situacao(c, dia).chave === k).length;
  const opcoes = `<option value="todos" data-icone="todos">${FILTROS.todos}</option><optgroup label="Situações">${["pendente", "aguardando", "feito"].map((k) => `<option value="${k}"${carregados ? ` data-selo="${quantos(k)}"` : ""}>${FILTROS[k]}</option>`).join("")}</optgroup>`;
  if (sel.dataset.opcoes !== opcoes) { sel.innerHTML = opcoes; sel.dataset.opcoes = opcoes; }
  sel.value = filtro;
  const box = $("#ctr-list");
  if (!carregados) { box.innerHTML = `<div class="status">${erro ? esc(erro) : "Carregando contratos…"}</div>`; return; }
  $("#ctr-count").textContent = `${contratos.length} ${contratos.length === 1 ? "contrato" : "contratos"} · ${quantos("pendente")} para contatar`;
  if (!contratos.length) { box.innerHTML = `<div class="status">Nenhum contrato cadastrado ainda. Preencha os dados acima e clique em <b>Cadastrar contrato</b>.</div>`; return; }
  const q = $("#ctr-busca").value.trim().toLowerCase(), qd = q.replace(/\D/g, "");
  const lista = ordenar(contratos, dia).filter((c) => {
    if (filtro !== "todos" && situacao(c, dia).chave !== filtro) return false;
    if (!q) return true;
    return c.nome.toLowerCase().includes(q) || c.plano.toLowerCase().includes(q) || (qd.length >= 3 && c.fone.includes(qd));
  });
  if (!lista.length) { box.innerHTML = `<div class="status">Nenhum contrato encontrado.</div>`; return; }
  const edita = pode("contratos", "editar");
  box.innerHTML = lista.map((c) => {
    const st = situacao(c, dia);
    const texto = mensagemAtivacao({ cliente: c.nome, plano: c.plano, corretor: S.cor });
    return `<div class="hq ctr-item${st.chave === "pendente" ? " ctr-pendente" : ""}" data-id="${esc(c.id)}">
      <div class="hq-top"><span class="hg-name">${esc(c.nome)}</span><span class="pill ${st.classe}">${esc(st.rotulo)}</span></div>
      <div class="hq-date">${esc(fmtFone(c.fone))} · ativação em ${esc(fmtDia(c.ativacao))}${c.contatoEm ? ` · contato feito em ${esc(new Date(c.contatoEm).toLocaleDateString("pt-BR"))}` : ""}</div>
      <div class="hq-plans"><b>${esc(c.plano)}</b> · R$ ${brl(c.valor)}</div>
      ${edita ? `<div class="actions">
        <a class="btn ${st.chave === "pendente" ? "primary" : ""}" href="${esc(linkConversaDireta(c.fone, texto, navigator.userAgent))}" target="_blank" rel="noopener">Abrir no WhatsApp</a>
        ${st.chave === "aguardando" ? "" : `<button class="btn" data-contato="${c.contatoEm ? "0" : "1"}">${c.contatoEm ? "Desfazer contato" : "Marcar contato feito"}</button>`}
        <button class="btn" data-editar>Editar</button>
        <button class="btn danger" data-excluir>Excluir</button>
      </div>
      <div class="status" data-confirma hidden>Excluir o contrato de <b>${esc(c.nome)}</b>? <span class="actions" style="margin-top:8px"><button class="btn danger" data-sim>Sim, excluir</button><button class="btn" data-nao>Manter</button></span></div>` : ""}
    </div>`;
  }).join("");
  const doItem = (el) => contratos.find((c) => c.id === el.closest(".hq").dataset.id);
  box.querySelectorAll("[data-contato]").forEach((b) => (b.onclick = () => marcarContato(doItem(b), b.dataset.contato === "1", b)));
  box.querySelectorAll("[data-editar]").forEach((b) => (b.onclick = () => editar(doItem(b))));
  box.querySelectorAll("[data-excluir]").forEach((b) => (b.onclick = () => (b.closest(".hq").querySelector("[data-confirma]").hidden = false)));
  box.querySelectorAll("[data-nao]").forEach((b) => (b.onclick = () => (b.closest("[data-confirma]").hidden = true)));
  box.querySelectorAll("[data-sim]").forEach((b) => (b.onclick = () => excluir(doItem(b), b)));
}

// Sugestões do campo plano: os nomes dos planos cadastrados, sem impedir outro nome.
export function atualizarPlanosDoContrato() {
  const nomes = [...new Set(S.plans.map((p) => p.nome))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const html = nomes.map((n) => `<option value="${esc(n)}">`).join("");
  const dl = $("#ctr-planos");
  if (dl.dataset.html !== html) { dl.innerHTML = html; dl.dataset.html = html; }
}

function lerFormulario() {
  return {
    nome: $("#ctr-nome").value.trim(),
    fone: normFone($("#ctr-fone").value),
    plano: $("#ctr-plano").value.trim(),
    valor: parseBRL($("#ctr-valor").value),
    ativacao: $("#ctr-ativacao").value,
  };
}

function limparFormulario() {
  editando = null;
  for (const id of ["nome", "fone", "plano", "valor", "ativacao"]) $("#ctr-" + id).value = "";
  $("#ctr-salvar").textContent = "Cadastrar contrato";
  $("#ctr-cancelar").hidden = true;
}

function editar(c) {
  editando = c.id;
  $("#ctr-nome").value = c.nome;
  $("#ctr-fone").value = fmtFone(c.fone);
  $("#ctr-plano").value = c.plano;
  $("#ctr-valor").value = brl(c.valor);
  $("#ctr-ativacao").value = c.ativacao;
  $("#ctr-salvar").textContent = "Salvar alterações";
  $("#ctr-cancelar").hidden = false;
  $("#ctr-form").scrollIntoView({ behavior: "smooth", block: "center" });
  $("#ctr-nome").focus({ preventScroll: true });
}

async function salvar(e) {
  e.preventDefault();
  const d = lerFormulario();
  if (!d.nome) return toast("Informe o nome do cliente.", "erro");
  if (d.fone.length < 10) return toast("Informe o telefone do cliente com DDD.", "erro");
  if (!d.plano) return toast("Informe o plano contratado.", "erro");
  if (!(d.valor > 0)) return toast("Informe o valor do contrato.", "erro");
  if (!d.ativacao) return toast("Informe a data de ativação do plano.", "erro");
  const botao = $("#ctr-salvar");
  botao.disabled = true;
  try {
    if (editando) {
      const c = await api(`/api/contratos/${encodeURIComponent(editando)}`, { metodo: "PUT", json: d });
      contratos = contratos.map((x) => (x.id === c.id ? c : x));
      avisoCentral("Contrato salvo com sucesso");
    } else {
      contratos = [await api("/api/contratos", { metodo: "POST", json: d }), ...contratos];
      avisoCentral(d.ativacao <= hoje() ? "Contrato cadastrado. O plano já está ativo: entre em contato com o cliente" : `Contrato cadastrado. No dia ${fmtDia(d.ativacao)} o sistema avisa para entrar em contato`);
    }
    limparFormulario();
    // O aviso do cadastro já basta: não repete a caixa por causa deste contrato.
    avisados = Math.max(avisados, pendentes().length);
    renderContratos();
  } catch (erro) {
    toast(`Não deu para salvar: ${erro.message}`, "erro");
  }
  botao.disabled = false;
}

async function marcarContato(c, feito, botao) {
  botao.disabled = true;
  try {
    const novo = await api(`/api/contratos/${encodeURIComponent(c.id)}/contato`, { metodo: "PATCH", json: { feito } });
    contratos = contratos.map((x) => (x.id === novo.id ? novo : x));
    avisados = Math.min(avisados, pendentes().length);
    renderContratos();
    avisoCentral(feito ? "Contato registrado com sucesso" : "Contato desfeito: o contrato volta para a lista de contato");
  } catch (e) {
    botao.disabled = false;
    toast(`Não deu para salvar: ${e.message}`, "erro");
  }
}

async function excluir(c, botao) {
  botao.disabled = true;
  try {
    await api(`/api/contratos/${encodeURIComponent(c.id)}`, { metodo: "DELETE" });
    contratos = contratos.filter((x) => x.id !== c.id);
    if (editando === c.id) limparFormulario();
    avisados = Math.min(avisados, pendentes().length);
    renderContratos();
    avisoCentral("Contrato excluído com sucesso");
  } catch (e) {
    botao.disabled = false;
    toast(`Não deu para excluir: ${e.message}`, "erro");
  }
}

// Com o cotador aberto de um dia para o outro, a virada do dia refaz a lista e o aviso.
let diaDaTela = hoje();
export function conferirDiaDosContratos() {
  if (hoje() === diaDaTela) return;
  diaDaTela = hoje();
  renderContratos();
}

export function iniciarContratos() {
  $("#ctr-form").onsubmit = salvar;
  $("#ctr-cancelar").onclick = limparFormulario;
  $("#ctr-busca").addEventListener("input", renderContratos);
  $("#ctr-filtro").onchange = () => { filtro = $("#ctr-filtro").value; renderContratos(); };
  $("#ctr-fone").addEventListener("blur", () => {
    const f = normFone($("#ctr-fone").value);
    if (f.length >= 10) $("#ctr-fone").value = fmtFone(f);
  });
  $("#ctr-valor").addEventListener("blur", () => {
    const v = parseBRL($("#ctr-valor").value);
    if (v != null) $("#ctr-valor").value = brl(v);
  });
  $("#ctr-alerta").onclick = () => { filtro = "pendente"; show("contratos"); renderContratos(); scrollTo({ top: 0 }); };
}
