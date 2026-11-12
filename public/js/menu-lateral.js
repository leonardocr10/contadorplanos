/* Menu lateral fixo ou recolhido (só no computador). O cadeado fechado deixa o menu sempre aberto; aberto,
   o menu recolhe para a faixa de ícones e abre por cima da tela ao passar o mouse. A escolha fica no navegador. */
(() => {
  const CHAVE = "cotador.menu";
  const corpo = document.body;
  let guardado = null;
  try { guardado = localStorage.getItem(CHAVE); } catch {}
  // Aplicado antes do resto da página aparecer, para o menu não abrir e fechar ao carregar.
  corpo.classList.toggle("menu-recolhido", guardado === "recolhido");

  document.addEventListener("DOMContentLoaded", () => {
    const menu = document.querySelector("header.top");
    const cadeado = document.getElementById("menu-cadeado");
    const pintar = () => {
      const fixo = !corpo.classList.contains("menu-recolhido");
      cadeado.classList.toggle("fixado", fixo);
      cadeado.setAttribute("aria-pressed", String(fixo));
      cadeado.title = fixo ? "Menu fixo: clique para recolher" : "Menu recolhido: clique para fixar";
      cadeado.querySelector(".sr").textContent = fixo ? "Menu fixo" : "Menu recolhido";
    };
    cadeado.onclick = () => {
      const recolher = !corpo.classList.contains("menu-recolhido");
      corpo.classList.toggle("menu-recolhido", recolher);
      try { localStorage.setItem(CHAVE, recolher ? "recolhido" : "fixo"); } catch {}
      // Ao recolher, o mouse ainda está em cima do menu: ele só volta a abrir depois que o mouse sair e voltar.
      if (recolher) menu.classList.add("saindo-do-mouse");
      pintar();
    };
    menu.addEventListener("mouseleave", () => menu.classList.remove("saindo-do-mouse"));
    pintar();
  });
})();
