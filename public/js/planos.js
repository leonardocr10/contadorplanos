// Tela "Planos e valores" e o editor do plano em janela modal.
import { FAIXAS, brl, colarPlanilha, parseBRL } from "./calculo.js";
import { $, S, api, carregarPlanos, esc, render, toast } from "./estado.js";
import { wireUpdater } from "./atualizar.js";

const IMAGES = {
  "img/plam-carencia-2026.jpg": "PLAM – carências (mar/2026)", "img/plam-copart-2026.jpg": "PLAM – coparticipação (mar/2026)",
  "img/plam-carencia.png": "PLAM – carências (antiga)", "img/plam-copart.png": "PLAM – coparticipação (antiga)",
  "img/plamedh-carencia-2026.jpg": "PLAMEDH – carências (Union)", "img/plamedh-copart-2026.jpg": "PLAMEDH – coparticipação (Union)",
  "img/plamedh-carencia.jpg": "PLAMEDH – carências", "img/plamedh-copart.png": "PLAMEDH – coparticipação",
  "img/amil-carencia-2026.jpg": "Amil – redução de carências (out/2026)", "img/amil-copart-total-2026.jpg": "Amil – coparticipação total (out/2026)", "img/amil-copart-parcial-2026.jpg": "Amil – coparticipação parcial (out/2026)",
  "img/amil-copart-total-prata.jpg": "Amil Prata MG I – copart. total", "img/amil-copart-total-ouro.jpg": "Amil Ouro – copart. total", "img/amil-copart-total-platinum.jpg": "Amil Platinum – copart. total",
  "img/amil-copart-parcial-prata.jpg": "Amil Prata MG I – copart. parcial", "img/amil-copart-parcial-ouro.jpg": "Amil Ouro – copart. parcial", "img/amil-copart-parcial-platinum.jpg": "Amil Platinum – copart. parcial",
  "img/amil-carencia.png": "Amil – carências", "img/amil-copart.png": "Amil – coparticipação",
  "img/unimed-copart-2025.jpg": "Unimed On – coparticipação (nov/2025)",
  "img/unimed-carencia.png": "Unimed – carências", "img/unimed-copart-pf.png": "Unimed – coparticipação PF",
  "img/unimed-copart-cnpj.png": "Unimed – coparticipação CNPJ",
};

export function renderCat() {
  const box = $("#cat");
  if (!S.loaded) { box.innerHTML = `<div class="status">${S.dbErr ? esc(S.dbErr) : "Carregando planos…"}</div>`; return; }
  if (!S.plans.length) { box.innerHTML = `<div class="status">Nenhum plano cadastrado ainda. Clique em <b>Novo plano</b> para adicionar o primeiro.</div>`; return; }
  box.innerHTML = ["PF", "CNPJ"].map((cat) => {
    const l = S.plans.filter((p) => p.categoria === cat);
    if (!l.length) return "";
    return `<div class="label" style="margin-top:6px">${cat === "PF" ? "Pessoa física" : "CNPJ"}</div>` + l.map((p) => `<div class="catrow"><div class="t"><b>${p.ativo === false ? '<span class="pill off">OCULTO</span>' : ""}${esc(p.nome)}</b></div><button class="btn" data-ed="${esc(p.id)}">Editar</button></div>`).join("");
  }).join("");
  box.querySelectorAll("[data-ed]").forEach((b) => (b.onclick = () => openEditor(S.plans.find((p) => p.id === b.dataset.ed))));
}

let lastFocus = null;
function openModal() {
  lastFocus = document.activeElement;
  $("#modal").hidden = false;
  document.documentElement.style.overflow = "hidden";
}
function closeModal() {
  $("#modal").hidden = true;
  $("#editor").innerHTML = "";
  document.documentElement.style.overflow = "";
  try { lastFocus?.focus(); } catch { /* o botão pode ter saído da tela */ }
}

function openEditor(p) {
  const ed = $("#editor"), isNew = !p;
  p = p || { fidelidade: S.tipo === "CNPJ", categoria: S.tipo, subtitulo: "Plano com coparticipação", cidade: "Uberlândia", ativo: true, ordem: (S.plans.length + 1) * 10 };
  const opt = (cur) => `<option value="">Sem imagem</option>` + (cur && !IMAGES[cur] ? `<option value="${esc(cur)}" selected>Imagem enviada</option>` : "") + Object.entries(IMAGES).map(([k, v]) => `<option value="${k}" ${cur === k ? "selected" : ""}>${v}</option>`).join("");
  openModal();
  ed.innerHTML = `<div class="modal-head"><h2 id="ed-title">${isNew ? "Novo plano" : "Editar " + esc(p.nome)}</h2><button class="iconbtn" id="e-x" aria-label="Fechar">×</button></div>
  <div class="upd">
    <div class="label">Atualizar com nova tabela</div>
    <p class="note" style="margin:0">Envie o PDF ou as imagens do material da operadora. O Claude lê valores por faixa, taxa, rede, benefícios, carências e coparticipação, e você revisa tudo antes de salvar.</p>
    <div class="actions"><label class="btn primary" for="u-file" tabindex="0">Escolher PDF ou imagem</label><input id="u-file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" hidden><span class="note" id="u-fname"></span></div>
    <div id="u-pages" class="upages"></div>
    <div id="u-work" class="stack" style="gap:12px"></div>
    <div id="u-msg" class="note" role="status"></div>
  </div>
  <div class="row">
    <div class="field"><label for="e-nome">Nome</label><input id="e-nome" type="text" value="${esc(p.nome || "")}"></div>
    <div class="field"><label for="e-cat">Tipo</label><select id="e-cat"><option value="PF" ${p.categoria === "PF" ? "selected" : ""}>Pessoa física</option><option value="CNPJ" ${p.categoria === "CNPJ" ? "selected" : ""}>CNPJ</option></select></div>
    <div class="field"><label for="e-sub">Subtítulo</label><input id="e-sub" type="text" value="${esc(p.subtitulo || "")}"></div>
  </div>
  <div class="label">Tabela por faixa etária (valor por pessoa)</div>
  <label ${p.id === "plamedh-basic-pme" ? "" : "style=\"display:none\""}><input type="checkbox" id="e-fx3" ${p.faixasModelo === "3" ? "checked" : ""}> Tabela de 3 faixas (0 a 18, 19 a 58 e 59 ou mais)</label>
  <div class="field"><label for="e-paste">Colar da planilha: copie as 10 linhas do Excel (faixa, enfermaria, apartamento) e cole aqui</label>
    <textarea id="e-paste" style="min-height:56px" placeholder="De 0 a 18 anos	R$ 171,20	R$ 190,04"></textarea></div>
  <div style="overflow-x:auto"><table class="ftab"><thead><tr><th>Faixa</th><th>Enfermaria R$</th><th>Apartamento R$</th></tr></thead><tbody>
    ${FAIXAS.map((f, i) => `<tr id="e-fr-${i}"><td id="e-fl-${i}">${f} anos</td><td><input class="money" type="text" inputmode="decimal" id="e-fe-${i}" value="${brl(p.faixasEnf?.[i])}"></td><td><input class="money" type="text" inputmode="decimal" id="e-fa-${i}" value="${brl(p.faixasApto?.[i])}"></td></tr>`).join("")}
  </tbody></table></div>
  <div class="row">
    <div class="field"><label for="e-taxa">Taxa associativa R$</label><input class="money" id="e-taxa" type="text" inputmode="decimal" value="${brl(p.taxa)}"></div>
  </div>
  <div class="checks">

    <label><input type="checkbox" id="e-fid" ${p.fidelidade ? "checked" : ""}> Prazo de fidelidade de 12 meses para contratação via CNPJ</label>
    <label><input type="checkbox" id="e-ativo" ${p.ativo !== false ? "checked" : ""}> Mostrar na cotação</label>
    <label><input type="checkbox" id="e-showex" ${p.mostrarExtras ? "checked" : ""}> Mostrar benefícios na proposta</label>
    <label><input type="checkbox" id="e-showobs" ${p.mostrarObservacao ? "checked" : ""}> Mostrar observação na proposta</label>
  </div>
  <div class="row">
    <div class="field"><label for="e-cidade">Cidade da rede</label><input id="e-cidade" type="text" value="${esc(p.cidade || "")}"></div>
    <div class="field"><label for="e-cor1">Cor principal da operadora</label><input id="e-cor1" type="color" value="${esc(p.corPrimaria || "#0f9d4f")}"></div>
    <div class="field"><label for="e-cor2">Cor escura (cabeçalho e rodapé)</label><input id="e-cor2" type="color" value="${esc(p.corEscura || "#0b5a45")}"></div>
    <div class="field"><label for="e-ordem">Ordem na lista</label><input id="e-ordem" type="text" inputmode="numeric" value="${esc(p.ordem ?? "")}"></div>
  </div>
  <div class="field"><label for="e-rede">Rede hospitalar (um hospital por linha)</label><textarea id="e-rede">${esc(p.rede || "")}</textarea></div>
  <div class="field"><label for="e-desc">Observação do plano (opcional; aparece na imagem e no link se marcar "Mostrar observação")</label><textarea id="e-desc">${esc(p.descricao || "")}</textarea></div>
  <div class="field"><label for="e-extras">Benefícios do plano (um por linha; aparecem na proposta se marcar "Mostrar benefícios")</label><textarea id="e-extras">${esc(p.extras || "")}</textarea></div>
  <div class="field"><label for="e-copart">Como funciona a coparticipação</label><textarea id="e-copart">${esc(p.copartTexto || "")}</textarea></div>
  <div class="field"><label for="e-tcop">Tabela de coparticipação da proposta (1ª linha com os títulos; colunas separadas por | ). Quando preenchida, substitui a imagem.</label><textarea id="e-tcop" class="mono">${esc(p.copartTabela || "")}</textarea></div>
  <div class="field"><label for="e-ncop">Observação abaixo da coparticipação (opcional)</label><input id="e-ncop" type="text" value="${esc(p.copartNota || "")}"></div>
  <div class="field"><label for="e-tcar">Tabela de carências da proposta (1ª linha com os títulos; colunas separadas por | ). Quando preenchida, substitui a imagem.</label><textarea id="e-tcar" class="mono">${esc(p.carenciaTabela || "")}</textarea></div>
  <div class="field"><label for="e-ncar">Observação abaixo das carências (opcional)</label><input id="e-ncar" type="text" value="${esc(p.carenciaNota || "")}"></div>
  <div class="row">
    <div class="field"><label for="e-imgcop">Imagem da coparticipação</label><select id="e-imgcop">${opt(p.imgCopart)}</select></div>
    <div class="field"><label for="e-imgcar">Imagem das carências</label><select id="e-imgcar">${opt(p.imgCarencia)}</select></div>
  </div>
  <div class="actions modal-acoes"><button class="btn primary" id="e-save">Salvar plano</button><button class="btn" id="e-cancel">Cancelar</button>${isNew ? "" : `<button class="btn danger" id="e-del">Excluir plano</button>`}</div>
  <div id="e-confirm" hidden class="status">Excluir <b>${esc(p.nome)}</b> de vez? <div class="actions" style="margin-top:8px"><button class="btn danger" id="e-del2">Sim, excluir</button><button class="btn" id="e-del-no">Manter</button></div></div>
  <div id="e-msg" class="note"></div>`;
  $("#modal").scrollTop = 0;
  setTimeout(() => $("#e-nome").focus(), 0);
  // Com 3 faixas, a linha de 19 a 23 vale para todas as idades até 58 anos.
  const aplicarModeloFaixas = () => {
    const tres = $("#e-fx3").checked;
    for (let i = 2; i <= 8; i++) $("#e-fr-" + i).hidden = tres;
    $("#e-fl-1").textContent = tres ? "19 a 58 anos" : FAIXAS[1] + " anos";
  };
  $("#e-fx3").onchange = aplicarModeloFaixas;
  aplicarModeloFaixas();
  if (isNew) $("#e-cat").onchange = () => { $("#e-fid").checked = $("#e-cat").value === "CNPJ"; };
  $("#e-cancel").onclick = closeModal;
  $("#e-x").onclick = closeModal;
  wireUpdater();
  $("#e-paste").addEventListener("input", () => {
    const rows = colarPlanilha($("#e-paste").value);
    rows.forEach((r, i) => { $("#e-fe-" + i).value = r.enf; $("#e-fa-" + i).value = r.apto; });
    $("#e-msg").textContent = rows.length ? `${rows.length} faixa${rows.length > 1 ? "s" : ""} preenchida${rows.length > 1 ? "s" : ""}. Confira e clique em Salvar plano.` : "";
  });
  if (!isNew) {
    $("#e-del").onclick = () => ($("#e-confirm").hidden = false);
    $("#e-del-no").onclick = () => ($("#e-confirm").hidden = true);
    $("#e-del2").onclick = async () => {
      try {
        await api(`/api/planos/${encodeURIComponent(p.id)}`, { metodo: "DELETE" });
        await carregarPlanos();
        closeModal();
        render();
        toast("Plano excluído");
      } catch (e) {
        $("#e-msg").textContent = "Não deu para excluir: " + e.message;
      }
    };
  }
  $("#e-save").onclick = async () => {
    const nome = $("#e-nome").value.trim();
    if (!nome) { $("#e-msg").textContent = "Dê um nome ao plano."; return; }
    const data = {
      nome, categoria: $("#e-cat").value, subtitulo: $("#e-sub").value.trim(),
      enfermaria: p.enfermaria ?? null, apartamento: p.apartamento ?? null, taxa: parseBRL($("#e-taxa").value),
      odonto: !!p.odonto, fidelidade: $("#e-fid").checked, ativo: $("#e-ativo").checked, mostrarExtras: $("#e-showex").checked, mostrarObservacao: $("#e-showobs").checked,
      corPrimaria: $("#e-cor1").value, corEscura: $("#e-cor2").value, cidade: $("#e-cidade").value.trim(), ordem: parseBRL($("#e-ordem").value) ?? 0,
      rede: $("#e-rede").value.trim(), descricao: $("#e-desc").value.trim(), extras: $("#e-extras").value.trim(), copartTexto: $("#e-copart").value.trim(),
      copartTabela: $("#e-tcop").value.trim(), copartNota: $("#e-ncop").value.trim(), carenciaTabela: $("#e-tcar").value.trim(), carenciaNota: $("#e-ncar").value.trim(),
      imgCopart: $("#e-imgcop").value, imgCarencia: $("#e-imgcar").value,
      faixasModelo: $("#e-fx3").checked ? "3" : "",
      faixasEnf: FAIXAS.map((_, i) => parseBRL($("#e-fe-" + ($("#e-fx3").checked && i >= 1 && i <= 8 ? 1 : i)).value)), faixasApto: FAIXAS.map((_, i) => parseBRL($("#e-fa-" + ($("#e-fx3").checked && i >= 1 && i <= 8 ? 1 : i)).value)),
    };
    const btn = $("#e-save");
    btn.disabled = true;
    try {
      const salvo = await api(isNew ? "/api/planos" : `/api/planos/${encodeURIComponent(p.id)}`, { metodo: isNew ? "POST" : "PUT", json: data });
      delete S.over[salvo.id];
      await carregarPlanos();
      closeModal();
      render();
      toast("Plano salvo");
    } catch (e) {
      $("#e-msg").textContent = "Não deu para salvar: " + e.message;
      btn.disabled = false;
    }
  };
}

export function iniciarPlanos() {
  $("#novo").onclick = () => openEditor(null);
  $("#modal").addEventListener("mousedown", (e) => { if (e.target.id === "modal") closeModal(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#modal").hidden) closeModal(); });
}
