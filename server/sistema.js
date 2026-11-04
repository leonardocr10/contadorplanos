// Atualização pelo próprio cotador: baixa a versão nova do GitHub e reinicia.
// Os comandos são fixos: nada do que vem da tela entra neles.
import { execFile } from "node:child_process";

export const CODIGO_REINICIAR = 75;

export function criarSistema({ raiz, reiniciar, podeReiniciar, rodarGit }) {
  const git = rodarGit ?? ((...args) => new Promise((ok, erro) => {
    execFile("git", ["-C", raiz, ...args], { timeout: 120_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" } }, (e, stdout, stderr) => {
      if (e) erro(new Error(String(stderr || e.message).trim()));
      else ok(String(stdout).trim());
    });
  }));
  const commitAtual = () => git("rev-parse", "HEAD");
  let emAndamento = false;

  return {
    async versao() {
      const [commit, data] = (await git("log", "-1", "--format=%h|%cI")).split("|");
      return { commit, data };
    },
    async atualizar() {
      if (emAndamento) return { ocupado: true };
      emAndamento = true;
      try {
        const antes = await commitAtual();
        await git("pull", "--ff-only");
        const depois = await commitAtual();
        if (antes === depois) return { atualizado: false };
        const reiniciando = podeReiniciar();
        // Espera a resposta chegar à tela antes de encerrar.
        if (reiniciando) setTimeout(reiniciar, 500);
        return { atualizado: true, reiniciando };
      } finally {
        emAndamento = false;
      }
    },
  };
}
