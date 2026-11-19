// Telas que o administrador libera para cada usuário, na ordem do menu. É a lista única do sistema:
// a tela de usuários, o servidor e as permissões saem daqui. Todo menu novo precisa entrar nesta lista
// (ou em VIEW_PARA_TELA, se for parte de outra tela); um teste confere que nenhum menu fica de fora.
// "padrao" vale para quem não tem a tela salva; "herdaDe" copia o acesso de outra tela nesse caso,
// para quem já usava a tela nova por ela antes da separação.
export const TELAS_DO_SISTEMA = [
  { tela: "cotacao", nome: "Nova Cotação", padrao: "editar" },
  { tela: "historico", nome: "Histórico", padrao: "editar" },
  { tela: "aceites", nome: "Aceites", padrao: "editar" },
  { tela: "planos", nome: "Planos e Valores", padrao: "ver" },
  { tela: "documentos", nome: "Documentos", padrao: "ver" },
  { tela: "contratos", nome: "Contratos Vendidos", padrao: "editar" },
  // O Financeiro (comissões) começa fechado: o administrador libera para quem precisar.
  { tela: "financeiro", nome: "Financeiro", padrao: "nenhum" },
  { tela: "resgate", nome: "Resgate", padrao: "editar", herdaDe: "historico" },
];

// Itens do menu que são parte de outra tela na permissão (os submenus do Financeiro).
export const VIEW_PARA_TELA = { regras: "financeiro", comissoes: "financeiro" };
// Itens do menu que todo login vê, sem liberação.
export const VIEWS_LIVRES = ["configuracoes", "manual"];
