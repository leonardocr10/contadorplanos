// Janela para ver os documentos dos clientes (Contratos Vendidos e Aceites) sem sair do cotador.
// Foto aparece inteira na tela, com Ampliar; PDF mostra todas as páginas, uma embaixo da outra.
import { esc } from "./estado.js";
import { carregarPdfJs, copiaLocal, ehPdf, PDFJS } from "./contratos.js";

let janela = null, lista = [], indice = 0, ampliado = false, desenho = 0;

// Abre a janela no arquivo indicado; a lista permite passar para os outros do mesmo cliente.
// Cada item: { id, nome, tipo, url, urlBaixar, detalhe }.
export function abrirDocumento(itens, i) {
  lista = itens;
  indice = i;
  ampliado = false;
  criarJanela();
  pintar();
  if (!janela.open) janela.showModal();
  janela.querySelector("[data-fechar]").focus();
}

// Liga os links "Abrir", o nome e a miniatura de um painel à janela. Ctrl, Shift ou o botão do meio
// continuam abrindo em outra aba, para quem preferir.
export function ligarVisualizacao(painel, itens) {
  painel.querySelectorAll("[data-ver]").forEach((el) => {
    el.onclick = (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      const i = itens.findIndex((x) => x.id === el.dataset.ver);
      if (i < 0) return;
      e.preventDefault();
      abrirDocumento(itens, i);
    };
  });
}

function criarJanela() {
  if (janela) return;
  janela = document.createElement("dialog");
  janela.className = "visor visor-doc";
  janela.setAttribute("aria-labelledby", "visor-doc-titulo");
  janela.innerHTML = `<header class="visor-topo">
      <div class="visor-nome"><h2 id="visor-doc-titulo"></h2><span class="note" data-detalhe></span></div>
      <div class="visor-botoes">
        <button class="btn" type="button" data-ampliar aria-pressed="false">Ampliar</button>
        <button class="btn" type="button" data-ant>Anterior</button>
        <button class="btn" type="button" data-prox>Próximo</button>
        <a class="btn" data-baixar>Baixar</a>
        <button class="gaveta-fechar" type="button" data-fechar aria-label="Fechar">×</button>
      </div>
    </header>
    <div class="visor-corpo" data-corpo></div>`;
  document.body.append(janela);
  janela.querySelector("[data-fechar]").onclick = () => janela.close();
  janela.querySelector("[data-ant]").onclick = () => passar(-1);
  janela.querySelector("[data-prox]").onclick = () => passar(1);
  janela.querySelector("[data-ampliar]").onclick = () => definirAmpliado(!ampliado);
  // Clique fora da janela fecha; setas passam de documento.
  janela.onclick = (e) => { if (e.target === janela) janela.close(); };
  janela.onkeydown = (e) => {
    if (e.key === "ArrowLeft" && lista.length > 1) { e.preventDefault(); passar(-1); }
    if (e.key === "ArrowRight" && lista.length > 1) { e.preventDefault(); passar(1); }
  };
  janela.onclose = () => { desenho++; janela.querySelector("[data-corpo]").innerHTML = ""; };
}

function passar(passo) {
  indice = (indice + passo + lista.length) % lista.length;
  ampliado = false;
  pintar();
}

function definirAmpliado(ligado) {
  ampliado = ligado;
  const corpo = janela.querySelector("[data-corpo]"), botao = janela.querySelector("[data-ampliar]");
  corpo.classList.toggle("zoom", ligado);
  corpo.scrollTo(0, 0);
  botao.textContent = ligado ? "Ajustar à tela" : "Ampliar";
  botao.setAttribute("aria-pressed", String(ligado));
}

async function pintar() {
  const doc = lista[indice], pdf = ehPdf(doc), vez = ++desenho;
  janela.querySelector("#visor-doc-titulo").textContent = doc.nome;
  janela.querySelector("[data-detalhe]").textContent = [doc.detalhe, lista.length > 1 ? `${indice + 1} de ${lista.length}` : ""].filter(Boolean).join(" · ");
  janela.querySelector("[data-ant]").hidden = janela.querySelector("[data-prox]").hidden = lista.length < 2;
  janela.querySelector("[data-ampliar]").hidden = pdf;
  const baixar = janela.querySelector("[data-baixar]");
  baixar.href = doc.urlBaixar;
  const corpo = janela.querySelector("[data-corpo]");
  corpo.className = `visor-corpo${pdf ? " pdf" : ""}`;
  definirAmpliado(false);
  corpo.innerHTML = `<p class="visor-espera"><span class="ctr-girando" aria-hidden="true"></span> Carregando…</p>`;
  try {
    const url = await copiaLocal(doc.url, doc);
    if (vez !== desenho) return;
    if (!pdf) {
      corpo.innerHTML = `<img src="${esc(url)}" alt="${esc(doc.nome)}">`;
      corpo.querySelector("img").onclick = () => definirAmpliado(!ampliado);
      return;
    }
    await desenharPdf(url, corpo, vez);
  } catch {
    if (vez !== desenho) return;
    corpo.innerHTML = `<p class="visor-espera">Não deu para mostrar este documento aqui. Use <b>Baixar</b> para abrir no computador.</p>`;
  }
}

// Cada página vira uma imagem na largura da janela, nítida também em telas de alta resolução.
async function desenharPdf(url, corpo, vez) {
  const lib = await carregarPdfJs();
  const tarefa = lib.getDocument({ url, isEvalSupported: false, cMapUrl: PDFJS + "cmaps/", cMapPacked: true, standardFontDataUrl: PDFJS + "standard_fonts/", wasmUrl: PDFJS + "wasm/" });
  try {
    const pdf = await tarefa.promise;
    if (vez !== desenho) return;
    corpo.innerHTML = "";
    // Janela ainda sem tamanho (aba em segundo plano): usa uma largura comum de leitura.
    const largura = corpo.clientWidth > 324 ? Math.min(corpo.clientWidth - 24, 1100) : 900, nitidez = Math.min(window.devicePixelRatio || 1, 2);
    for (let n = 1; n <= pdf.numPages; n++) {
      const pagina = await pdf.getPage(n);
      const base = pagina.getViewport({ scale: 1 });
      const vp = pagina.getViewport({ scale: (largura / base.width) * nitidez });
      const tela = document.createElement("canvas");
      tela.width = Math.round(vp.width);
      tela.height = Math.round(vp.height);
      tela.style.width = `${Math.round(vp.width / nitidez)}px`;
      tela.setAttribute("aria-label", `Página ${n} de ${pdf.numPages}`);
      await pagina.render({ canvasContext: tela.getContext("2d"), viewport: vp }).promise;
      if (vez !== desenho) return;
      corpo.append(tela);
    }
  } finally {
    tarefa.destroy();
  }
}
