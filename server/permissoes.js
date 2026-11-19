// O que cada login faz em cada tela. O administrador sempre pode tudo.
// A lista das telas é a mesma da tela de usuários (public/js/telas.js).
import { TELAS_DO_SISTEMA } from "../public/js/telas.js";

export const TELAS = TELAS_DO_SISTEMA.map((t) => t.tela);
export const NIVEIS = ["nenhum", "ver", "editar"];
// Telas que usam a lista de planos (a cotação, os documentos, o campo plano dos contratos vendidos e as regras de comissão).
export const TELAS_COM_PLANOS = ["cotacao", "planos", "documentos", "contratos", "financeiro"];

// Vale para quem foi criado sem escolher, e repete o que os usuários já podiam fazer.
export const PERMISSOES_PADRAO = Object.fromEntries(TELAS_DO_SISTEMA.map((t) => [t.tela, t.padrao]));

// Nível de uma tela que não veio salva: o da tela de onde ela saiu (se houver) ou o padrão.
export function nivelPadrao(tela, salvas = {}) {
  const t = TELAS_DO_SISTEMA.find((x) => x.tela === tela);
  return t?.herdaDe && NIVEIS.includes(salvas[t.herdaDe]) ? salvas[t.herdaDe] : PERMISSOES_PADRAO[tela];
}

export function permissoesDoUsuario(perfil, json) {
  if (perfil === "admin") return Object.fromEntries(TELAS.map((t) => [t, "editar"]));
  let salvas = {};
  try {
    salvas = JSON.parse(json || "{}") ?? {};
  } catch {
    // Conteúdo inválido cai no padrão.
  }
  return Object.fromEntries(TELAS.map((t) => [t, NIVEIS.includes(salvas[t]) ? salvas[t] : nivelPadrao(t, salvas)]));
}

export const atende = (nivel, minimo) => NIVEIS.indexOf(nivel) >= NIVEIS.indexOf(minimo);
