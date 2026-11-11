// Acrescenta um campo de filtro a todo <select> da página, inclusive os criados depois.
// O select original continua guardando o valor, então quem o usa não precisa mudar nada.
export const normalizar = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function filtrarOpcoes(opcoes, termo) {
  // Cada palavra pode aparecer em qualquer parte: "unimed car" encontra "Unimed – carências".
  const palavras = normalizar(termo).split(/\s+/).filter(Boolean);
  return opcoes.filter((o) => {
    const alvo = normalizar(`${o.texto} ${o.selo ?? ""} ${o.grupo ?? ""}`);
    return palavras.every((p) => alvo.includes(p));
  });
}

const CSS = `
.fs{position:relative;width:100%;min-width:0}
.fs-botao{display:flex;align-items:center;gap:8px;width:100%;min-height:40px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg,#fff);color:var(--ink);font-family:var(--body,inherit);font-size:15px;font-weight:500;line-height:1.2;text-align:left;cursor:pointer}
.fs-botao>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fs-botao svg{flex:none}
.fs-botao .fs-icone{color:var(--pine,var(--accent))}
.fs-botao .fs-seta{transition:transform .15s}
.fs-botao[aria-expanded="true"]{border-color:var(--pine,var(--accent));box-shadow:0 0 0 1px var(--pine,var(--accent))}
.fs-botao[aria-expanded="true"] .fs-seta{transform:rotate(180deg)}
/* O select original fica escondido; o !important vence classes da tela (ex.: hq-st com width:auto), que o fariam empurrar a linha. */
.fs-oculto{position:absolute;width:1px!important;min-width:0!important;height:1px!important;margin:0;padding:0!important;border:0!important;opacity:0;pointer-events:none;overflow:hidden}
.fs-painel{position:fixed;z-index:1000;display:flex;flex-direction:column;min-width:220px;background:var(--surface,#fff);color:var(--ink);border:1px solid var(--line);border-radius:14px;box-shadow:0 16px 40px rgba(0,0,0,.16);overflow:hidden;font-family:var(--body,inherit)}
.fs-busca{position:relative;flex:none;margin:10px;padding-bottom:0}
.fs-painel .fs-busca input{display:block;width:100%;margin:0;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg,#fff);color:var(--ink);font:500 15px var(--body,inherit)}
.fs-painel .fs-busca input:focus{outline:none;border-color:var(--pine,var(--accent));box-shadow:0 0 0 1px var(--pine,var(--accent))}
.fs-lista{flex:1;min-height:0;margin:0;padding:4px 6px 6px;overflow-y:auto;list-style:none;font-size:14px;border-top:1px solid var(--line)}
.fs-sem-busca .fs-lista{border-top:0}
.fs-grupo{padding:10px 10px 4px;font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.fs-opcao{display:flex;align-items:center;gap:10px;min-height:36px;padding:7px 10px;border-radius:8px;cursor:pointer}
.fs-opcao>.fs-texto{flex:1;min-width:0;overflow-wrap:anywhere}
.fs-opcao[data-ativa="1"]{background:var(--bg,#f3f6f3)}
.fs-opcao[aria-selected="true"]{font-weight:700;color:var(--ink)}
.fs-opcao[aria-selected="true"][data-destaque="1"],.fs-opcao[data-destaque="1"][data-ativa="1"]{background:var(--accent-soft,#e2f4e9)}
.fs-opcao[aria-disabled="true"]{opacity:.5;cursor:not-allowed}
.fs-opcao .fs-icone{flex:none;color:var(--muted)}
.fs-opcao .fs-marca{flex:none;color:var(--pine,var(--accent))}
.fs-selo{flex:none;padding:2px 8px;border-radius:6px;background:var(--accent-soft,#e2f4e9);color:var(--pine,var(--accent));font-size:11.5px;font-weight:700}
.fs-vazio{padding:12px 10px;font-size:14px;color:var(--muted)}
.fs-rodape{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 12px;padding:8px 12px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}
.fs-teclas{display:flex;align-items:center;gap:4px}
.fs-teclas kbd{min-width:20px;padding:1px 5px;border:1px solid var(--line);border-radius:5px;background:var(--surface,#fff);font:600 11px var(--body,inherit);text-align:center;color:var(--ink)}
@media (hover:none){.fs-teclas{display:none}}
`;

const icone = (corpo, tamanho = 16, classe = "fs-icone") => `<svg class="${classe}" width="${tamanho}" height="${tamanho}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;
const SETA = icone('<path d="m6 9 6 6 6-6"/>', 14, "fs-seta");
const MARCA = icone('<path d="M20 6 9 17l-5-5"/>', 16, "fs-marca");
// Ícones que a tela pode pedir: no botão (data-icone no select) ou numa opção (data-icone na option).
const ICONES = {
  local: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  todos: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10Z"/>',
  filtro: '<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3Z"/>',
  calendario: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
};
// Listas curtas, como a situação da cotação, dispensam o campo de busca.
const MINIMO_PARA_BUSCAR = 9;
const VALOR_NATIVO = globalThis.HTMLSelectElement && Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");

let sequencia = 0, fecharAberto = null;

function lerOpcoes(select) {
  return [...select.options].map((o) => ({
    valor: o.value, texto: o.textContent, indice: o.index, desativada: o.disabled,
    selo: o.dataset.selo || null, icone: o.dataset.icone || null,
    grupo: o.parentElement?.tagName === "OPTGROUP" ? o.parentElement.label : null,
  }));
}

function abrir(select, botao) {
  fecharAberto?.();
  const painel = document.createElement("div");
  painel.className = "fs-painel";
  const comBusca = select.dataset.busca !== undefined || select.options.length >= MINIMO_PARA_BUSCAR;
  if (!comBusca) painel.classList.add("fs-sem-busca");
  const caixaBusca = document.createElement("div");
  caixaBusca.className = "fs-busca";
  caixaBusca.hidden = !comBusca;
  const filtro = document.createElement("input");
  filtro.type = "text";
  filtro.placeholder = select.dataset.busca || "Buscar…";
  if (!comBusca) filtro.readOnly = true;
  filtro.autocomplete = "off";
  filtro.setAttribute("aria-label", "Filtrar opções");
  const lista = document.createElement("ul");
  lista.className = "fs-lista";
  lista.setAttribute("role", "listbox");
  lista.id = `fs-lista-${++sequencia}`;
  filtro.setAttribute("role", "combobox");
  filtro.setAttribute("aria-expanded", "true");
  filtro.setAttribute("aria-controls", lista.id);
  caixaBusca.append(filtro);
  // A contagem diz quantas opções aparecem, no nome que a tela pediu ("cidade|cidades").
  const [umItem, variosItens] = (select.dataset.contagem || "").split("|");
  const rodape = document.createElement("div");
  rodape.className = "fs-rodape";
  rodape.innerHTML = `<span data-contagem></span><span class="fs-teclas"><kbd>↑</kbd><kbd>↓</kbd> navegar <kbd>Enter</kbd> escolher</span>`;
  rodape.hidden = !umItem;
  painel.append(caixaBusca, lista, rodape);

  let visiveis = [], ativa = -1;
  const pintarAtiva = (rolar = true) => {
    lista.querySelectorAll(".fs-opcao").forEach((li) => {
      const eh = Number(li.dataset.pos) === ativa;
      li.dataset.ativa = eh ? "1" : "0";
      if (eh) {
        filtro.setAttribute("aria-activedescendant", li.id);
        if (rolar) li.scrollIntoView({ block: "nearest" });
      }
    });
  };
  const desenhar = () => {
    visiveis = filtrarOpcoes(lerOpcoes(select), filtro.value);
    lista.replaceChildren();
    filtro.removeAttribute("aria-activedescendant");
    if (!visiveis.length) {
      const vazio = document.createElement("li");
      vazio.className = "fs-vazio";
      vazio.textContent = "Nada encontrado";
      lista.append(vazio);
      ativa = -1;
      if (umItem) rodape.querySelector("[data-contagem]").textContent = `0 ${variosItens || umItem}`;
      return;
    }
    let grupo = null;
    visiveis.forEach((o, pos) => {
      if (o.grupo && o.grupo !== grupo) {
        const g = document.createElement("li");
        g.className = "fs-grupo";
        g.setAttribute("role", "presentation");
        g.textContent = o.grupo;
        lista.append(g);
      }
      grupo = o.grupo;
      const li = document.createElement("li");
      li.className = "fs-opcao";
      li.id = `${lista.id}-${pos}`;
      li.dataset.pos = pos;
      li.setAttribute("role", "option");
      const marcada = o.indice === select.selectedIndex;
      li.setAttribute("aria-selected", String(marcada));
      if (o.desativada) li.setAttribute("aria-disabled", "true");
      if (o.icone) li.dataset.destaque = "1";
      li.innerHTML = `${o.icone && ICONES[o.icone] ? icone(ICONES[o.icone]) : ""}<span class="fs-texto"></span>${o.selo ? `<span class="fs-selo"></span>` : ""}${marcada ? MARCA : ""}`;
      li.querySelector(".fs-texto").textContent = o.texto;
      if (o.selo) li.querySelector(".fs-selo").textContent = o.selo;
      lista.append(li);
    });
    if (umItem) {
      const n = visiveis.filter((o) => o.valor !== "" && !o.icone).length;
      rodape.querySelector("[data-contagem]").textContent = `${n} ${n === 1 ? umItem : variosItens || umItem}`;
    }
    const atual = visiveis.findIndex((o) => o.indice === select.selectedIndex && !o.desativada);
    ativa = atual >= 0 ? atual : visiveis.findIndex((o) => !o.desativada);
    pintarAtiva();
  };
  const escolher = (o) => {
    if (!o || o.desativada) return;
    const mudou = select.selectedIndex !== o.indice;
    select.selectedIndex = o.indice;
    fechar(true);
    botao.querySelector("span").textContent = textoDoBotao(select, o);
    if (mudou) {
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };
  const mover = (passo) => {
    if (!visiveis.length) return;
    let i = ativa;
    for (let n = 0; n < visiveis.length; n++) {
      i = (i + passo + visiveis.length) % visiveis.length;
      if (!visiveis[i].desativada) break;
    }
    ativa = i;
    pintarAtiva();
  };

  filtro.addEventListener("input", desenhar);
  filtro.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); mover(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); mover(-1); }
    else if (e.key === "Enter") { e.preventDefault(); escolher(visiveis[ativa]); }
    // Sem isso, o Esc também fecharia a janela do editor de planos.
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fechar(true); }
    else if (e.key === "Tab") fechar(false);
  });
  lista.addEventListener("mousedown", (e) => e.preventDefault());
  lista.addEventListener("click", (e) => {
    const li = e.target.closest(".fs-opcao");
    if (li) escolher(visiveis[Number(li.dataset.pos)]);
  });
  lista.addEventListener("mousemove", (e) => {
    const li = e.target.closest(".fs-opcao");
    if (li && Number(li.dataset.pos) !== ativa) { ativa = Number(li.dataset.pos); pintarAtiva(false); }
  });

  const posicionar = () => {
    const r = botao.getBoundingClientRect(), margem = 8;
    const abaixo = innerHeight - r.bottom - margem, acima = r.top - margem;
    const paraCima = abaixo < 220 && acima > abaixo;
    const largura = Math.min(Math.max(r.width, 220), innerWidth - 2 * margem);
    painel.style.width = `${largura}px`;
    painel.style.left = `${Math.max(margem, Math.min(r.left, innerWidth - largura - margem))}px`;
    painel.style.maxHeight = `${Math.min(340, Math.max(paraCima ? acima : abaixo, 140))}px`;
    painel.style.top = paraCima ? "auto" : `${r.bottom + 4}px`;
    painel.style.bottom = paraCima ? `${innerHeight - r.top + 4}px` : "auto";
  };
  const foraDoPainel = (e) => {
    if (!painel.contains(e.target) && !botao.contains(e.target)) fechar(false);
  };
  // Rolar não fecha: no celular, abrir o teclado para digitar o filtro já rola a tela.
  const aoRolar = (e) => {
    if (painel.contains(e.target)) return;
    const r = botao.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) fechar(false);
    else posicionar();
  };
  const aoRedimensionar = () => fechar(false);
  function fechar(voltarFoco) {
    fecharAberto = null;
    painel.remove();
    botao.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", foraDoPainel, true);
    removeEventListener("scroll", aoRolar, true);
    removeEventListener("resize", aoRedimensionar);
    if (voltarFoco && botao.isConnected) botao.focus();
  }

  fecharAberto = fechar;
  botao.setAttribute("aria-expanded", "true");
  document.body.append(painel);
  desenhar();
  posicionar();
  filtro.focus();
  document.addEventListener("mousedown", foraDoPainel, true);
  addEventListener("scroll", aoRolar, true);
  addEventListener("resize", aoRedimensionar);
}

// A etiqueta só entra no botão quando a tela pede (a UF da cidade, sim; a contagem da situação, não).
const textoDoBotao = (select, o) => (o ? (o.selo && select.dataset.seloNoBotao !== undefined ? `${o.texto} (${o.selo})` : o.texto) : "Selecionar");

function ativarSelect(select) {
  if (select.dataset.filtro) return;
  select.dataset.filtro = "1";
  const envoltorio = document.createElement("div");
  envoltorio.className = "fs";
  const botao = document.createElement("button");
  botao.type = "button";
  botao.id = `fs-botao-${++sequencia}`;
  botao.setAttribute("aria-haspopup", "listbox");
  botao.setAttribute("aria-expanded", "false");
  botao.innerHTML = `${ICONES[select.dataset.icone] ? icone(ICONES[select.dataset.icone]) : ""}<span></span>${SETA}`;

  const rotulo = select.id ? [...document.querySelectorAll("label[for]")].find((l) => l.htmlFor === select.id) : null;
  if (rotulo) rotulo.htmlFor = botao.id;

  const atualizar = () => {
    const o = select.selectedOptions[0];
    botao.querySelector("span").textContent = textoDoBotao(select, o && { texto: o.textContent, selo: o.dataset.selo });
    botao.disabled = select.disabled;
    if (select.getAttribute("aria-label")) botao.setAttribute("aria-label", select.getAttribute("aria-label"));
  };
  botao.addEventListener("click", () => {
    if (botao.getAttribute("aria-expanded") === "true") fecharAberto?.(true);
    else abrir(select, botao);
  });

  select.before(envoltorio);
  envoltorio.append(botao, select);
  // O botão herda as classes do select, como as cores da situação no histórico.
  botao.className = `fs-botao ${select.className}`.trim();
  select.classList.add("fs-oculto");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");

  // Mantém o botão certo quando o código troca o valor ou as opções do select.
  Object.defineProperty(select, "value", {
    configurable: true,
    get() { return VALOR_NATIVO.get.call(select); },
    set(v) { VALOR_NATIVO.set.call(select, v); atualizar(); },
  });
  new MutationObserver(atualizar).observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["disabled", "selected"] });
  select.addEventListener("change", atualizar);
  atualizar();
}

export function iniciarFiltroSelects(raiz = document.body) {
  const estilo = document.createElement("style");
  estilo.textContent = CSS;
  // No começo do head, para o CSS de cada tela poder ajustar o botão.
  document.head.prepend(estilo);
  raiz.querySelectorAll("select").forEach(ativarSelect);
  new MutationObserver((mudancas) => {
    for (const m of mudancas) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches("select")) ativarSelect(n);
        n.querySelectorAll("select").forEach(ativarSelect);
      }
    }
    if (fecharAberto && !document.querySelector('.fs-botao[aria-expanded="true"]')) fecharAberto(false);
  }).observe(raiz, { childList: true, subtree: true });
}
