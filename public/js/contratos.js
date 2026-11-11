// Tela "Contratos vendidos": cadastro dos planos vendidos e o aviso de contato no dia da ativação.
import { brl, fmtFone, normFone, parseBRL } from "./calculo.js";
import { $, S, api, avisoCentral, esc, pode, show, toast } from "./estado.js";
import { linkConversaDireta, mensagemAtivacao } from "./mensagem.js";

let contratos = [], carregados = false, erro = null, editando = null, filtro = "todos", mes = "todos";
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const nomeDoMes = (aaaamm) => `${MESES[Number(aaaamm.slice(5, 7)) - 1]} de ${aaaamm.slice(0, 4)}`;
// Mensagem do WhatsApp aberta para edição: { id do contrato, texto }.
let mensagem = null;
// Contrato com a lista de documentos aberta.
let docsAbertos = null;
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
  // Meses que têm contrato, do mais recente para o mais antigo, com a quantidade de cada um.
  const meses = [...new Set(contratos.map((c) => c.ativacao.slice(0, 7)))].sort().reverse();
  if (mes !== "todos" && !meses.includes(mes)) mes = "todos";
  const selMes = $("#ctr-mes");
  const opcoesMes = `<option value="todos" data-icone="todos">Todos os meses</option>${meses.length ? `<optgroup label="Meses">${meses.map((m) => `<option value="${m}" data-selo="${contratos.filter((c) => c.ativacao.startsWith(m)).length}">${nomeDoMes(m)}</option>`).join("")}</optgroup>` : ""}`;
  if (selMes.dataset.opcoes !== opcoesMes) { selMes.innerHTML = opcoesMes; selMes.dataset.opcoes = opcoesMes; }
  selMes.value = mes;
  const box = $("#ctr-list");
  if (!carregados) { box.innerHTML = `<div class="status">${erro ? esc(erro) : "Carregando contratos…"}</div>`; return; }
  $("#ctr-count").textContent = `${contratos.length} ${contratos.length === 1 ? "contrato" : "contratos"} · ${quantos("pendente")} para contatar`;
  if (!contratos.length) { box.innerHTML = `<div class="status">Nenhum contrato cadastrado ainda. Preencha os dados acima e clique em <b>Cadastrar contrato</b>.</div>`; return; }
  const q = $("#ctr-busca").value.trim().toLowerCase(), qd = q.replace(/\D/g, "");
  const lista = ordenar(contratos, dia).filter((c) => {
    if (filtro !== "todos" && situacao(c, dia).chave !== filtro) return false;
    if (mes !== "todos" && !c.ativacao.startsWith(mes)) return false;
    if (!q) return true;
    return c.nome.toLowerCase().includes(q) || c.plano.toLowerCase().includes(q) || (qd.length >= 3 && c.fone.includes(qd));
  });
  if (!lista.length) { box.innerHTML = `<div class="status">Nenhum contrato encontrado.</div>`; return; }
  const edita = pode("contratos", "editar");
  box.innerHTML = lista.map((c) => {
    const st = situacao(c, dia);
    return `<div class="hq ctr-item${st.chave === "pendente" ? " ctr-pendente" : ""}" data-id="${esc(c.id)}">
      <div class="hq-top"><span class="hg-name">${esc(c.nome)}</span><span class="pill ${st.classe}">${esc(st.rotulo)}</span></div>
      <div class="hq-date">${esc(fmtFone(c.fone))} · ativação em ${esc(fmtDia(c.ativacao))}${c.contatoEm ? ` · contato feito em ${esc(new Date(c.contatoEm).toLocaleDateString("pt-BR"))}` : ""}</div>
      <div class="hq-plans"><b>${esc(c.plano)}</b> · R$ ${brl(c.valor)}</div>
      <div class="actions">
        ${edita ? `<button class="btn ${st.chave === "pendente" ? "primary" : ""}" data-mensagem aria-expanded="${mensagem?.id === c.id}">Mensagem no WhatsApp</button>
        ${st.chave === "aguardando" ? "" : `<button class="btn" data-contato="${c.contatoEm ? "0" : "1"}">${c.contatoEm ? "Desfazer contato" : "Marcar contato feito"}</button>`}` : ""}
        <button class="btn" data-documentos aria-expanded="${docsAbertos === c.id}">Documentos${c.arquivos.length ? ` <span class="ctr-qtd">${c.arquivos.length}</span>` : ""}</button>
        ${edita ? `<button class="btn" data-editar>Editar</button>
        <button class="btn danger" data-excluir>Excluir</button>` : ""}
      </div>
      ${docsAbertos === c.id ? painelDeDocumentos(c, edita) : ""}
      ${edita ? `${mensagem?.id === c.id ? `<div class="ctr-msg" data-painel-msg>
        <label class="label" for="ctr-msg-texto">Mensagem para ${esc(c.nome)}</label>
        <textarea id="ctr-msg-texto" rows="8" spellcheck="true">${esc(mensagem.texto)}</textarea>
        <div class="actions">
          <button class="btn primary" data-msg-abrir>Abrir no WhatsApp</button>
          <button class="btn" data-msg-copiar>Copiar mensagem</button>
          <button class="btn" data-msg-original>Voltar ao texto original</button>
          <button class="btn" data-msg-fechar>Fechar</button>
        </div>
      </div>` : ""}
      <div class="status" data-confirma hidden>Excluir o contrato de <b>${esc(c.nome)}</b>? <span class="actions" style="margin-top:8px"><button class="btn danger" data-sim>Sim, excluir</button><button class="btn" data-nao>Manter</button></span></div>` : ""}
    </div>`;
  }).join("");
  const doItem = (el) => contratos.find((c) => c.id === el.closest(".hq").dataset.id);
  box.querySelectorAll("[data-contato]").forEach((b) => (b.onclick = () => marcarContato(doItem(b), b.dataset.contato === "1", b)));
  box.querySelectorAll("[data-mensagem]").forEach((b) => (b.onclick = () => abrirMensagem(doItem(b))));
  const painel = box.querySelector("[data-painel-msg]");
  if (painel) {
    const c = doItem(painel), campo = painel.querySelector("textarea");
    // O texto editado fica guardado: redesenhar a lista não perde o que foi escrito.
    campo.oninput = () => (mensagem.texto = campo.value);
    painel.querySelector("[data-msg-abrir]").onclick = () => {
      if (!campo.value.trim()) return toast("Escreva a mensagem antes de abrir o WhatsApp.", "erro");
      window.open(linkConversaDireta(c.fone, campo.value, navigator.userAgent), "_blank", "noopener");
    };
    painel.querySelector("[data-msg-copiar]").onclick = async () => {
      try {
        await navigator.clipboard.writeText(campo.value);
        avisoCentral("Mensagem copiada com sucesso");
      } catch {
        campo.select();
        toast("Não deu para copiar sozinho: o texto ficou selecionado, use Ctrl+C.", "erro");
      }
    };
    painel.querySelector("[data-msg-original]").onclick = () => {
      mensagem.texto = textoOriginal(c);
      campo.value = mensagem.texto;
      campo.focus();
    };
    painel.querySelector("[data-msg-fechar]").onclick = () => { mensagem = null; renderContratos(); };
  }
  box.querySelectorAll("[data-documentos]").forEach((b) => (b.onclick = () => { docsAbertos = docsAbertos === doItem(b).id ? null : doItem(b).id; renderContratos(); }));
  const docs = box.querySelector("[data-painel-docs]");
  if (docs) ligarDocumentos(docs, doItem(docs));
  box.querySelectorAll("[data-editar]").forEach((b) => (b.onclick = () => editar(doItem(b))));
  box.querySelectorAll("[data-excluir]").forEach((b) => (b.onclick = () => (b.closest(".hq").querySelector("[data-confirma]").hidden = false)));
  box.querySelectorAll("[data-nao]").forEach((b) => (b.onclick = () => (b.closest("[data-confirma]").hidden = true)));
  box.querySelectorAll("[data-sim]").forEach((b) => (b.onclick = () => excluir(doItem(b), b)));
}

/* ---------- documentos enviados pelo cliente ---------- */
const ACEITOS = ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";
const MAX_ARQUIVO = 20 * 1024 * 1024;
const fmtTamanho = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const urlDoArquivo = (c, a, baixar) => `/api/contratos/${encodeURIComponent(c.id)}/arquivos/${encodeURIComponent(a.id)}${baixar ? "?baixar=1" : ""}`;

// Arquivos que ainda estão subindo, por contrato: aparecem na lista na hora, como "Salvando…".
const emEnvio = new Map();

// Cada arquivo é baixado uma vez só e fica na memória da página: miniatura e visualização usam a mesma cópia.
const PDFJS = "/vendor/pdfjs/";
let pdfjsP = null;
const carregarPdfJs = () => (pdfjsP ||= import(PDFJS + "pdf.min.mjs")
  .then((lib) => { lib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.mjs"; return lib; })
  .catch((e) => { pdfjsP = null; throw e; }));
const copias = new Map(), miniaturas = new Map();
function copiaLocal(c, a) {
  if (!copias.has(a.id)) {
    copias.set(a.id, fetch(urlDoArquivo(c, a))
      .then((r) => { if (!r.ok) throw new Error("Documento não encontrado."); return r.blob(); })
      .then((b) => URL.createObjectURL(b))
      .catch((e) => { copias.delete(a.id); throw e; }));
  }
  return copias.get(a.id);
}
// Imagem: a própria foto. PDF: a primeira página desenhada pelo leitor de PDF do sistema.
async function gerarMiniatura(c, a) {
  const url = await copiaLocal(c, a);
  if (a.tipo !== "application/pdf") return url;
  const lib = await carregarPdfJs();
  const tarefa = lib.getDocument({ url, isEvalSupported: false, cMapUrl: PDFJS + "cmaps/", cMapPacked: true, standardFontDataUrl: PDFJS + "standard_fonts/", wasmUrl: PDFJS + "wasm/" });
  try {
    const doc = await tarefa.promise;
    const pagina = await doc.getPage(1);
    const base = pagina.getViewport({ scale: 1 });
    const vp = pagina.getViewport({ scale: 240 / base.width });
    const tela = document.createElement("canvas");
    tela.width = Math.round(vp.width);
    tela.height = Math.round(vp.height);
    await pagina.render({ canvasContext: tela.getContext("2d"), viewport: vp }).promise;
    return tela.toDataURL("image/jpeg", 0.8);
  } finally {
    tarefa.destroy();
  }
}
const miniatura = (c, a) => {
  if (!miniaturas.has(a.id)) miniaturas.set(a.id, gerarMiniatura(c, a).then((src) => { miniaturas.set(a.id, src); return src; }, (e) => { miniaturas.delete(a.id); throw e; }));
  return miniaturas.get(a.id);
};
const miniaturaPronta = (id) => (typeof miniaturas.get(id) === "string" ? miniaturas.get(id) : null);
function esquecerArquivo(id) {
  copias.get(id)?.then((url) => URL.revokeObjectURL(url), () => {});
  copias.delete(id);
  miniaturas.delete(id);
}

const ehPdf = (a) => a.tipo === "application/pdf";

function painelDeDocumentos(c, edita) {
  const subindo = emEnvio.get(c.id) ?? [];
  const mini = (a) => {
    const src = miniaturaPronta(a.id);
    return `<a class="ctr-doc-mini" data-mini="${esc(a.id)}" href="${esc(urlDoArquivo(c, a))}" target="_blank" rel="noopener" title="Abrir ${esc(a.nome)}">${src ? `<img src="${esc(src)}" alt="">` : `<span>${ehPdf(a) ? "PDF" : "IMG"}</span>`}</a>`;
  };
  const linhas = c.arquivos.map((a) => `<li class="ctr-doc-linha" data-arquivo="${esc(a.id)}">
      ${mini(a)}
      <span class="ctr-doc-texto"><a href="${esc(urlDoArquivo(c, a))}" target="_blank" rel="noopener" title="${esc(a.nome)}">${esc(a.nome)}</a><span class="note">${ehPdf(a) ? "PDF" : "Imagem"} · ${fmtTamanho(a.tamanho)} · ${esc(new Date(a.criadoEm).toLocaleDateString("pt-BR"))}</span></span>
      <span class="ctr-doc-acoes">
        <a class="limpar-filtros" href="${esc(urlDoArquivo(c, a))}" target="_blank" rel="noopener">Abrir</a>
        <a class="limpar-filtros" href="${esc(urlDoArquivo(c, a, true))}">Baixar</a>
        ${edita ? `<button type="button" class="limpar-filtros" data-tirar>Excluir</button>` : ""}
      </span>
      <span class="doc-confirma ctr-doc-confirma" hidden>Excluir este documento? <button type="button" class="limpar-filtros" data-tirar-sim>Sim</button><button type="button" class="limpar-filtros" data-tirar-nao>Não</button></span>
    </li>`).join("") + subindo.map((a) => `<li class="ctr-doc-linha ctr-doc-subindo">
      <span class="ctr-doc-mini"><span class="ctr-girando" aria-hidden="true"></span></span>
      <span class="ctr-doc-texto"><b title="${esc(a.nome)}">${esc(a.nome)}</b><span class="note">${a.reduzindo ? "Preparando…" : "Salvando…"}</span></span>
    </li>`).join("");
  return `<div class="ctr-docs" data-painel-docs>
    <div class="ctr-docs-topo"><span class="label">Documentos do cliente${c.arquivos.length ? ` · ${c.arquivos.length}` : ""}</span>${edita ? `<span class="note">PDF, JPG, PNG ou WebP, sem limite de quantidade. Pode arrastar os arquivos para cá.</span>` : ""}</div>
    ${linhas ? `<ul class="ctr-docs-lista">${linhas}</ul>` : `<p class="note" style="margin:0">Nenhum documento salvo ainda.</p>`}
    ${edita ? `<div class="actions"><label class="btn primary" tabindex="0" data-escolher>Adicionar documentos<input type="file" multiple accept="${ACEITOS}" hidden data-arquivos></label></div>` : ""}
  </div>`;
}

// Preenche as miniaturas que ainda não estavam prontas.
function mostrarMiniaturas(painel, c) {
  for (const el of painel.querySelectorAll("[data-mini]")) {
    if (el.querySelector("img")) continue;
    const a = c.arquivos.find((x) => x.id === el.dataset.mini);
    if (a) miniatura(c, a).then((src) => { if (el.isConnected) el.innerHTML = `<img src="${esc(src)}" alt="">`; }, () => {});
  }
}

function ligarDocumentos(painel, c) {
  mostrarMiniaturas(painel, c);
  painel.querySelectorAll("[data-tirar]").forEach((b) => (b.onclick = () => (b.closest("li").querySelector(".ctr-doc-confirma").hidden = false)));
  painel.querySelectorAll("[data-tirar-nao]").forEach((b) => (b.onclick = () => (b.closest(".ctr-doc-confirma").hidden = true)));
  painel.querySelectorAll("[data-tirar-sim]").forEach((b) => (b.onclick = () => tirarDocumento(c, b.closest("li").dataset.arquivo, b)));
  const entrada = painel.querySelector("[data-arquivos]");
  if (!entrada) return;
  const escolher = painel.querySelector("[data-escolher]");
  escolher.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); entrada.click(); } };
  entrada.onchange = () => { const arquivos = [...entrada.files]; entrada.value = ""; enviarDocumentos(c, arquivos, painel); };
  painel.ondragover = (e) => { e.preventDefault(); painel.classList.add("arrastando"); };
  painel.ondragleave = (e) => { if (!painel.contains(e.relatedTarget)) painel.classList.remove("arrastando"); };
  painel.ondrop = (e) => { e.preventDefault(); painel.classList.remove("arrastando"); enviarDocumentos(c, [...e.dataTransfer.files], painel); };
}

// Foto de celular tem vários MB: reduzida para até 2000 px em JPEG, sobe muito mais rápido e continua legível.
// PDF e imagem já pequena vão como estão.
const LADO_MAXIMO = 2000, REDUZIR_ACIMA_DE = 500 * 1024;
async function reduzirImagem(arquivo) {
  if (!/^image\/(jpeg|png|webp)$/.test(arquivo.type) || arquivo.size <= REDUZIR_ACIMA_DE) return arquivo;
  try {
    const imagem = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
    const escala = Math.min(1, LADO_MAXIMO / Math.max(imagem.width, imagem.height));
    const tela = document.createElement("canvas");
    tela.width = Math.round(imagem.width * escala);
    tela.height = Math.round(imagem.height * escala);
    const ctx = tela.getContext("2d");
    // PNG com transparência fica com fundo branco no JPEG.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, tela.width, tela.height);
    ctx.drawImage(imagem, 0, 0, tela.width, tela.height);
    imagem.close();
    const blob = await new Promise((ok) => tela.toBlob(ok, "image/jpeg", 0.85));
    if (!blob || blob.size >= arquivo.size) return arquivo;
    return new File([blob], arquivo.name.replace(/\.(png|webp|jpe?g)$/i, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return arquivo;
  }
}

// Até 3 arquivos sobem ao mesmo tempo; cada um entra na lista assim que termina, e um erro não perde os outros.
const ENVIOS_SIMULTANEOS = 3;
async function enviarDocumentos(c, arquivos) {
  if (!arquivos.length) return;
  const fila = arquivos.map((arquivo) => ({ arquivo, nome: arquivo.name, pdf: arquivo.type === "application/pdf" || /\.pdf$/i.test(arquivo.name), reduzindo: true }));
  emEnvio.set(c.id, [...(emEnvio.get(c.id) ?? []), ...fila]);
  docsAbertos = c.id;
  renderContratos();
  const erros = [];
  let salvos = 0, proximo = 0;
  const sair = (item) => {
    const lista = (emEnvio.get(c.id) ?? []).filter((x) => x !== item);
    if (lista.length) emEnvio.set(c.id, lista); else emEnvio.delete(c.id);
  };
  const trabalhar = async () => {
    while (proximo < fila.length) {
      const item = fila[proximo++];
      try {
        const arquivo = await reduzirImagem(item.arquivo);
        if (arquivo.size > MAX_ARQUIVO) throw new Error("maior que 20 MB");
        item.nome = arquivo.name;
        item.reduzindo = false;
        renderContratos();
        const novo = await api(`/api/contratos/${encodeURIComponent(c.id)}/arquivos`, { metodo: "POST", corpo: arquivo, tipo: arquivo.type || "application/octet-stream", cabecalhos: { "X-Nome-Arquivo": encodeURIComponent(arquivo.name) } });
        c.arquivos.push(novo);
        salvos++;
      } catch (e) {
        erros.push(`${item.arquivo.name}: ${e.message}`);
      }
      sair(item);
      renderContratos();
    }
  };
  await Promise.all(Array.from({ length: Math.min(ENVIOS_SIMULTANEOS, fila.length) }, trabalhar));
  // A ordem da lista é a do servidor (a de chegada).
  c.arquivos.sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
  renderContratos();
  if (erros.length) toast(`${salvos ? `${salvos} salvo${salvos === 1 ? "" : "s"}. ` : ""}Não deu para salvar ${erros.join("; ")}`, "erro");
  else avisoCentral(salvos === 1 ? "Documento salvo com sucesso" : `${salvos} documentos salvos com sucesso`);
}

async function tirarDocumento(c, id, botao) {
  botao.disabled = true;
  try {
    await api(`/api/contratos/${encodeURIComponent(c.id)}/arquivos/${encodeURIComponent(id)}`, { metodo: "DELETE" });
    c.arquivos = c.arquivos.filter((a) => a.id !== id);
    esquecerArquivo(id);
    renderContratos();
    avisoCentral("Documento excluído com sucesso");
  } catch (e) {
    botao.disabled = false;
    toast(`Não deu para excluir: ${e.message}`, "erro");
  }
}

const textoOriginal = (c) => mensagemAtivacao({ cliente: c.nome, plano: c.plano, corretor: S.cor });

// Abre (ou fecha) a mensagem do contrato para editar antes de mandar.
function abrirMensagem(c) {
  mensagem = mensagem?.id === c.id ? null : { id: c.id, texto: textoOriginal(c) };
  renderContratos();
  const campo = $("#ctr-msg-texto");
  if (campo) { campo.focus(); campo.setSelectionRange(0, 0); campo.scrollTop = 0; }
}

// Sugestões do campo plano: os nomes dos planos cadastrados, sem impedir outro nome.
// Plano do contrato em edição que não existe mais na lista: entra como opção para não se perder.
let planoAntigo = "";
export function atualizarPlanosDoContrato() {
  const ordem = (a, b) => a.localeCompare(b, "pt-BR");
  const grupo = (cat) => [...new Set(S.plans.filter((p) => p.categoria === cat).map((p) => p.nome))].sort(ordem);
  const todos = new Set(S.plans.map((p) => p.nome));
  const opcao = (n) => `<option value="${esc(n)}">${esc(n)}</option>`;
  const html = `<option value="">Selecionar plano</option>`
    + (planoAntigo && !todos.has(planoAntigo) ? `<optgroup label="Plano do contrato">${opcao(planoAntigo)}</optgroup>` : "")
    + [["PF", "Pessoa física"], ["CNPJ", "CNPJ"]].map(([cat, rotulo]) => {
      const nomes = grupo(cat);
      return nomes.length ? `<optgroup label="${rotulo}">${nomes.map(opcao).join("")}</optgroup>` : "";
    }).join("");
  const sel = $("#ctr-plano");
  if (sel.dataset.html === html) return;
  const valor = sel.value;
  sel.innerHTML = html;
  sel.dataset.html = html;
  sel.value = valor;
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
  planoAntigo = "";
  atualizarPlanosDoContrato();
  $("#ctr-salvar").textContent = "Cadastrar contrato";
  $("#ctr-cancelar").hidden = true;
}

function editar(c) {
  editando = c.id;
  $("#ctr-nome").value = c.nome;
  $("#ctr-fone").value = fmtFone(c.fone);
  planoAntigo = c.plano;
  atualizarPlanosDoContrato();
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
  if (!d.plano) return toast("Selecione o plano contratado.", "erro");
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
    if (mensagem?.id === c.id) mensagem = null;
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
  $("#ctr-mes").onchange = () => { mes = $("#ctr-mes").value; renderContratos(); };
  $("#ctr-fone").addEventListener("blur", () => {
    const f = normFone($("#ctr-fone").value);
    if (f.length >= 10) $("#ctr-fone").value = fmtFone(f);
  });
  $("#ctr-valor").addEventListener("blur", () => {
    const v = parseBRL($("#ctr-valor").value);
    if (v != null) $("#ctr-valor").value = brl(v);
  });
  $("#ctr-alerta").onclick = () => { filtro = "pendente"; mes = "todos"; show("contratos"); renderContratos(); scrollTo({ top: 0 }); };
}
