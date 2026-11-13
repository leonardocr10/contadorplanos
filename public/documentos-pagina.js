// Página pública do envio de documentos: lista o que o plano pede, envia um arquivo por vez e mostra
// o andamento. Cada arquivo fica guardado assim que chega: o cliente pode parar e continuar depois.
const app = document.getElementById("app");
const BASE = app.dataset.base, WHATSAPP = app.dataset.whatsapp, PROPOSTA = app.dataset.proposta;

let estado = null;
// Envios em andamento e avisos de erro, por documento: sobrevivem a cada redesenho da lista.
const enviando = new Map(), erros = new Map();
let editando = false;

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
  const falhas = [];
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
    } catch (e) {
      falhas.push(arquivos.length > 1 ? `${arquivos[i].name}: ${e.message}` : e.message);
    }
  }
  enviando.delete(documento);
  if (falhas.length) erros.set(documento, falhas.join(" "));
  desenhar();
}

async function tirar(documento, id, botao) {
  botao.disabled = true;
  erros.delete(documento);
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
function cartao(doc, opcional = false) {
  const andamento = enviando.get(doc.nome), erro = erros.get(doc.nome), tem = doc.arquivos.length > 0;
  const selo = tem ? `<span class="selo ok">✓ Enviado</span>` : opcional ? `<span class="selo neutro">Opcional</span>` : `<span class="selo">Falta enviar</span>`;
  return `<section class="cartao doc${tem ? " feito" : ""}" data-doc="${esc(doc.nome)}">
    <div class="doc-topo"><span class="doc-nome">${esc(doc.nome)}</span>${selo}</div>
    ${opcional && !tem ? `<p class="sub">Use este espaço se o corretor pediu algum documento que não está na lista.</p>` : ""}
    ${tem ? `<ul class="arquivos">${doc.arquivos.map((a) => `<li><span class="nome" title="${esc(a.nome)}">${esc(a.nome)}</span><span class="tam">${tamanho(a.tamanho)}</span><button type="button" class="tirar" data-tirar="${esc(a.id)}" aria-label="Remover ${esc(a.nome)}">Remover</button></li>`).join("")}</ul>` : ""}
    ${erro ? `<div class="aviso" role="alert">${esc(erro)}</div>` : ""}
    ${andamento
    ? `<div class="enviando" role="status" data-andamento="${esc(doc.nome)}"><span>${esc(andamento.rotulo)}</span><div class="barra"><i style="width:${Math.round(andamento.parte * 100)}%"></i></div></div>`
    : `<label class="botao ${tem ? "claro fino" : ""}">${tem ? "Adicionar outra foto ou página" : "Enviar foto ou arquivo"}<input type="file" accept="image/*,application/pdf" multiple hidden data-escolher></label>`}
  </section>`;
}

function desenhar() {
  const { documentos, outros, concluidoEm } = estado;
  const enviados = documentos.filter((d) => d.arquivos.length).length, total = documentos.length;
  const faltam = documentos.filter((d) => !d.arquivos.length), ocupado = enviando.size > 0;
  const algum = enviados > 0 || outros.arquivos.length > 0;
  const whatsapp = WHATSAPP ? `<a class="botao claro" href="${esc(WHATSAPP)}" target="_blank" rel="noopener">Falar com o corretor no WhatsApp</a>` : "";
  const links = `<div class="linha-links"><a class="link" href="${esc(PROPOSTA)}">Ver a proposta</a><form method="post" action="${esc(BASE)}/sair"><button class="link" type="submit">Sair deste aparelho</button></form></div>`;

  // Depois de concluir, a tela resume o que foi enviado; a lista volta se o cliente quiser alterar algo.
  if (concluidoEm && !editando) {
    app.innerHTML = `<section class="cartao pilha">
      <h2>✓ Documentos enviados</h2>
      <p>Recebemos os seus documentos em ${new Date(concluidoEm).toLocaleDateString("pt-BR")} e o corretor já foi avisado. Agora é só aguardar o contato.</p>
      ${total ? `<p class="sub">${enviados} de ${total} documentos da lista enviados${faltam.length ? `. Ainda sem arquivo: ${esc(faltam.map((d) => d.nome).join(", "))}.` : "."}</p>` : ""}
      ${estado.contato.email ? `<p class="sub">Contato informado: ${esc(estado.contato.nome)} · ${esc(fmtFone(estado.contato.fone || ""))} · ${esc(estado.contato.email)}</p>` : ""}
      ${whatsapp}
      <button type="button" class="botao claro" data-editar>Enviar mais ou trocar um documento</button>
    </section>${links}`;
    app.querySelector("[data-editar]").onclick = () => { editando = true; desenhar(); };
    return;
  }

  const rodape = `<section class="rodape">
        <button type="button" class="botao" data-concluir ${!algum || ocupado ? "disabled" : ""}>${concluidoEm ? "Salvar e avisar o corretor" : "Concluir envio"}</button>
        <p class="sub centro">${!algum ? "Envie pelo menos um documento para concluir." : faltam.length ? "Não precisa terminar agora: o que você já enviou está guardado." : "Tudo certo! Toque em concluir para avisar o corretor."}</p>
        ${whatsapp}
      </section>`;

  app.innerHTML = `<div class="progresso" role="status">
      <div class="progresso-topo"><span>${total ? `${enviados} de ${total} documentos enviados` : "Envie os documentos combinados"}</span><small>${total && enviados === total ? "Completo" : "Salvo automaticamente"}</small></div>
      ${total ? `<div class="barra"><i style="width:${Math.round((enviados / total) * 100)}%"></i></div>` : ""}
    </div>
    <section class="cartao pilha" style="gap:6px">
      <p><b>Pode parar e continuar depois.</b> Abra este mesmo link e informe o seu telefone: tudo o que você enviou continua aqui.</p>
      <p class="sub">Tire fotos nítidas, com o documento inteiro e sem reflexo. Aceitamos foto ou PDF de até 20 MB. Documento com frente e verso: envie as duas fotos.</p>
    </section>
    ${total ? "" : `<div class="aviso ok">Este plano ainda não tem uma lista de documentos cadastrada. Envie abaixo os documentos que o corretor pediu.</div>`}
    ${documentos.map((d) => cartao(d)).join("")}
    ${cartao(outros, true)}
    ${rodape}
    ${links}`;

  for (const secao of app.querySelectorAll("[data-doc]")) {
    const nome = secao.dataset.doc;
    const campo = secao.querySelector("[data-escolher]");
    if (campo) campo.onchange = () => enviarArquivos(nome, [...campo.files]);
    secao.querySelectorAll("[data-tirar]").forEach((b) => (b.onclick = () => tirar(nome, b.dataset.tirar, b)));
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
