// Acrescenta um campo de filtro a todo <select> da página, inclusive os criados depois.
// O select original continua guardando o valor, então quem o usa não precisa mudar nada.
export const normalizar = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function filtrarOpcoes(opcoes, termo) {
  // Cada palavra pode aparecer em qualquer parte: "unimed car" encontra "Unimed – carências".
  const palavras = normalizar(termo).split(/\s+/).filter(Boolean);
  return opcoes.filter((o) => {
    const alvo = normalizar(`${o.texto} ${o.grupo ?? ""}`);
    return palavras.every((p) => alvo.includes(p));
  });
}

const CSS = `
.fs{position:relative;width:100%;min-width:0}
.fs-botao{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-height:40px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg,#fff);color:var(--ink);font-family:var(--body,inherit);font-size:15px;font-weight:500;line-height:1.2;text-align:left;cursor:pointer}
.fs-botao span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fs-botao svg{flex:none}
.fs-oculto{position:absolute;width:1px;height:1px;margin:0;padding:0;border:0;opacity:0;pointer-events:none}
.fs-painel{position:fixed;z-index:1000;display:flex;flex-direction:column;min-width:220px;background:var(--surface,#fff);color:var(--ink);border:1px solid var(--line);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.2);overflow:hidden;font-family:var(--body,inherit)}
.fs-painel input{flex:none;width:auto;margin:8px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg,#fff);color:var(--ink);font:inherit;font-size:14px}
.fs-lista{flex:1;min-height:0;margin:0;padding:0 0 6px;overflow-y:auto;list-style:none;font-size:14px}
.fs-grupo{padding:6px 12px 2px;font-size:12px;font-weight:700;color:var(--muted)}
.fs-opcao{padding:8px 12px;cursor:pointer;overflow-wrap:anywhere}
.fs-opcao[data-ativa="1"]{background:var(--accent-soft,var(--side));}
.fs-opcao[aria-selected="true"]{font-weight:800;color:var(--pine,var(--accent))}
.fs-opcao[aria-disabled="true"]{opacity:.5;cursor:not-allowed}
.fs-vazio{padding:10px 12px;font-size:14px;color:var(--muted)}
`;

const SETA = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const VALOR_NATIVO = globalThis.HTMLSelectElement && Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");

let sequencia = 0, fecharAberto = null;

function lerOpcoes(select) {
  return [...select.options].map((o) => ({
    valor: o.value, texto: o.textContent, indice: o.index, desativada: o.disabled,
    grupo: o.parentElement?.tagName === "OPTGROUP" ? o.parentElement.label : null,
  }));
}

function abrir(select, botao) {
  fecharAberto?.();
  const painel = document.createElement("div");
  painel.className = "fs-painel";
  const filtro = document.createElement("input");
  filtro.type = "text";
  filtro.placeholder = "Filtrar…";
  filtro.autocomplete = "off";
  filtro.setAttribute("aria-label", "Filtrar opções");
  const lista = document.createElement("ul");
  lista.className = "fs-lista";
  lista.setAttribute("role", "listbox");
  lista.id = `fs-lista-${++sequencia}`;
  filtro.setAttribute("role", "combobox");
  filtro.setAttribute("aria-expanded", "true");
  filtro.setAttribute("aria-controls", lista.id);
  painel.append(filtro, lista);

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
      li.setAttribute("aria-selected", String(o.indice === select.selectedIndex));
      if (o.desativada) li.setAttribute("aria-disabled", "true");
      li.textContent = o.texto;
      lista.append(li);
    });
    const atual = visiveis.findIndex((o) => o.indice === select.selectedIndex && !o.desativada);
    ativa = atual >= 0 ? atual : visiveis.findIndex((o) => !o.desativada);
    pintarAtiva();
  };
  const escolher = (o) => {
    if (!o || o.desativada) return;
    const mudou = select.selectedIndex !== o.indice;
    select.selectedIndex = o.indice;
    fechar(true);
    botao.querySelector("span").textContent = o.texto;
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
  botao.innerHTML = `<span></span>${SETA}`;

  const rotulo = select.id ? [...document.querySelectorAll("label[for]")].find((l) => l.htmlFor === select.id) : null;
  if (rotulo) rotulo.htmlFor = botao.id;

  const atualizar = () => {
    botao.querySelector("span").textContent = select.selectedOptions[0]?.textContent ?? "Selecionar";
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
