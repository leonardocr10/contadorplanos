// "Atualizar com nova tabela": abre PDF ou imagem, envia as páginas ao Claude e mostra a revisão.
import { FAIXAS, brl } from "./calculo.js";
import { $, S, api, esc } from "./estado.js";

const PDFJS = "/vendor/pdfjs/";
const MAX_PAGINAS = 30, MAX_IMGS = 20;

let pdfjsP = null;
function loadPdfJs() {
  return (pdfjsP ||= import(PDFJS + "pdf.min.mjs")
    .then((lib) => { lib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.mjs"; return lib; })
    .catch((e) => { pdfjsP = null; throw e; }));
}

const canvasParaBlob = (cv, q) => new Promise((r) => cv.toBlob(r, "image/jpeg", q));

// As imagens viram JPEG com fundo branco, como as páginas do PDF.
async function imagemParaPagina(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 3000 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * k);
  cv.height = Math.round(bmp.height * k);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close();
  const blob = await canvasParaBlob(cv, 0.92);
  return { blob, url: URL.createObjectURL(blob) };
}

async function fileToPages(file, onProgress) {
  if (file.type.startsWith("image/")) return [await imagemParaPagina(file)];
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({
    data: await file.arrayBuffer(), isEvalSupported: false,
    cMapUrl: PDFJS + "cmaps/", cMapPacked: true, standardFontDataUrl: PDFJS + "standard_fonts/", wasmUrl: PDFJS + "wasm/",
  }).promise;
  const out = [], n = Math.min(doc.numPages, MAX_PAGINAS);
  for (let i = 1; i <= n; i++) {
    onProgress?.(i, n);
    const pg = await doc.getPage(i);
    const vp = pg.getViewport({ scale: 2 });
    const cv = document.createElement("canvas");
    cv.width = Math.round(vp.width);
    cv.height = Math.round(vp.height);
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cv.width, cv.height);
    await pg.render({ canvas: cv, canvasContext: ctx, viewport: vp, background: "#fff" }).promise;
    const blob = await canvasParaBlob(cv, 0.9);
    out.push({ blob, url: URL.createObjectURL(blob) });
  }
  return out;
}

// Reduz a página para o envio, mantendo o original para os recortes.
async function paginaParaBase64(blob) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * k);
  cv.height = Math.round(bmp.height * k);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close();
  return cv.toDataURL("image/jpeg", 0.88).split(",")[1];
}

const U = { pages: [], sel: new Set(), res: null };
function uMsg(t) {
  const el = $("#u-msg");
  if (el) el.textContent = t || "";
}

export function wireUpdater() {
  U.pages.forEach((pg) => URL.revokeObjectURL(pg.url));
  U.pages = [];
  U.sel = new Set();
  U.res = null;
  renderWork();
  document.querySelector('label[for="u-file"]').onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#u-file").click(); }
  };
  $("#u-file").onchange = async () => {
    const f = $("#u-file").files[0];
    if (!f) return;
    $("#u-fname").textContent = f.name;
    U.pages.forEach((pg) => URL.revokeObjectURL(pg.url));
    U.pages = [];
    U.sel = new Set();
    U.res = null;
    renderPages();
    renderWork();
    try {
      U.pages = await fileToPages(f, (i, n) => uMsg(`Abrindo página ${i} de ${n}…`));
      U.pages.forEach((_, i) => { if (i < MAX_IMGS) U.sel.add(i); });
      uMsg(U.pages.length > 1 ? "Todas as páginas estão marcadas. Desmarque as que não interessam (capa, documentos) e clique em Ler a tabela completa." : "");
    } catch {
      uMsg("Não consegui abrir este arquivo. Tente um PDF ou uma imagem PNG/JPG.");
    }
    $("#u-file").value = "";
    renderPages();
    renderWork();
  };
}

function renderPages() {
  const box = $("#u-pages");
  if (!box) return;
  if (U.pages.length < 2 || U.res) { box.innerHTML = ""; return; }
  box.innerHTML = U.pages.map((pg, i) => `<button type="button" aria-pressed="${U.sel.has(i)}" data-pg="${i}" aria-label="Página ${i + 1}"><img src="${pg.url}" alt=""><span>${i + 1}</span></button>`).join("");
  box.querySelectorAll("[data-pg]").forEach((b) => (b.onclick = () => {
    const i = +b.dataset.pg;
    if (U.sel.has(i)) U.sel.delete(i);
    else {
      if (U.sel.size >= MAX_IMGS) { uMsg(`Marque no máximo ${MAX_IMGS} páginas.`); return; }
      U.sel.add(i);
    }
    renderPages();
    renderWork();
  }));
}

function renderWork() {
  const box = $("#u-work");
  if (!box) return;
  box.innerHTML = "";
  if (!S.leituraDisponivel) {
    box.innerHTML = `<div class="status">A leitura automática precisa de uma chave da API do Claude. Abra o arquivo <b>.env</b> na pasta do cotador, coloque a chave depois de <b>ANTHROPIC_API_KEY=</b> e reinicie o cotador. Até lá, use o campo <b>Colar da planilha</b> abaixo.</div>`;
    return;
  }
  if (!U.pages.length) return;
  if (!U.res) {
    box.innerHTML = `<div class="actions"><button class="btn primary" id="u-ler" ${U.sel.size ? "" : "disabled"}>Ler a tabela completa com o Claude</button><span class="note">${U.sel.size} página${U.sel.size === 1 ? "" : "s"} marcada${U.sel.size === 1 ? "" : "s"}</span></div>`;
    $("#u-ler").onclick = lerTudo;
    return;
  }
  renderReview(box);
}

function paraIndiceDePagina(t, pagesSent) {
  if (!t) return null;
  const pi = pagesSent[t.pagina - 1];
  if (pi == null) return null;
  return { page: pi, rects: t.retangulos?.length ? t.retangulos : null };
}

async function lerTudo() {
  const btn = $("#u-ler");
  btn.disabled = true;
  btn.textContent = "Lendo o material… (pode levar um minuto)";
  uMsg("");
  const pagesSent = [...U.sel].sort((a, b) => a - b);
  try {
    const imagens = await Promise.all(pagesSent.map((i) => paginaParaBase64(U.pages[i].blob)));
    const r = await api("/api/ler-tabela", { metodo: "POST", json: { nome: $("#e-nome")?.value || "", subtitulo: $("#e-sub")?.value || "", imagens } });
    U.res = {
      nome: r.nomePlano, sub: r.subtituloPlano,
      cols: r.colunas, ie: r.colunaEnfermaria, ia: r.colunaApartamento,
      taxa: r.taxaAssociativa, cidade: r.cidade, rede: r.rede, extras: r.extras, odonto: r.odontoIncluso, descricao: r.descricao,
      copart: r.coparticipacaoTexto, tcop: r.tabelaCoparticipacaoTexto, tcar: r.tabelaCarenciaTexto, cor1: r.corPrimaria, cor2: r.corEscura,
      tabCop: paraIndiceDePagina(r.tabelaCoparticipacao, pagesSent), tabCar: paraIndiceDePagina(r.tabelaCarencia, pagesSent),
    };
    renderPages();
    renderWork();
    uMsg("Leitura concluída. Revise abaixo e clique em Aplicar.");
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "Ler a tabela completa com o Claude";
    uMsg(e.message || "Não consegui ler o material. Desmarque páginas que não têm tabela e tente de novo.");
  }
}

const chk = (id, label, on = true) => `<label class="uchk"><input type="checkbox" id="${id}" ${on ? "checked" : ""}> ${label}</label>`;

function renderReview(box) {
  const R = U.res;
  const opts = (sel) => `<option value="-1">Não alterar</option>` + R.cols.map((c, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${esc(c.titulo || "Coluna " + (i + 1))}</option>`).join("");
  const pageOpts = (sel) => U.pages.map((_, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>Página ${i + 1}</option>`).join("");
  // Em plano novo o nome ainda está vazio; em plano existente, ele só muda se a pessoa marcar.
  const planoNovo = !$("#e-nome").value.trim();
  box.innerHTML = `
  <div class="urev">
    <div class="row">
      <div class="field">${chk("uc-nome", "Usar este nome", planoNovo && !!R.nome)}<input id="uv-nome" type="text" value="${esc(R.nome)}"></div>
      <div class="field">${chk("uc-sub", "Usar este subtítulo", planoNovo && !!R.sub)}<input id="uv-sub" type="text" value="${esc(R.sub)}"></div>
    </div>
    <h3>1. Valores por faixa etária</h3>
    ${R.cols.length ? `<div class="row"><div class="field"><label for="u-enf">Enfermaria recebe</label><select id="u-enf">${opts(R.ie)}</select></div><div class="field"><label for="u-apto">Apartamento recebe</label><select id="u-apto">${opts(R.ia)}</select></div></div>
    <div style="overflow-x:auto"><table class="ftab"><thead><tr><th>Faixa</th>${R.cols.map((c) => `<th>${esc(c.titulo || "")}</th>`).join("")}</tr></thead><tbody>${FAIXAS.map((f, i) => `<tr><td>${f}</td>${R.cols.map((c) => `<td class="money">${c.valores[i] != null ? brl(c.valores[i]) : "—"}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
    : `<div class="status">Não encontrei tabela de preços por faixa etária. Os valores atuais serão mantidos.</div>`}
  </div>
  <div class="urev">
    <h3>2. Informações do plano</h3>
    <div class="row">
      <div class="field">${chk("uc-taxa", "Atualizar taxa associativa", R.taxa != null)}<input id="uv-taxa" class="money" type="text" inputmode="decimal" value="${brl(R.taxa)}"></div>
      <div class="field">${chk("uc-cidade", "Atualizar cidade da rede", !!R.cidade)}<input id="uv-cidade" type="text" value="${esc(R.cidade)}"></div>
    </div>
    <div class="field">${chk("uc-rede", "Atualizar rede hospitalar", R.rede.length > 0)}<textarea id="uv-rede">${esc(R.rede.join("\n"))}</textarea>${R.rede.length ? "" : `<span class="note">O material não lista hospitais: a rede atual será mantida.</span>`}</div>
    <div class="field">${chk("uc-extras", "Atualizar benefícios e linhas extras", R.extras.length > 0)}<textarea id="uv-extras">${esc(R.extras.join("\n"))}</textarea></div>
    <div class="field">${chk("uc-desc", "Atualizar observação do plano", !!R.descricao)}<textarea id="uv-desc">${esc(R.descricao)}</textarea></div>
    <div class="field">${chk("uc-copart", "Atualizar explicação da coparticipação", !!R.copart)}<textarea id="uv-copart">${esc(R.copart)}</textarea></div>
    <div class="row"><div class="field">${chk("uc-cores", "Atualizar cores da operadora", !!(R.cor1 && R.cor2))}<div class="actions"><input id="uv-cor1" type="color" value="${esc(R.cor1 || "#0f9d4f")}" aria-label="Cor principal"><input id="uv-cor2" type="color" value="${esc(R.cor2 || "#0b5a45")}" aria-label="Cor escura"></div></div></div>
  </div>
  <div class="urev">
    <h3>3. Tabelas da proposta</h3>
    <div class="field">${chk("uc-tcop", "Atualizar tabela de coparticipação", !!R.tcop)}<textarea id="uv-tcop" class="mono">${esc(R.tcop)}</textarea></div>
    <div class="field">${chk("uc-tcar", "Atualizar tabela de carências", !!R.tcar)}<textarea id="uv-tcar" class="mono">${esc(R.tcar)}</textarea></div>
    <p class="note" style="margin:0">As tabelas acima aparecem na proposta no visual do cotador. As imagens abaixo ficam como reserva, usadas só quando a tabela estiver vazia.</p>
    <p class="note" style="margin:0">Confira o recorte. Para corrigir, arraste sobre a imagem marcando só a tabela.</p>
    <div class="ucrop" id="cr-cop">${chk("uc-imgcop", "Atualizar imagem de coparticipação", !!R.tabCop)}<select class="cr-page" aria-label="Página da coparticipação">${pageOpts(R.tabCop?.page ?? 0)}</select><div class="cropwrap"><canvas></canvas></div><button class="btn cr-clear" type="button">Usar página inteira</button></div>
    <div class="ucrop" id="cr-car">${chk("uc-imgcar", "Atualizar imagem de carências", !!R.tabCar)}<select class="cr-page" aria-label="Página das carências">${pageOpts(R.tabCar?.page ?? 0)}</select><div class="cropwrap"><canvas></canvas></div><button class="btn cr-clear" type="button">Usar página inteira</button></div>
  </div>
  <div class="actions"><button class="btn primary" id="u-aplicar-salvar">Aplicar tudo e salvar plano</button><button class="btn" id="u-aplicar">Só aplicar no formulário</button><button class="btn" id="u-reler">Ler de novo</button></div>`;
  const ce1 = cropEditor($("#cr-cop"), R.tabCop), ce2 = cropEditor($("#cr-car"), R.tabCar);
  $("#u-reler").onclick = () => { U.res = null; renderPages(); renderWork(); };
  const apply = async (save) => {
    const bs = [$("#u-aplicar"), $("#u-aplicar-salvar")];
    bs.forEach((b) => (b.disabled = true));
    try {
      if (R.cols.length) {
        const ie = +$("#u-enf").value, ia = +$("#u-apto").value;
        FAIXAS.forEach((_, i) => {
          if (ie >= 0) $("#e-fe-" + i).value = brl(R.cols[ie].valores[i]);
          if (ia >= 0) $("#e-fa-" + i).value = brl(R.cols[ia].valores[i]);
        });
      }
      const on = (id) => $("#" + id).checked;
      if (on("uc-nome")) $("#e-nome").value = $("#uv-nome").value;
      if (on("uc-sub")) $("#e-sub").value = $("#uv-sub").value;
      if (on("uc-taxa")) $("#e-taxa").value = $("#uv-taxa").value;
      if (on("uc-cidade")) $("#e-cidade").value = $("#uv-cidade").value;
      if (on("uc-rede")) $("#e-rede").value = $("#uv-rede").value;
      if (on("uc-extras")) $("#e-extras").value = $("#uv-extras").value;
      if (on("uc-desc")) $("#e-desc").value = $("#uv-desc").value;
      if (on("uc-copart")) $("#e-copart").value = $("#uv-copart").value;
      if (on("uc-tcop")) $("#e-tcop").value = $("#uv-tcop").value;
      if (on("uc-cores")) { $("#e-cor1").value = $("#uv-cor1").value; $("#e-cor2").value = $("#uv-cor2").value; }
      if (on("uc-tcar")) $("#e-tcar").value = $("#uv-tcar").value;
      for (const [cid, ce, sid] of [["uc-imgcop", ce1, "#e-imgcop"], ["uc-imgcar", ce2, "#e-imgcar"]]) {
        if (!on(cid)) continue;
        uMsg("Enviando imagens das tabelas…");
        const blob = await ce.blob();
        const { caminho } = await api("/api/uploads", { metodo: "POST", corpo: blob, tipo: "image/jpeg" });
        const sel = $(sid), o = document.createElement("option");
        o.value = caminho;
        o.textContent = "Nova imagem enviada";
        sel.appendChild(o);
        sel.value = caminho;
      }
      if (save) {
        uMsg("Salvando plano…");
        $("#e-save").click();
      } else {
        uMsg("Tudo aplicado no formulário. Confira e clique em Salvar plano.");
        bs.forEach((b) => (b.disabled = false));
      }
    } catch (e) {
      uMsg("Não deu para aplicar tudo: " + (e?.message || "erro ao enviar imagem") + ". Tente de novo.");
      bs.forEach((b) => (b.disabled = false));
    }
  };
  $("#u-aplicar").onclick = () => apply(false);
  $("#u-aplicar-salvar").onclick = () => apply(true);
}

function cropEditor(wrap, init) {
  const cv = wrap.querySelector("canvas"), ctx = cv.getContext("2d"), sel = wrap.querySelector(".cr-page");
  let img = new Image(), rects = null, start = null, ready = null;
  const load = (pi, fr) => {
    img = new Image();
    ready = new Promise((res) => {
      img.onload = () => {
        cv.width = img.naturalWidth;
        cv.height = img.naturalHeight;
        rects = fr ? fr.map((r) => ({ x: r.x * cv.width, y: r.y * cv.height, w: r.w * cv.width, h: r.h * cv.height })) : null;
        draw();
        res();
      };
    });
    img.src = U.pages[pi].url;
  };
  const draw = () => {
    ctx.drawImage(img, 0, 0);
    if (rects) {
      ctx.fillStyle = "rgba(0,0,0,.5)";
      ctx.fillRect(0, 0, cv.width, cv.height);
      for (const r of rects) {
        ctx.drawImage(img, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
        ctx.strokeStyle = "#27c06c";
        ctx.lineWidth = Math.max(3, cv.width / 250);
        ctx.strokeRect(r.x, r.y, r.w, r.h);
      }
    }
  };
  const pt = (e) => {
    const b = cv.getBoundingClientRect();
    return { x: ((e.clientX - b.left) * cv.width) / b.width, y: ((e.clientY - b.top) * cv.height) / b.height };
  };
  cv.onpointerdown = (e) => { start = pt(e); cv.setPointerCapture(e.pointerId); };
  cv.onpointermove = (e) => {
    if (!start) return;
    const q = pt(e);
    rects = [{ x: Math.min(start.x, q.x), y: Math.min(start.y, q.y), w: Math.abs(q.x - start.x), h: Math.abs(q.y - start.y) }];
    draw();
  };
  cv.onpointerup = () => {
    start = null;
    if (rects && rects.length === 1 && (rects[0].w < 20 || rects[0].h < 20)) { rects = null; draw(); }
  };
  wrap.querySelector(".cr-clear").onclick = () => { rects = null; draw(); };
  sel.onchange = () => load(+sel.value, null);
  load(init?.page ?? 0, init?.rects || null);
  return {
    async blob() {
      await ready;
      if (!rects) return U.pages[+sel.value].blob;
      const gap = 6, H = Math.round(Math.max(...rects.map((r) => r.h))), W = Math.round(rects.reduce((a, r) => a + r.w, 0) + gap * (rects.length - 1));
      const o = document.createElement("canvas");
      o.width = W;
      o.height = H;
      const c = o.getContext("2d");
      c.fillStyle = "#fff";
      c.fillRect(0, 0, W, H);
      let x = 0;
      for (const r of rects) { c.drawImage(img, r.x, r.y, r.w, r.h, x, 0, r.w, r.h); x += r.w + gap; }
      return await new Promise((res) => o.toBlob(res, "image/jpeg", 0.92));
    },
  };
}
