// Leitura automática de tabelas de operadoras com a API do Claude.
import Anthropic from "@anthropic-ai/sdk";
import { parseBRL, r2 } from "../public/js/calculo.js";

export const MODELO_PADRAO = "claude-sonnet-5-5";
export const MAX_IMAGENS = 20;
const MAX_BASE64 = 6_900_000; // cerca de 5 MB depois de decodificado, o limite da API por imagem

// Modelos que aceitam o desvio automático para outro modelo quando um pedido é recusado.
const MODELOS_COM_FALLBACK = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

export class ErroLeitura extends Error {
  constructor(status, codigo, mensagem) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

export function montarPrompt(nome, sub) {
  const objetivo = nome.trim() ? `está atualizando o plano "${nome}"${sub ? ` (${sub})` : ""}` : "está cadastrando um plano novo";
  return `Você ajuda um corretor de planos de saúde de Uberlândia (MG). As imagens são páginas do material de vendas de uma operadora, na ordem (imagem 1, imagem 2, ...). O corretor ${objetivo} no cotador dele.
Leia todo o material e responda SOMENTE com um JSON neste formato:
{"nomePlano":"nome em maiúsculas","subtituloPlano":"texto curto",
"colunas":[{"titulo":"plano + acomodação ou tipo + tipo de coparticipação, como aparece","valores":[10 números ou null]}],
"colunaEnfermaria":número,"colunaApartamento":número,
"taxaAssociativa":número ou null,
"cidade":"cidade ou região da rede",
"areaComercializacao":"cidades onde o plano pode ser vendido",
"rede":["hospitais credenciados deste plano"],
"extras":["benefícios e informações curtas, cada uma começando com um emoji"],
"odontoIncluso":true ou false,
"descricao":"texto para o cliente",
"coparticipacaoTexto":"texto para o cliente",
"tabelaCoparticipacaoTexto":"tabela em texto","tabelaCarenciaTexto":"tabela em texto",
"corPrimaria":"#rrggbb","corEscura":"#rrggbb",
"tabelaCoparticipacao":{"pagina":número,"retangulos":[{"x":0.0,"y":0.0,"w":0.0,"h":0.0}]} ou null,
"tabelaCarencia":{"pagina":número,"retangulos":[{"x":0.0,"y":0.0,"w":0.0,"h":0.0}]} ou null}
Instruções:
- nomePlano: operadora e produto em maiúsculas, como "PLAMEDH BASIC". Quando a tabela reunir produtos diferentes para enfermaria e apartamento, use só o nome da operadora.
- subtituloPlano: produtos, acomodações, tipo de contratação e administradora, como "Basic (Enfermaria) e Select (Apartamento) Adesão – com coparticipação".
- colunas: TODAS as colunas de preço mensal por faixa etária. As 10 faixas da ANS, nesta ordem: 0-18, 19-23, 24-28, 29-33, 34-38, 39-43, 44-48, 49-53, 54-58, 59 ou mais. Números com ponto decimal ("R$ 1.168,14" vira 1168.14); null onde estiver vazio ou com traço.
- colunaEnfermaria / colunaApartamento: índice (a partir de 0) da coluna que corresponde a este plano em enfermaria (ou coletivo) e em apartamento (ou individual); -1 se não existir.
- taxaAssociativa: valor mensal da taxa associativa ou de filiação, se houver.
- cidade: a cidade principal do plano. Se Uberlândia estiver na área de comercialização, use Uberlândia; senão, use a região do material, como "Triângulo Mineiro".
- areaComercializacao: todas as cidades listadas como área de comercialização, sem omitir nenhuma. Uma linha por estado, com a sigla, dois pontos e as cidades separadas por vírgula, como "MG: Uberlândia, Araguari". Não confunda com área de atendimento ou abrangência da cobertura, a menos que o material só traga essa informação. "" se o material não informar.
- rede: todos os hospitais, laboratórios e clínicas que valem para este plano, de todas as cidades listadas, um por item. Escreva SEMPRE "Prestador – Cidade", com travessão entre espaços, mesmo quando houver uma cidade só: "Hospital Santa Lúcia – Uberaba". Use o nome da cidade igual ao de areaComercializacao. Quando uma célula listar vários prestadores, separe cada um em um item. Se a tabela tiver colunas por plano, inclua só os prestadores marcados para este plano. [] se o material não listar os prestadores, por exemplo quando só indica o site da operadora.
- extras: até 6 itens, como odontológico incluso, telemedicina, SOS ou remoção, laboratórios e clínicas de imagem, quem pode aderir.
- descricao: 2 a 4 frases simples para o cliente: tipo de contratação e segmentação, condições de carência ou redução de carência, mês de reajuste e regras importantes de idade ou dependentes.
- coparticipacaoTexto: siga este modelo, trocando os itens e valores pelos da tabela deste plano: "Você paga a mensalidade normalmente e, quando usar, paga uma parte com teto por item: consultas eletivas 30% (até R$ 30,00), pronto-socorro 40% (até R$ 90,00), exames básicos e especiais 30%, terapias 40% (até R$ 60,00) e internação R$ 220,00. Os valores vêm no boleto do mês seguinte." Escreva "um valor fixo por item" quando todos os valores forem fixos e "uma parte por item" quando houver valores fixos e percentuais. Os valores do modelo são só exemplo: use apenas os do material.
- tabelaCoparticipacaoTexto: a tabela de coparticipação DESTE plano reescrita de forma limpa para o cliente. Primeira linha com os títulos das colunas, depois uma linha por procedimento, colunas separadas por " | " e linhas separadas por quebra de linha. Só as colunas deste plano. Copie fielmente todas as linhas, nomes e valores exatamente como estão no material, sem resumir, juntar ou omitir nada.
- tabelaCarenciaTexto: a tabela de carências no mesmo formato, copiando fielmente todas as linhas, colunas e prazos exatamente como estão no material, sem resumir, juntar ou omitir nada.
- corPrimaria / corEscura: as cores da identidade visual da operadora usadas nas tabelas do material (a principal e uma versão mais escura para fundo de cabeçalho), em hexadecimal.
- tabelaCoparticipacao / tabelaCarencia: em qual imagem (1 = primeira) está a tabela e o retângulo dela em frações da largura e altura da página (x e y = canto superior esquerdo), com uma pequena margem. Se a tabela de coparticipação tiver colunas de vários planos, devolva dois retângulos: um para a coluna de procedimentos e outro só para as colunas deste plano, da esquerda para a direita.
- Não invente nada que não esteja no material. Escreva em português do Brasil.`;
}

export function extrairJson(texto) {
  const ini = texto.indexOf("{"), fim = texto.lastIndexOf("}");
  if (ini < 0 || fim <= ini) throw new ErroLeitura(502, "resposta_invalida", "O Claude não devolveu uma resposta legível. Tente ler de novo.");
  try {
    return JSON.parse(texto.slice(ini, fim + 1));
  } catch {
    throw new ErroLeitura(502, "resposta_invalida", "O Claude não devolveu uma resposta legível. Tente ler de novo.");
  }
}

const clamp01 = (v) => Math.max(0, Math.min(1, +v || 0));
const texto = (v) => String(v ?? "").trim();
const cor = (v) => (/^#[0-9a-f]{6}$/i.test(texto(v)) ? texto(v) : "");
const lista = (v) => (Array.isArray(v) ? v.map(texto).filter(Boolean) : []);

function numeroPositivo(v) {
  const n = typeof v === "number" ? v : parseBRL(v);
  return n != null && isFinite(n) && n > 0 ? r2(n) : null;
}

function normalizarTabela(t, totalPaginas) {
  if (!t || !Array.isArray(t.retangulos)) return null;
  const pagina = Number.parseInt(t.pagina, 10);
  if (!(pagina >= 1 && pagina <= totalPaginas)) return null;
  const retangulos = t.retangulos
    .map((r) => {
      const x = clamp01(r?.x), y = clamp01(r?.y);
      return { x, y, w: Math.min(clamp01(r?.w), 1 - x), h: Math.min(clamp01(r?.h), 1 - y) };
    })
    .filter((r) => r.w > 0.02 && r.h > 0.02);
  return { pagina, retangulos };
}

export function normalizarLeitura(r, totalPaginas) {
  const brutas = Array.isArray(r?.colunas) ? r.colunas : [];
  const colunas = [];
  const novoIndice = new Map();
  brutas.forEach((c, i) => {
    const valores = Array.from({ length: 10 }, (_, k) => numeroPositivo(c?.valores?.[k]));
    if (!valores.some((v) => v != null)) return;
    novoIndice.set(i, colunas.length);
    colunas.push({ titulo: texto(c?.titulo).slice(0, 120), valores });
  });
  // Colunas vazias saem da lista, então os índices escolhidos pelo modelo precisam acompanhar.
  const indice = (v) => (Number.isInteger(v) && novoIndice.has(v) ? novoIndice.get(v) : -1);
  return {
    nomePlano: texto(r?.nomePlano).slice(0, 120),
    subtituloPlano: texto(r?.subtituloPlano).slice(0, 200),
    colunas,
    colunaEnfermaria: indice(r?.colunaEnfermaria),
    colunaApartamento: indice(r?.colunaApartamento),
    taxaAssociativa: numeroPositivo(r?.taxaAssociativa),
    cidade: texto(r?.cidade),
    areaComercializacao: texto(r?.areaComercializacao),
    rede: lista(r?.rede),
    extras: lista(r?.extras).slice(0, 8),
    odontoIncluso: r?.odontoIncluso === true,
    descricao: texto(r?.descricao),
    coparticipacaoTexto: texto(r?.coparticipacaoTexto),
    tabelaCoparticipacaoTexto: texto(r?.tabelaCoparticipacaoTexto),
    tabelaCarenciaTexto: texto(r?.tabelaCarenciaTexto),
    corPrimaria: cor(r?.corPrimaria),
    corEscura: cor(r?.corEscura),
    tabelaCoparticipacao: normalizarTabela(r?.tabelaCoparticipacao, totalPaginas),
    tabelaCarencia: normalizarTabela(r?.tabelaCarencia, totalPaginas),
  };
}

function validarEntrada({ imagens }) {
  if (!Array.isArray(imagens) || !imagens.length) throw new ErroLeitura(400, "sem_imagens", "Marque ao menos uma página para ler.");
  if (imagens.length > MAX_IMAGENS) throw new ErroLeitura(400, "muitas_imagens", `Marque no máximo ${MAX_IMAGENS} páginas.`);
  return imagens.map((img) => {
    const dados = typeof img === "string" ? img.replace(/^data:image\/\w+;base64,/, "") : "";
    if (!dados || !/^[A-Za-z0-9+/=]+$/.test(dados)) throw new ErroLeitura(400, "imagem_rejeitada", "Uma das páginas não é uma imagem válida.");
    if (dados.length > MAX_BASE64) throw new ErroLeitura(413, "imagem_rejeitada", "Uma das páginas é grande demais. Desmarque algumas páginas e tente de novo.");
    return dados;
  });
}

function traduzirErro(e) {
  if (e instanceof ErroLeitura) return e;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new ErroLeitura(502, "chave_invalida", "A chave da API foi recusada. Confira ANTHROPIC_API_KEY no arquivo .env e reinicie o cotador.");
  }
  if (e instanceof Anthropic.NotFoundError) {
    return new ErroLeitura(502, "modelo_invalido", "O modelo configurado em ANTHROPIC_MODEL não foi encontrado. Confira o arquivo .env.");
  }
  if (e instanceof Anthropic.RateLimitError) {
    return new ErroLeitura(429, "limite_uso", "Muitas leituras seguidas. Aguarde um minuto e tente de novo.");
  }
  if (e instanceof Anthropic.BadRequestError) {
    return new ErroLeitura(400, "imagem_rejeitada", `A API recusou o pedido. Desmarque algumas páginas e tente de novo. Detalhe: ${e.message}`);
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new ErroLeitura(502, "sem_conexao", "Não consegui falar com a API do Claude. Verifique a internet e tente de novo.");
  }
  if (e instanceof Anthropic.APIError) {
    return new ErroLeitura(502, "erro_api", "A API do Claude está indisponível no momento. Tente de novo em instantes.");
  }
  return e;
}

export async function lerTabela({ nome = "", subtitulo = "", imagens }, { apiKey, modelo = MODELO_PADRAO, cliente } = {}) {
  if (!apiKey && !cliente) {
    throw new ErroLeitura(503, "sem_chave", "A leitura automática precisa de uma chave da API. Coloque a chave em ANTHROPIC_API_KEY no arquivo .env (na pasta do cotador) e reinicie o cotador.");
  }
  const dados = validarEntrada({ imagens });
  const client = cliente ?? new Anthropic({ apiKey });
  const conteudo = [
    ...dados.map((data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } })),
    { type: "text", text: montarPrompt(String(nome), String(subtitulo)) },
  ];
  const fallback = MODELOS_COM_FALLBACK.has(modelo) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {};
  try {
    // Com streaming, leituras longas de muitas páginas não estouram o tempo limite da conexão.
    const stream = client.beta.messages.stream({ model: modelo, max_tokens: 64000, ...fallback, messages: [{ role: "user", content: conteudo }] });
    const resposta = await stream.finalMessage();
    if (resposta.stop_reason === "refusal") throw new ErroLeitura(422, "recusado", "O Claude não leu este material. Desmarque páginas que não são tabelas e tente de novo.");
    if (resposta.stop_reason === "max_tokens") throw new ErroLeitura(422, "muito_longo", "O material é longo demais para uma leitura. Desmarque algumas páginas e tente de novo.");
    const textoResposta = resposta.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    return normalizarLeitura(extrairJson(textoResposta), dados.length);
  } catch (e) {
    throw traduzirErro(e);
  }
}
