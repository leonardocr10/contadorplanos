// O que cada login faz em cada tela. O administrador sempre pode tudo.
export const TELAS = ["cotacao", "planos", "documentos", "historico", "aceites"];
export const NIVEIS = ["nenhum", "ver", "editar"];

// Vale para quem foi criado sem escolher, e repete o que os usuários já podiam fazer.
export const PERMISSOES_PADRAO = { cotacao: "editar", planos: "ver", documentos: "ver", historico: "editar", aceites: "editar" };

export function permissoesDoUsuario(perfil, json) {
  if (perfil === "admin") return Object.fromEntries(TELAS.map((t) => [t, "editar"]));
  let salvas = {};
  try {
    salvas = JSON.parse(json || "{}") ?? {};
  } catch {
    // Conteúdo inválido cai no padrão.
  }
  return Object.fromEntries(TELAS.map((t) => [t, NIVEIS.includes(salvas[t]) ? salvas[t] : PERMISSOES_PADRAO[t]]));
}

export const atende = (nivel, minimo) => NIVEIS.indexOf(nivel) >= NIVEIS.indexOf(minimo);
