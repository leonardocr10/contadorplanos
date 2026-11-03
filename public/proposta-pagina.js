// Página pública da proposta: mostra só a lista de carências da situação escolhida.
import { iniciarFiltroSelects } from "/filtro-select.js";

iniciarFiltroSelects();

const seletor = document.getElementById("situacao");
if (seletor) {
  seletor.addEventListener("change", () => {
    for (const lista of document.querySelectorAll("[data-situacao]")) {
      lista.hidden = lista.dataset.situacao !== seletor.value;
    }
  });
  // Ao voltar para a página, o navegador pode restaurar a última escolha do seletor.
  seletor.dispatchEvent(new Event("change"));
}
