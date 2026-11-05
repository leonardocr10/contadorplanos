// Janela do comparativo: os planos marcados lado a lado, em uma imagem própria.
import { $, api, esc, toast } from "./estado.js";
import { paginaParaPng } from "./imagem-proposta.js";
import { closeModal, openModal } from "./planos.js";

const MAXIMO = 6;
let atual = null, sequencia = 0;

function limparAtual() {
  if (atual) URL.revokeObjectURL(atual.url);
  atual = null;
}

function escolhidos(planos) {
  const marcados = [...document.querySelectorAll("#cmp-planos input:checked")].map((c) => c.value);
  return marcados.length ? marcados : planos.slice(0, MAXIMO).map((p) => p.id);
}

async function gerar(planos, pedido) {
  const seq = ++sequencia, area = $("#cmp-previa"), botoes = $("#cmp-acoes");
  limparAtual();
  botoes.hidden = true;
  area.innerHTML = `<div class="status">Montando o comparativo…</div>`;
  try {
    const { html } = await api("/api/propostas/comparativo", { metodo: "POST", json: { ...pedido, planos: escolhidos(planos) } });
    const blob = await paginaParaPng(html);
    if (seq !== sequencia || !area.isConnected) return;
    atual = { titulo: "Comparativo de planos", blob, url: URL.createObjectURL(blob) };
    area.innerHTML = `<img src="${atual.url}" alt="Comparativo dos planos">`;
    botoes.hidden = false;
  } catch (e) {
    console.error("Falha ao gerar o comparativo:", e);
    if (seq === sequencia && area.isConnected) area.innerHTML = `<div class="status">Não consegui gerar o comparativo: ${esc(e.message)}</div>`;
  }
}

// Com mais planos do que cabem lado a lado, a pessoa escolhe quais entram.
function seletorDePlanos(planos) {
  if (planos.length <= MAXIMO) return "";
  return `<div class="note">Escolha até ${MAXIMO} planos para comparar:</div>
    <div class="cmp-planos" id="cmp-planos">${planos.map((p, i) => `<label><input type="checkbox" value="${esc(p.id)}" ${i < MAXIMO ? "checked" : ""}> ${esc(p.nome)}</label>`).join("")}</div>`;
}

function ajustarSeletor() {
  const caixas = [...document.querySelectorAll("#cmp-planos input")];
  const total = caixas.filter((c) => c.checked).length;
  // Abaixo de 2 não há o que comparar, e acima do máximo as colunas ficam ilegíveis.
  for (const c of caixas) c.disabled = c.checked ? total <= 2 : total >= MAXIMO;
}

export function abrirComparativo(planos, pedido, acoes) {
  if (planos.length < 2) { toast("Marque ao menos dois planos"); return; }
  const ed = $("#editor");
  openModal();
  ed.innerHTML = `<div class="modal-head"><h2 id="ed-title">Comparativo</h2><button class="iconbtn" id="cmp-x" aria-label="Fechar">×</button></div>
    ${seletorDePlanos(planos)}
    <div class="cmp-previa" id="cmp-previa"></div>
    <div class="actions modal-acoes" id="cmp-acoes" hidden>
      <button class="btn primary" id="cmp-copiar">Copiar e baixar imagem</button>
      <button class="btn" id="cmp-pdf">Baixar PDF</button>
    </div>`;
  $("#cmp-x").onclick = closeModal;
  $("#cmp-copiar").onclick = () => atual && acoes.copiar(atual);
  $("#cmp-pdf").onclick = (e) => atual && acoes.baixarPdf(atual, e.currentTarget);
  ajustarSeletor();
  for (const c of document.querySelectorAll("#cmp-planos input")) {
    c.onchange = () => { ajustarSeletor(); gerar(planos, pedido); };
  }
  gerar(planos, pedido);
}
