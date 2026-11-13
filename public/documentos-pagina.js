// Página pública do envio de documentos: lista o que o plano pede, envia um arquivo por vez e mostra
// o andamento. Cada arquivo fica guardado assim que chega: o cliente pode parar e continuar depois.
const app = document.getElementById("app");
const BASE = app.dataset.base, WHATSAPP = app.dataset.whatsapp, PROPOSTA = app.dataset.proposta;

let estado = null;
// Envios em andamento e avisos de erro, por documento: sobrevivem a cada redesenho da lista.
const enviando = new Map(), erros = new Map();
// Cartões abertos e a confirmação do último envio de cada documento: só a tela, nada é guardado no aparelho.
const abertos = new Set(), recebidos = new Map();
let editando = false, primeiraVez = true;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtFone = (d) => (d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const tamanho = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

async function pedir(rota, opcoes = {}) {
  const r = await fetch(BASE + rota, { credentials: "same-origin", ...opcoes });
  // O acesso venceu ou foi encerrado: a página de entrada pede o telefone de novo.
  if (r.status === 401) { location.reload(); throw new Error("Informe o seu telefone para continuar."); }
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(corpo.erro || "Não deu para concluir agora. Tente de novo em instantes."), { campo: corpo.campo });
  return corpo;
}

/* ---------- envio ---------- */
// Foto de celular costuma ter vários MB: reduzida para um tamanho ainda bem legível, sobe muito mais rápido.
const LADO_MAXIMO = 2200, QUALIDADE = 0.85, SO_REDUZ_ACIMA_DE = 900 * 1024;
async function preparar(arquivo) {
  const pronta = ["image/jpeg", "image/png", "image/webp"].includes(arquivo.type);
  if (arquivo.type === "application/pdf" || !arquivo.type.startsWith("image/")) return arquivo;
  if (pronta && arquivo.size <= SO_REDUZ_ACIMA_DE) return arquivo;
  try {
    const imagem = await createImageBitmap(arquivo);
    const escala = Math.min(1, LADO_MAXIMO / Math.max(imagem.width, imagem.height));
    const tela = document.createElement("canvas");
    tela.width = Math.round(imagem.width * escala);
    tela.height = Math.round(imagem.height * escala);
    tela.getContext("2d").drawImage(imagem, 0, 0, tela.width, tela.height);
    imagem.close?.();
    const reduzida = await new Promise((ok) => tela.toBlob(ok, "image/jpeg", QUALIDADE));
    if (!reduzida || (pronta && reduzida.size >= arquivo.size)) return arquivo;
    return new File([reduzida], arquivo.name.replace(/\.[^.]*$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    // Formato que o navegador não abre: segue o original, e o servidor diz se aceita.
    return arquivo;
  }
}

// XMLHttpRequest, e não fetch, para mostrar quanto do arquivo já subiu.
function subir(documento, arquivo, aoAndar) {
  return new Promise((ok, falha) => {
    const x = new XMLHttpRequest();
    x.open("POST", BASE + "/arquivos");
    x.setRequestHeader("Content-Type", "application/octet-stream");
    x.setRequestHeader("X-Documento", encodeURIComponent(documento));
    x.setRequestHeader("X-Nome-Arquivo", encodeURIComponent(arquivo.name || ""));
    x.upload.onprogress = (e) => e.lengthComputable && aoAndar(e.loaded / e.total);
    x.onerror = () => falha(new Error("A conexão caiu. O que já foi enviado está guardado: tente este arquivo de novo."));
    x.onload = () => {
      if (x.status === 401) { location.reload(); return; }
      let corpo = {};
      try { corpo = JSON.parse(x.responseText); } catch { /* resposta sem JSON */ }
      if (x.status >= 200 && x.status < 300) ok(corpo);
      else falha(new Error(corpo.erro || (x.status === 413 ? "Este arquivo passa de 20 MB. Envie uma foto ou um PDF menor." : "Não deu para enviar. Tente de novo em instantes.")));
    };
    x.send(arquivo);
  });
}

async function enviarArquivos(documento, arquivos) {
  if (!arquivos.length || enviando.has(documento)) return;
  erros.delete(documento);
  recebidos.delete(documento);
  abertos.add(documento);
  const falhas = [];
  let certos = 0;
  for (let i = 0; i < arquivos.length; i++) {
    const rotulo = arquivos.length > 1 ? `Enviando ${i + 1} de ${arquivos.length}…` : "Enviando…";
    enviando.set(documento, { rotulo, parte: 0 });
    desenhar();
    try {
      const pronto = await preparar(arquivos[i]);
      if (pronto.size > estado.limite) throw new Error("passa de 20 MB. Envie uma foto ou um PDF menor.");
      estado = await subir(documento, pronto, (parte) => {
        enviando.set(documento, { rotulo, parte });
        const barra = document.querySelector(`[data-andamento="${CSS.escape(documento)}"] i`);
        if (barra) barra.style.width = `${Math.round(parte * 100)}%`;
      });
      certos++;
    } catch (e) {
      falhas.push(arquivos.length > 1 ? `${arquivos[i].name}: ${e.message}` : e.message);
    }
  }
  enviando.delete(documento);
  if (falhas.length) erros.set(documento, falhas.join(" "));
  if (certos) recebidos.set(documento, certos === 1 ? "Arquivo recebido e guardado." : `${certos} arquivos recebidos e guardados.`);
  desenhar();
}

async function tirar(documento, id, botao) {
  botao.disabled = true;
  erros.delete(documento);
  recebidos.delete(documento);
  try {
    estado = await pedir(`/arquivos/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (e) {
    erros.set(documento, e.message);
  }
  desenhar();
}

// Concluir abre uma janela que confirma o nome e pede o e-mail; o telefone é o do acesso.
// Se ainda faltar algum documento, a mesma janela avisa quais.
function abrirConclusao(faltam) {
  const { nome, fone, email } = estado.contato;
  const janela = document.createElement("dialog");
  janela.className = "modal";
  janela.setAttribute("aria-labelledby", "modal-titulo");
  janela.innerHTML = `<form class="pilha" novalidate>
    <h2 id="modal-titulo">Concluir envio</h2>
    ${faltam.length
    ? `<div class="aviso falta"><b>Ainda ${faltam.length === 1 ? "falta 1 documento" : `faltam ${faltam.length} documentos`}:</b> ${esc(faltam.map((d) => d.nome).join(", "))}. Você pode concluir agora e combinar o restante com o corretor.</div>`
    : `<p class="sub">Confira os seus dados: o corretor vai usá-los para falar com você sobre a contratação.</p>`}
    <label>Nome completo<input name="nome" autocomplete="name" maxlength="200" required value="${esc(nome)}"></label>
    <label>Telefone<input type="tel" value="${esc(fmtFone(fone || ""))}" readonly aria-describedby="fone-nota"><small id="fone-nota" class="sub">É o número com que você entrou.</small></label>
    <label>E-mail<input type="email" name="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="200" required placeholder="nome@exemplo.com" value="${esc(email)}"></label>
    <div class="aviso" role="alert" data-erro hidden></div>
    <button class="botao" type="submit">Concluir envio</button>
    <button class="botao claro" type="button" data-voltar>${faltam.length ? "Continuar enviando" : "Voltar"}</button>
  </form>`;
  document.body.append(janela);
  janela.addEventListener("close", () => janela.remove());
  const form = janela.querySelector("form"), aviso = janela.querySelector("[data-erro]"), enviar = janela.querySelector("[type=submit]");
  const erro = (texto, campo) => {
    aviso.textContent = texto;
    aviso.hidden = false;
    if (campo) form.elements[campo].focus();
  };
  janela.querySelector("[data-voltar]").onclick = () => janela.close();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const dados = { nome: form.elements.nome.value.replace(/\s+/g, " ").trim(), email: form.elements.email.value.trim() };
    if (dados.nome.length < 2) return erro("Informe o seu nome completo.", "nome");
    if (!EMAIL.test(dados.email)) return erro("Informe um e-mail válido, como nome@exemplo.com.", "email");
    enviar.disabled = true;
    enviar.textContent = "Concluindo…";
    try {
      estado = await pedir("/concluir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados) });
      editando = false;
      janela.close();
      desenhar();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (falha) {
      enviar.disabled = false;
      enviar.textContent = "Concluir envio";
      erro(falha.message, falha.campo);
    }
  };
  janela.showModal();
  (nome ? form.elements.email : form.elements.nome).focus();
}

/* ---------- tela ---------- */
const svg = (corpo, t = 22) => `<svg width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;
const ICONES = {
  casa: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v11h14V9"/><path d="M10 20v-6h4v6"/>',
  identidade: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 16a3 3 0 0 1 6 0"/><path d="M14 10h4M14 13.5h4"/>',
  pessoas: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 14.2A5 5 0 0 1 21 19"/>',
  bebe: '<circle cx="12" cy="13" r="7.5"/><path d="M12 5.5c0-1.5 1-2.5 2.2-2.5"/><circle cx="9.3" cy="12.3" r=".6" fill="currentColor"/><circle cx="14.7" cy="12.3" r=".6" fill="currentColor"/><path d="M9.8 15.6a3 3 0 0 0 4.4 0"/>',
  certidao: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><circle cx="12" cy="13.5" r="2.5"/><path d="m10.6 15.6-.8 3.4 2.2-1.1 2.2 1.1-.8-3.4"/>',
  telefone: '<path d="M21 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 1.1 4.2 2 2 0 0 1 3.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L7.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  empresa: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 12.5h18"/>',
  cartao: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/><path d="M6 15h4"/>',
  documento: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 16.5h4"/>',
  clipe: '<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
};
const ICONE_OK = svg('<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="m7.5 12.3 3 3 6-6.2" stroke="#fff" stroke-width="2.4"/>', 16);
const ICONE_RELOGIO = svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 16);
const ICONE_ALERTA = svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/>', 16);
const ICONE_SETA = svg('<path d="m6 9 6 6 6-6"/>', 20);
const ICONE_ARQUIVO = svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>', 18);
const SETA_ENVIO = '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M20 16.5V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2.5"/>';
const ICONE_ENVIAR = svg(SETA_ENVIO, 20), ICONE_SUBINDO = svg(SETA_ENVIO, 16);
const ICONE_NUVEM = svg('<path d="M12 13v8"/><path d="m8.5 16.5 3.5-3.5 3.5 3.5"/><path d="M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3"/>', 24);
const ICONE_WHATS = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>';
const ICONE_INFO = svg('<circle cx="12" cy="12" r="9.5"/><path d="M12 11v5.5M12 7.6h.01" stroke-width="2.2"/>', 20);
const ILUSTRACAO = `<svg class="ilustracao" width="92" height="76" viewBox="0 0 92 76" aria-hidden="true"><ellipse cx="50" cy="46" rx="40" ry="26" fill="#EAF7EE"/><rect x="22" y="10" width="44" height="56" rx="8" fill="#fff" stroke="#00B5A6" stroke-width="2.5" transform="rotate(-8 44 38)"/><g stroke="#0B7F73" stroke-width="2.6" stroke-linecap="round" fill="none" transform="rotate(-8 44 38)"><path d="m30 26 3 3 5-5M42 27h14M30 39l3 3 5-5M42 40h14M30 52l3 3 5-5M42 53h10"/></g><circle cx="68" cy="56" r="11" fill="#2E9B3A"/><path d="m63 56 3.5 3.5 6.5-7" stroke="#fff" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M74 10l3-7M80 18l7-4M82 28h7" stroke="#7CCB00" stroke-width="2.5" stroke-linecap="round"/></svg>`;

const OUTROS = "Outros documentos";
// O ícone vem do nome do documento cadastrado no plano; nomes que não se encaixam usam o de documento.
const semAcento = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
function iconeDo(nome) {
  const n = semAcento(nome);
  if (nome === OUTROS) return ICONES.clipe;
  if (/dependente|conjuge|filho/.test(n)) return ICONES.pessoas;
  if (/endereco|residencia|conta de (luz|agua)/.test(n)) return ICONES.casa;
  if (/nascimento/.test(n)) return ICONES.bebe;
  if (/certidao|casamento|uniao estavel/.test(n)) return ICONES.certidao;
  if (/contato|telefone|e-?mail|celular/.test(n)) return ICONES.telefone;
  if (/cnpj|contrato social|empresa|\bmei\b|ccmei/.test(n)) return ICONES.empresa;
  if (/carteirinha|cartao (do|de) plano|cartao sus|\bcns\b/.test(n)) return ICONES.cartao;
  if (/\brg\b|cpf|cnh|identidade|responsavel|titular|documento com foto/.test(n)) return ICONES.identidade;
  return ICONES.documento;
}

const somar = (arquivos) => arquivos.reduce((t, a) => t + a.tamanho, 0);
const idDoc = (nome) => "doc-" + [...nome].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);

function cartao(doc, opcional = false) {
  const andamento = enviando.get(doc.nome), erro = erros.get(doc.nome), ok = recebidos.get(doc.nome), tem = doc.arquivos.length > 0;
  const aberto = abertos.has(doc.nome) || !!andamento || !!erro, id = idDoc(doc.nome);
  const tipo = erro ? "com-erro" : tem ? "enviado" : opcional ? "" : "falta";
  const selo = andamento ? `<span class="selo subindo">${ICONE_SUBINDO}<span>Enviando</span></span>`
    : erro && !tem ? `<span class="selo erro">${ICONE_ALERTA}<span>Não enviado</span></span>`
    : tem ? `<span class="selo ok">${ICONE_OK}<span>Enviado</span></span>`
    : opcional ? `<span class="selo neutro"><span>Opcional</span></span>`
    : `<span class="selo">${ICONE_RELOGIO}<span>Falta enviar</span></span>`;
  const desc = tem
    ? `${doc.arquivos.length === 1 ? "1 arquivo" : `${doc.arquivos.length} arquivos`} · ${tamanho(somar(doc.arquivos))}`
    : opcional ? "Envie outros arquivos, se o corretor pedir." : "Envie uma foto ou PDF (até 20 MB).";
  return `<li class="doc ${tipo}" data-doc="${esc(doc.nome)}">
    <button type="button" class="doc-cabeca" aria-expanded="${aberto}" aria-controls="${id}">
      <span class="doc-icone">${svg(iconeDo(doc.nome), 24)}</span>
      <span class="doc-textos"><span class="doc-nome">${esc(doc.nome)}</span><span class="doc-desc">${desc}</span></span>
      ${selo}
      <span class="seta">${ICONE_SETA}</span>
    </button>
    <div class="doc-corpo" id="${id}"${aberto ? "" : " hidden"}>
      ${opcional && !tem ? `<p class="dica">Use este espaço se o corretor pediu algum documento que não está na lista.</p>` : ""}
      ${tem ? `<ul class="arquivos">${doc.arquivos.map((a) => `<li>${ICONE_ARQUIVO}<span class="nome" title="${esc(a.nome)}">${esc(a.nome)}</span><span class="tam">${tamanho(a.tamanho)}</span><button type="button" class="tirar" data-tirar="${esc(a.id)}" aria-label="Remover ${esc(a.nome)}">Remover</button></li>`).join("")}</ul>` : ""}
      ${ok && !andamento ? `<div class="aviso ok" role="status">✓ ${esc(ok)}</div>` : ""}
      ${erro ? `<div class="aviso" role="alert">${esc(erro)}</div>` : ""}
      ${andamento
    ? `<div class="enviando" role="status" data-andamento="${esc(doc.nome)}"><span>${esc(andamento.rotulo)}</span><div class="barra"><i style="width:${Math.round(andamento.parte * 100)}%"></i></div></div>`
    : `<label class="botao ${tem ? "claro fino" : ""}">${ICONE_ENVIAR}${tem ? "Adicionar outra foto ou página" : "Enviar foto ou arquivo"}<input type="file" accept="image/*,application/pdf" multiple hidden data-escolher></label>
      ${tem ? "" : `<p class="dica">Foto ou PDF de até 20 MB. Tire a foto com o documento inteiro, nítido e sem reflexo. Se tiver frente e verso, envie as duas.</p>`}`}
    </div>
  </li>`;
}

// Anel de progresso: conta só os documentos da lista do plano; "Outros documentos" é opcional.
function progresso(enviados, total) {
  const pct = total ? Math.round((enviados / total) * 100) : 0, r = 37, volta = 2 * Math.PI * r;
  const faltam = total - enviados;
  return `<section class="cartao progresso" role="status" aria-label="Andamento do envio">
    <div class="anel"><svg viewBox="0 0 84 84" aria-hidden="true"><defs><linearGradient id="grad-progresso" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0A7F72"/><stop offset="1" stop-color="${pct === 100 ? "#2E9B3A" : "#7CCB00"}"/></linearGradient></defs><circle class="trilho" cx="42" cy="42" r="${r}"/><circle class="feito" cx="42" cy="42" r="${r}" stroke-dasharray="${volta.toFixed(2)}" stroke-dashoffset="${(volta * (1 - pct / 100)).toFixed(2)}"${pct ? "" : ' stroke-opacity="0"'}/></svg><b>${pct}%</b></div>
    <div class="progresso-texto">
      <strong>${enviados === 1 ? "1 documento enviado" : `${enviados} documentos enviados`}</strong>
      <span>${faltam ? `<span class="pendente">${faltam === 1 ? "1 pendente" : `${faltam} pendentes`}</span> de ${total} obrigatórios` : `<span class="completo">Todos os ${total} enviados</span>`}</span>
    </div>
    ${ILUSTRACAO}
  </section>`;
}

function atualizarEtapa(concluido) {
  const chip = document.querySelector("[data-etapa]");
  if (chip) chip.textContent = `Etapa ${concluido ? 4 : 3} de ${chip.dataset.total}`;
}

function desenhar() {
  const { documentos, outros, concluidoEm } = estado;
  const enviados = documentos.filter((d) => d.arquivos.length).length, total = documentos.length;
  const faltam = documentos.filter((d) => !d.arquivos.length), ocupado = enviando.size > 0;
  const algum = enviados > 0 || outros.arquivos.length > 0;
  const whatsapp = WHATSAPP ? `<a class="botao claro" href="${esc(WHATSAPP)}" target="_blank" rel="noopener">${ICONE_WHATS}Falar com o corretor no WhatsApp</a>` : "";
  const links = `<div class="linha-links"><a class="link" href="${esc(PROPOSTA)}">Ver proposta</a><span class="sep" aria-hidden="true"></span><form method="post" action="${esc(BASE)}/sair"><button class="link" type="submit">Sair deste aparelho</button></form></div>`;
  atualizarEtapa(!!concluidoEm);

  // Depois de concluir, a tela resume o que foi enviado; a lista volta se o cliente quiser alterar algo.
  if (concluidoEm && !editando) {
    app.innerHTML = `${total ? progresso(enviados, total) : ""}
    <section class="cartao pilha concluido">
      <span class="selo-grande">${svg('<path d="m5 12.5 4.5 4.5L19 7.5" stroke-width="2.6"/>', 32)}</span>
      <h2>Documentos enviados</h2>
      <p>Recebemos os seus documentos em ${new Date(concluidoEm).toLocaleDateString("pt-BR")} e o corretor já foi avisado. Agora é só aguardar o contato.</p>
      ${total ? `<p class="sub">${enviados} de ${total} documentos da lista enviados${faltam.length ? `. Ainda sem arquivo: ${esc(faltam.map((d) => d.nome).join(", "))}.` : "."}</p>` : ""}
      ${estado.contato.email ? `<p class="sub">Contato informado: ${esc(estado.contato.nome)} · ${esc(fmtFone(estado.contato.fone || ""))} · ${esc(estado.contato.email)}</p>` : ""}
      ${whatsapp}
      <button type="button" class="botao claro" data-editar>Enviar mais ou trocar um documento</button>
    </section>${links}`;
    app.querySelector("[data-editar]").onclick = () => { editando = true; desenhar(); };
    return;
  }

  // Na primeira vez, o primeiro documento que falta já vem aberto.
  if (primeiraVez) {
    primeiraVez = false;
    if (faltam[0]) abertos.add(faltam[0].nome);
  }

  // Só o botão de concluir fica preso ao pé da tela: o resto do rodapé segue a página e nada fica escondido.
  const rodape = `<div class="fixo"><button type="button" class="botao" data-concluir ${!algum || ocupado ? "disabled" : ""}>${ICONE_NUVEM}${concluidoEm ? "Salvar e avisar o corretor" : "Concluir envio"}</button></div>
      <section class="acoes" aria-label="Mais opções">
        ${whatsapp}
        <p class="sub">${ocupado ? "Aguarde o envio terminar." : !algum ? "Envie pelo menos um documento para concluir." : faltam.length ? "Não precisa terminar agora: o que você já enviou está guardado." : "Tudo certo! Toque em concluir para avisar o corretor."}</p>
      </section>`;

  app.innerHTML = `${total ? progresso(enviados, total) : `<div class="aviso ok">Este plano ainda não tem uma lista de documentos cadastrada. Envie abaixo os documentos que o corretor pediu.</div>`}
    <div class="info">${ICONE_INFO}<p>Pode parar e continuar depois. Basta abrir este mesmo link e informar o seu telefone: tudo o que você enviou continua aqui.</p></div>
    <ul class="docs" aria-label="Documentos">
      ${documentos.map((d) => cartao(d)).join("")}
      ${cartao(outros, true)}
    </ul>
    ${rodape}
    ${links}`;

  for (const item of app.querySelectorAll("[data-doc]")) {
    const nome = item.dataset.doc;
    const cabeca = item.querySelector(".doc-cabeca"), corpo = item.querySelector(".doc-corpo");
    // Abrir e fechar mexe só neste cartão: o foco continua no botão.
    cabeca.onclick = () => {
      const abrir = cabeca.getAttribute("aria-expanded") !== "true";
      cabeca.setAttribute("aria-expanded", String(abrir));
      corpo.hidden = !abrir;
      if (abrir) abertos.add(nome); else abertos.delete(nome);
    };
    const campo = item.querySelector("[data-escolher]");
    if (campo) campo.onchange = () => enviarArquivos(nome, [...campo.files]);
    item.querySelectorAll("[data-tirar]").forEach((b) => (b.onclick = () => tirar(nome, b.dataset.tirar, b)));
  }
  app.querySelector("[data-concluir]").onclick = () => abrirConclusao(faltam);
}

// Sair da página no meio de um envio perde só o arquivo que está subindo: o navegador avisa antes.
window.addEventListener("beforeunload", (e) => { if (enviando.size) e.preventDefault(); });

try {
  estado = await pedir("/estado");
  desenhar();
} catch (e) {
  app.innerHTML = `<div class="aviso" role="alert">${esc(e.message)}</div>`;
}
