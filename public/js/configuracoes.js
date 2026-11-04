// Aba "Configurações": mostra a versão instalada e atualiza o sistema pelo GitHub.
import { $, api } from "./estado.js";

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const msg = (t) => ($("#cfg-msg").textContent = t);

async function mostrarVersao() {
  try {
    const { commit, data } = await api("/api/sistema/versao");
    $("#cfg-versao").textContent = `Versão instalada: ${commit}, de ${new Date(data).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`;
  } catch (e) {
    $("#cfg-versao").textContent = e.message;
  }
}

// Durante o reinício a conexão falha. Qualquer resposta indica que o cotador voltou.
async function esperarVoltar() {
  await espera(3000);
  for (let i = 0; i < 100; i++) {
    try {
      await fetch("/api/status", { cache: "no-store" });
      location.reload();
      return true;
    } catch {
      await espera(3000);
    }
  }
  return false;
}

export function iniciarConfiguracoes() {
  mostrarVersao();
  $("#cfg-atualizar").onclick = async () => {
    const botao = $("#cfg-atualizar");
    botao.disabled = true;
    msg("Procurando atualização…");
    try {
      const r = await api("/api/sistema/atualizar", { metodo: "POST", json: {} });
      if (r.ocupado) msg("Já existe uma atualização em andamento.");
      else if (!r.atualizado) msg("O sistema já está na versão mais recente.");
      else if (!r.reiniciando) msg("Versão nova baixada. Feche a janela do cotador e abra o iniciar.bat de novo para concluir.");
      else {
        msg("Versão nova baixada. Reiniciando, o que pode levar alguns minutos…");
        if (!(await esperarVoltar())) msg("O cotador não voltou. Verifique a janela do iniciar.bat no servidor.");
        return;
      }
    } catch (e) {
      msg(`Não deu para atualizar: ${e.message}`);
    }
    botao.disabled = false;
  };
}
