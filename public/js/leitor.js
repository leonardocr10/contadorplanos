// Tela "Leitor de documentos": lê RG, CNH e outros documentos por foto ou PDF e copia cada dado.
// A leitura acontece neste navegador, com o Tesseract: o documento não é enviado para nenhum serviço.
import { $, copiarTexto, esc, toast } from "./estado.js";
import { fileToPages, loadPdfJs } from "./atualizar.js";
import { extrairCampos } from "./documento-campos.js";

const MAX_PAGINAS = 6;
const TESSERACT = "/vendor/tesseract/";
let paginas = [], leitura = null, lendo = false, leitorP = null;

// O leitor de texto é carregado só na primeira leitura, e depois fica pronto para as próximas.
function obterLeitor(aoAvancar) {
  leitorP ||= import(TESSERACT + "tesseract.esm.min.js")
    .then(({ default: Tesseract }) => Tesseract.createWorker("por", 1, {
      workerPath: TESSERACT + "worker.min.js", corePath: TESSERACT, langPath: TESSERACT + "lang",
      logger: (m) => aoAvancar.atual?.(m),
    }))
    .catch((e) => { leitorP = null; throw e; });
  return leitorP;
}
const avanco = { atual: null };

// Foto em tons de cinza, com mais contraste e tamanho suficiente, é lida com bem menos erros.
async function prepararParaLeitura(blob) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(2.5, Math.max(1, 2000 / Math.max(bmp.width, bmp.height)));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * k);
  cv.height = Math.round(bmp.height * k);
  const ctx = cv.getContext("2d");
  ctx.filter = "grayscale(1) contrast(1.4)";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close();
  return cv;
}

// PDF gerado no computador já traz o texto: aproveitar é exato e instantâneo.
async function textoDoPdf(file) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
  const textos = [];
  for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGINAS); i++) {
    const { items } = await (await doc.getPage(i)).getTextContent();
    // Junta os pedaços pela altura na página, para cada linha do documento virar uma linha de texto.
    const linhas = new Map();
    for (const it of items) {
      if (!it.str?.trim()) continue;
      const y = Math.round(it.transform[5] / 3);
      linhas.set(y, [...(linhas.get(y) ?? []), it]);
    }
    textos.push([...linhas.entries()].sort((a, b) => b[0] - a[0]).map(([, l]) => l.sort((a, b) => a.transform[4] - b.transform[4]).map((it) => it.str).join(" ")).join("\n"));
  }
  return textos;
}

function limparPaginas() {
  paginas.forEach((p) => URL.revokeObjectURL(p.url));
  paginas = [];
}

function renderPaginas() {
  const box = $("#lei-paginas");
  box.hidden = !paginas.length;
  $("#lei-acoes").hidden = !paginas.length;
  box.innerHTML = paginas.map((p, i) => `<figure><img src="${p.url}" alt="Página ${i + 1} do documento"><button type="button" class="iconbtn" data-tirar="${i}" title="Tirar esta página" aria-label="Tirar a página ${i + 1}">×</button></figure>`).join("");
  box.querySelectorAll("[data-tirar]").forEach((b) => (b.onclick = () => {
    const [saiu] = paginas.splice(+b.dataset.tirar, 1);
    URL.revokeObjectURL(saiu.url);
    renderPaginas();
  }));
  $("#lei-ler").disabled = lendo || !paginas.length;
  $("#lei-limpar").disabled = lendo;
}

async function copiar(texto, aviso) {
  if (await copiarTexto(texto)) toast(aviso, "sucesso");
  else toast("O navegador bloqueou a cópia: selecione o texto e use Ctrl+C", "erro");
}

function renderResultado() {
  const box = $("#lei-resultado");
  box.hidden = !leitura;
  if (!leitura) return;
  const { tipoDocumento, campos, texto } = leitura;
  const lista = campos.length
    ? `<div class="lei-topo"><h3>${esc(tipoDocumento)} <span class="cat-qtd">${campos.length} ${campos.length === 1 ? "dado" : "dados"}</span></h3><button class="btn primary" type="button" id="lei-copiar-tudo">Copiar tudo</button></div>
      <p class="note" style="margin:0">Confira cada dado com o documento. Se algo estiver errado, corrija no campo antes de copiar.</p>
      <div class="lei-campos">${campos.map((c, i) => `<div class="lei-campo">
        <label for="lei-valor-${i}">${esc(c.campo)}</label>
        <div class="lei-linha"><input type="text" id="lei-valor-${i}" data-valor="${i}" value="${esc(c.valor)}" autocomplete="off"><button class="btn" type="button" data-copiar="${i}">Copiar</button></div>
      </div>`).join("")}</div>`
    : `<div class="lei-topo"><h3>${esc(tipoDocumento)}</h3></div><div class="status">Não encontrei dados conhecidos neste documento. O texto lido está abaixo para você copiar o que precisar.</div>`;
  box.innerHTML = `${lista}
    <details class="lei-texto"${campos.length ? "" : " open"}><summary>Texto lido do documento</summary>
      <textarea id="lei-texto" rows="10" spellcheck="false">${esc(texto)}</textarea>
      <div class="actions"><button class="btn" type="button" id="lei-copiar-texto">Copiar o texto</button></div>
    </details>`;
  box.querySelectorAll("[data-valor]").forEach((inp) => (inp.oninput = () => (campos[+inp.dataset.valor].valor = inp.value)));
  box.querySelectorAll("[data-copiar]").forEach((b) => (b.onclick = () => {
    const c = campos[+b.dataset.copiar];
    copiar(c.valor, `${c.campo} copiado`);
  }));
  const tudo = $("#lei-copiar-tudo");
  if (tudo) tudo.onclick = () => copiar(campos.map((c) => `${c.campo}: ${c.valor}`).join("\n"), "Todos os dados foram copiados");
  $("#lei-copiar-texto").onclick = () => copiar($("#lei-texto").value, "Texto copiado");
}

function andamento(texto) {
  $("#lei-andamento").hidden = !texto;
  $("#lei-andamento").textContent = texto || "";
}

async function adicionarArquivos(arquivos) {
  const validos = [...arquivos].filter((f) => f.type === "application/pdf" || f.type.startsWith("image/"));
  if (!validos.length) { toast("Envie um PDF ou uma foto do documento.", "erro"); return; }
  leitura = null;
  renderResultado();
  try {
    for (const f of validos) {
      const restam = MAX_PAGINAS - paginas.length;
      if (restam <= 0) { toast(`O leitor usa até ${MAX_PAGINAS} páginas por documento.`); break; }
      const novas = (await fileToPages(f, (i, n) => andamento(`Abrindo página ${i} de ${n}…`), restam)).slice(0, restam);
      if (f.type === "application/pdf") {
        const textos = await textoDoPdf(f).catch(() => []);
        novas.forEach((p, i) => (p.texto = textos[i] ?? ""));
      }
      paginas.push(...novas);
    }
  } catch {
    toast("Não consegui abrir este arquivo. Tente um PDF ou uma foto em JPG ou PNG.", "erro");
  }
  andamento("");
  renderPaginas();
}

async function ler() {
  if (!paginas.length || lendo) return;
  lendo = true;
  renderPaginas();
  try {
    const textos = [];
    for (const [i, p] of paginas.entries()) {
      // Página com texto de verdade no PDF dispensa a leitura da imagem.
      if ((p.texto ?? "").replace(/\s/g, "").length >= 40) { textos.push(p.texto); continue; }
      const prefixo = paginas.length > 1 ? `Página ${i + 1} de ${paginas.length}: ` : "";
      avanco.atual = (m) => {
        if (m.status === "recognizing text") andamento(`${prefixo}lendo o texto… ${Math.round(m.progress * 100)}%`);
        else andamento(`${prefixo}preparando o leitor (só na primeira vez)…`);
      };
      andamento(`${prefixo}preparando o leitor…`);
      const leitor = await obterLeitor(avanco);
      const { data } = await leitor.recognize(await prepararParaLeitura(p.blob));
      textos.push(data.text);
    }
    const texto = textos.join("\n").trim();
    leitura = { ...extrairCampos(texto), texto };
    renderResultado();
    if (leitura.campos.length) toast("Documento lido", "sucesso");
    else toast(texto ? "Não encontrei dados conhecidos: veja o texto lido" : "Não consegui ler texto nas imagens. Tente uma foto mais nítida e reta.", texto ? "aviso" : "erro");
  } catch {
    toast("Não consegui ler o documento. Tente de novo ou use uma foto mais nítida.", "erro");
  } finally {
    avanco.atual = null;
    lendo = false;
    andamento("");
    renderPaginas();
  }
}

export function iniciarLeitor() {
  const zona = $("#lei-zona"), arquivo = $("#lei-arquivo");
  zona.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); arquivo.click(); } };
  arquivo.onchange = () => { adicionarArquivos(arquivo.files).finally(() => (arquivo.value = "")); };
  zona.ondragover = (e) => { e.preventDefault(); zona.classList.add("arrastando"); };
  zona.ondragleave = () => zona.classList.remove("arrastando");
  zona.ondrop = (e) => { e.preventDefault(); zona.classList.remove("arrastando"); adicionarArquivos(e.dataTransfer.files); };
  $("#lei-ler").onclick = ler;
  $("#lei-limpar").onclick = () => { limparPaginas(); leitura = null; renderPaginas(); renderResultado(); };
}
