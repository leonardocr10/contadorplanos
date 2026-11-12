/* Menu lateral fixo ou recolhido (só no computador). Recolhido, vira uma faixa estreita: passar o mouse ou
   clicar no botão abre o menu por cima da tela, sem empurrar o conteúdo. A escolha fica guardada no navegador. */
(() => {
  const CHAVE = "cotador.menu";
  const corpo = document.body;
  let guardado = null;
  try { guardado = localStorage.getItem(CHAVE); } catch {}
  // Aplicado antes do resto da página aparecer, para o menu não abrir e fechar ao carregar.
  corpo.classList.toggle("menu-recolhido", guardado === "recolhido");

  document.addEventListener("DOMContentLoaded", () => {
    const menu = document.querySelector("header.top");
    const fixar = document.getElementById("menu-fixar");
    const abrir = document.getElementById("menu-abrir");
    const pintar = () => {
      const recolhido = corpo.classList.contains("menu-recolhido");
      fixar.title = recolhido ? "Deixar o menu sempre aberto" : "Esconder o menu e usar a tela toda";
      fixar.querySelector("span").textContent = recolhido ? "Fixar menu" : "Recolher menu";
      fixar.setAttribute("aria-pressed", String(!recolhido));
      fixar.classList.toggle("fixado", !recolhido);
      abrir.setAttribute("aria-expanded", String(menu.classList.contains("aberto")));
    };
    const fecharSobreposto = () => { menu.classList.remove("aberto"); pintar(); };
    fixar.onclick = () => {
      const recolher = !corpo.classList.contains("menu-recolhido");
      corpo.classList.toggle("menu-recolhido", recolher);
      menu.classList.remove("aberto");
      try { localStorage.setItem(CHAVE, recolher ? "recolhido" : "fixo"); } catch {}
      // Com o menu recolhido, o mouse ainda está em cima dele: só fecha quando sair.
      if (recolher) menu.classList.add("saindo-do-mouse");
      pintar();
    };
    menu.addEventListener("mouseleave", () => menu.classList.remove("saindo-do-mouse"));
    abrir.onclick = () => { menu.classList.toggle("aberto"); pintar(); };
    // Escolher uma tela, clicar fora ou apertar Esc fecha o menu aberto por cima.
    menu.addEventListener("click", (e) => { if (e.target.closest(".tabs button, #usuario-logado")) fecharSobreposto(); });
    document.addEventListener("click", (e) => { if (menu.classList.contains("aberto") && !menu.contains(e.target)) fecharSobreposto(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && menu.classList.contains("aberto")) { fecharSobreposto(); abrir.focus(); } });
    pintar();
  });
})();
