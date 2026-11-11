// Aplicação Express: API REST e arquivos estáticos. Não abre porta; quem faz isso é o index.js.
import express from "express";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { completarCarencias, lerArea, normFone, planPrices } from "../public/js/calculo.js";
import { ErroBackup, STATUS, tipoImagem } from "./db.js";
import { ErroLeitura, MODELO_PADRAO, lerTabela } from "./claude.js";
import { criarLogin } from "./login.js";
import { cacheDoArquivo, cacheDoEnvio, naoGuardar } from "./cache.js";
import { comprimir } from "./compressao.js";
import { conferirSenha, gerarHashSemTravar } from "./senhas.js";
import { criarEnviadorDeEmail } from "./email.js";
import { NIVEIS, TELAS, atende } from "./permissoes.js";
import { montarSnapshot, renderizarProposta } from "./proposta-html.js";
import { MAX_PLANOS_COMPARATIVO, renderizarComparativo } from "./comparativo-html.js";

const MAX_UPLOAD = 15 * 1024 * 1024;
// A tela já reduz a foto antes de enviar.
const MAX_FOTO = 2 * 1024 * 1024;

class ErroEntrada extends Error {}
class ErroNaoEncontrado extends Error {}

const textoOpc = (v, campo, max = 100_000) => {
  if (v == null) return "";
  if (typeof v !== "string") throw new ErroEntrada(`O campo ${campo} precisa ser um texto.`);
  if (v.length > max) throw new ErroEntrada(`O campo ${campo} é longo demais.`);
  return v.trim();
};

const numeroOpc = (v, campo) => {
  if (v == null || v === "") return null;
  if (typeof v !== "number" || !isFinite(v) || v < 0) throw new ErroEntrada(`O valor de ${campo} é inválido.`);
  return v;
};

const faixasOpc = (v, campo) => {
  if (v == null) return null;
  if (!Array.isArray(v) || v.length !== 10) throw new ErroEntrada(`A tabela de ${campo} precisa ter 10 faixas.`);
  return v.map((x) => numeroOpc(x, campo));
};

// Até 5 tabelas que valem a partir de um número de vidas, em ordem crescente.
function tabelasPorVidasOpc(v) {
  if (v == null) return null;
  if (!Array.isArray(v) || v.length > 5) throw new ErroEntrada("As tabelas por número de vidas são inválidas.");
  let anterior = 1;
  return v.map((t) => {
    const aPartirDe = t?.aPartirDe;
    if (!Number.isInteger(aPartirDe) || aPartirDe <= anterior || aPartirDe > 9999) throw new ErroEntrada("Cada tabela por número de vidas precisa começar num número de vidas maior que a anterior.");
    anterior = aPartirDe;
    const ate = t.ate == null ? undefined : t.ate;
    if (ate !== undefined && (!Number.isInteger(ate) || ate < aPartirDe || t !== v.at(-1))) throw new ErroEntrada("Só a última tabela por número de vidas pode ter limite, e ele não pode ser menor que o início dela.");
    return { aPartirDe, ...(ate !== undefined && { ate }), faixasEnf: faixasOpc(t.faixasEnf, `enfermaria a partir de ${aPartirDe} vidas`), faixasApto: faixasOpc(t.faixasApto, `apartamento a partir de ${aPartirDe} vidas`) };
  });
}

const vidasMinimasOpc = (v) => {
  if (v == null || v === "") return null;
  if (!Number.isInteger(v) || v < 1 || v > 9999) throw new ErroEntrada("O mínimo de vidas precisa ser um número inteiro.");
  return v === 1 ? null : v;
};

const corOpc = (v, campo) => {
  const c = textoOpc(v, campo, 7);
  if (c && !/^#[0-9a-f]{6}$/i.test(c)) throw new ErroEntrada(`A cor de ${campo} é inválida.`);
  return c;
};

const imagemOpc = (v, campo) => {
  const c = textoOpc(v, campo, 300);
  if (c && !/^(img|uploads)\/[\w.-]+$/.test(c)) throw new ErroEntrada(`O caminho da imagem de ${campo} é inválido.`);
  return c;
};

function areaOpc(v) {
  const area = textoOpc(v, "área de comercialização");
  const { invalidas } = lerArea(area);
  if (invalidas.length) {
    throw new ErroEntrada(`Área de comercialização: use uma linha por estado, como "MG: Uberlândia, Araguari". Corrija: ${invalidas[0].slice(0, 60)}`);
  }
  return area;
}

function validarPlano(b) {
  if (!b || typeof b !== "object") throw new ErroEntrada("Dados do plano inválidos.");
  const nome = textoOpc(b.nome, "nome", 200);
  if (!nome) throw new ErroEntrada("Dê um nome ao plano.");
  if (b.categoria !== "PF" && b.categoria !== "CNPJ") throw new ErroEntrada("O tipo do plano precisa ser PF ou CNPJ.");
  return {
    nome,
    categoria: b.categoria,
    subtitulo: textoOpc(b.subtitulo, "subtítulo", 300),
    ordem: Math.round(numeroOpc(b.ordem, "ordem") ?? 0),
    ativo: b.ativo !== false,
    faixasEnf: faixasOpc(b.faixasEnf, "enfermaria"),
    faixasApto: faixasOpc(b.faixasApto, "apartamento"),
    faixasEnfFamilia: faixasOpc(b.faixasEnfFamilia, "enfermaria com 3 ou mais vidas"),
    faixasAptoFamilia: faixasOpc(b.faixasAptoFamilia, "apartamento com 3 ou mais vidas"),
    tabelasPorVidas: tabelasPorVidasOpc(b.tabelasPorVidas),
    vidasMinimas: vidasMinimasOpc(b.vidasMinimas),
    enfermaria: numeroOpc(b.enfermaria, "enfermaria"),
    apartamento: numeroOpc(b.apartamento, "apartamento"),
    taxa: numeroOpc(b.taxa, "taxa associativa"),
    odonto: !!b.odonto,
    fidelidade: !!b.fidelidade,
    mostrarExtras: !!b.mostrarExtras,
    mostrarObservacao: !!b.mostrarObservacao,
    faixasModelo: b.faixasModelo === "3" ? "3" : "",
    cidade: textoOpc(b.cidade, "cidade", 200),
    areaComercializacao: areaOpc(b.areaComercializacao),
    rede: textoOpc(b.rede, "rede"),
    extras: textoOpc(b.extras, "benefícios"),
    descricao: textoOpc(b.descricao, "observação"),
    copartTexto: textoOpc(b.copartTexto, "coparticipação"),
    copartTabela: textoOpc(b.copartTabela, "tabela de coparticipação"),
    copartNota: textoOpc(b.copartNota, "observação da coparticipação"),
    carenciaTabela: completarCarencias(textoOpc(b.carenciaTabela, "tabela de carências")),
    carenciaNota: textoOpc(b.carenciaNota, "observação das carências"),
    imgCopart: imagemOpc(b.imgCopart, "coparticipação"),
    imgCarencia: imagemOpc(b.imgCarencia, "carências"),
    corPrimaria: corOpc(b.corPrimaria, "cor principal"),
    corEscura: corOpc(b.corEscura, "cor escura"),
  };
}

function validarCotacao(b) {
  if (!b || typeof b !== "object") throw new ErroEntrada("Dados da cotação inválidos.");
  const fone = normFone(b.fone);
  if (!textoOpc(b.cliente, "cliente", 200)) throw new ErroEntrada("Informe o nome do cliente para salvar no histórico.");
  if (fone.length < 10) throw new ErroEntrada("Informe o WhatsApp do cliente para salvar no histórico.");
  if (b.tipo !== "PF" && b.tipo !== "CNPJ") throw new ErroEntrada("O tipo da cotação precisa ser PF ou CNPJ.");
  if (!Array.isArray(b.vidas) || b.vidas.length !== 10 || !b.vidas.every((n) => Number.isInteger(n) && n >= 0)) {
    throw new ErroEntrada("As vidas da cotação são inválidas.");
  }
  if (!Array.isArray(b.planos) || !b.planos.length) throw new ErroEntrada("Escolha ao menos um plano.");
  const status = b.status ?? "Enviada";
  if (!STATUS.includes(status)) throw new ErroEntrada("Situação inválida.");
  return {
    fone,
    cliente: textoOpc(b.cliente, "cliente", 200),
    tipo: b.tipo,
    uf: textoOpc(b.uf, "estado", 2),
    municipio: textoOpc(b.municipio, "cidade", 200),
    idades: textoOpc(b.idades, "idades", 500),
    vidas: b.vidas,
    over: b.over && typeof b.over === "object" ? b.over : {},
    planos: b.planos.map((p) => ({ id: textoOpc(p?.id, "plano", 200), nome: textoOpc(p?.nome, "plano", 200), enf: numeroOpc(p?.enf, "enfermaria"), apto: numeroOpc(p?.apto, "apartamento") })),
    mensagem: textoOpc(b.mensagem, "mensagem"),
    status,
  };
}

function validarLogin(v) {
  const login = String(v ?? "").trim();
  if (!/^[\w.@-]{3,40}$/.test(login)) throw new ErroEntrada("O login precisa ter de 3 a 40 caracteres, sem espaços: letras, números, ponto, hífen ou arroba.");
  return login;
}

function validarSenha(v) {
  if (typeof v !== "string" || v.length < 8 || v.length > 200) throw new ErroEntrada("A senha precisa ter pelo menos 8 caracteres.");
  return v;
}

function validarEmail(v, podeVazio = false) {
  const email = String(v ?? "").trim().toLowerCase();
  if (!email && podeVazio) return "";
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErroEntrada("Informe um e-mail válido.");
  return email;
}

function validarPermissoes(v) {
  if (!v || typeof v !== "object") throw new ErroEntrada("As permissões informadas são inválidas.");
  return Object.fromEntries(TELAS.map((t) => {
    if (!NIVEIS.includes(v[t])) throw new ErroEntrada("As permissões informadas são inválidas.");
    return [t, v[t]];
  }));
}

function validarPerfil(v) {
  if (v !== "admin" && v !== "usuario") throw new ErroEntrada("O perfil precisa ser administrador ou usuário.");
  return v;
}

const carimbo = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
};

function validarPedidoDeLinks(b) {
  if (!b || typeof b !== "object") throw new ErroEntrada("Dados da proposta inválidos.");
  if (!Array.isArray(b.planos) || !b.planos.length) throw new ErroEntrada("Escolha ao menos um plano.");
  if (!Array.isArray(b.vidas) || b.vidas.length !== 10 || !b.vidas.every((n) => Number.isInteger(n) && n >= 0)) {
    throw new ErroEntrada("As vidas da cotação são inválidas.");
  }
  const over = {};
  for (const [id, o] of Object.entries(b.over && typeof b.over === "object" ? b.over : {})) {
    over[id] = {};
    if (o?.enf !== undefined) over[id].enf = numeroOpc(o.enf, "enfermaria");
    if (o?.apto !== undefined) over[id].apto = numeroOpc(o.apto, "apartamento");
    if (Number.isInteger(o?.carencia) && o.carencia > 0) over[id].carencia = o.carencia;
  }
  const o = b.opts ?? {};
  return {
    planos: b.planos, vidas: b.vidas, over, cliente: textoOpc(b.cliente, "cliente", 200), fone: normFone(b.fone),
    opts: { copart: o.copart !== false, rede: o.rede !== false, acom: o.acom !== false },
    municipio: textoOpc(b.municipio, "cidade", 200),
  };
}

export function criarApp({ banco, pastaPublica, pastaUploads, pastaBackups, env = process.env, exigirLogin = false, aceitarQualquerHost = false, sistema, clienteClaude, linkPublico = () => ({ estado: "indisponivel", url: null }), enviarEmail = criarEnviadorDeEmail(env) }) {
  const app = express();
  app.disable("x-powered-by");
  // Respostas comprimidas: a lista de planos tem centenas de KB de texto repetido (rede, área).
  app.use(comprimir());
  mkdirSync(pastaUploads, { recursive: true });

  // O banco guarda dados de clientes: fora deste computador, só a versão externa atende, e sempre com login.
  app.use((req, res, next) => {
    if (aceitarQualquerHost || ["localhost", "127.0.0.1"].includes(req.hostname)) return next();
    res.status(403).json({ erro: "Acesso permitido só neste computador." });
  });

  // Um link local só abriria no próprio servidor, então não serve para mandar por e-mail.
  const urlBase = () => { const l = linkPublico(); return l.estado === "ativo" && !l.local ? l.url : null; };
  const login = exigirLogin ? criarLogin(env, banco, { enviarEmail, urlBase }) : null;
  if (login) app.use(login);
  app.use("/api", naoGuardar);

  // Sem exigir login (só nos testes), a tela age como administrador com os dados gerais.
  const eAdmin = (req) => !req.usuario || req.usuario.perfil === "admin";
  const soAdmin = (req, res, next) => (eAdmin(req) ? next() : res.status(403).json({ erro: "Só o administrador pode fazer isso." }));
  // Permissão por tela: "ver" basta para consultar, e "editar" inclui consultar.
  const pode = (req, tela, minimo) => !req.usuario || atende(req.usuario.permissoes[tela], minimo);
  const exige = (tela, minimo) => (req, res, next) => (pode(req, tela, minimo) ? next() : res.status(403).json({ erro: "O seu usuário não tem permissão para fazer isso." }));
  const corretorDe = (req) => (req.usuario ? { nome: req.usuario.nome, fone: req.usuario.fone, empresa: req.usuario.empresa } : banco.lerConfig());
  // A proposta guarda de quem é, para o link do cliente chamar o WhatsApp do corretor certo.
  const corretorDaProposta = (req) => ({ ...corretorDe(req), usuarioId: req.usuario?.id });
  // Cada usuário vê só o que é dele; o administrador vê tudo, inclusive o que é de antes dos logins.
  const podeVer = (req, dono) => eAdmin(req) || dono === req.usuario.id;
  const responsavel = (dono) => {
    const u = dono ? banco.obterUsuario(dono) : null;
    return u ? u.nome || u.login : "";
  };
  const cotacaoVisivel = (req) => {
    const c = banco.obterCotacao(req.params.id);
    return c && podeVer(req, c.usuarioId) ? c : null;
  };
  const NAO_ACHOU_COTACAO = { erro: "Cotação não encontrada." };

  const chave = () => (env.ANTHROPIC_API_KEY || "").trim();
  const modelo = () => (env.ANTHROPIC_MODEL || "").trim() || MODELO_PADRAO;

  app.get("/api/status", (_req, res) => {
    res.json({ app: "cotador", leituraDisponivel: !!chave() || !!clienteClaude, modelo: modelo(), linkPublico: linkPublico() });
  });

  app.post("/api/ler-tabela", exige("planos", "editar"), express.json({ limit: "160mb" }), async (req, res) => {
    const b = req.body ?? {};
    const resultado = await lerTabela(
      { nome: b.nome, subtitulo: b.subtitulo, imagens: b.imagens },
      { apiKey: chave(), modelo: modelo(), cliente: clienteClaude },
    );
    res.json(resultado);
  });

  app.post("/api/uploads", exige("planos", "editar"), express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: MAX_UPLOAD }), (req, res) => {
    const dados = req.body;
    const ext = Buffer.isBuffer(dados) ? tipoImagem(dados) : null;
    if (!ext) throw new ErroEntrada("Envie uma imagem PNG, JPG ou WebP.");
    const nome = `${randomUUID()}.${ext}`;
    writeFileSync(join(pastaUploads, nome), dados);
    res.status(201).json({ caminho: `uploads/${nome}` });
  });

  app.post("/api/restaurar", soAdmin, express.raw({ type: "application/octet-stream", limit: "2gb" }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new ErroEntrada("Escolha um arquivo de backup.");
    mkdirSync(pastaBackups, { recursive: true });
    banco.restaurar(req.body, join(pastaBackups, `cotador-antes-de-restaurar-${carimbo()}.db`), pastaUploads);
    res.json({ ok: true });
  });

  app.use("/api", express.json({ limit: "4mb" }));

  /* ---------- planos ---------- */
  // A cotação e os documentos também dependem da lista de planos.
  app.get("/api/planos", (req, res) => {
    if (!["cotacao", "planos", "documentos"].some((t) => pode(req, t, "ver"))) return res.status(403).json({ erro: "O seu usuário não tem permissão para fazer isso." });
    // Sem dados de clientes: o navegador guarda e confere com o servidor, que responde 304 quando nada mudou.
    res.setHeader("Cache-Control", "private, no-cache");
    res.json(banco.listarPlanos());
  });

  app.post("/api/planos", exige("planos", "editar"), (req, res) => res.status(201).json(banco.criarPlano(validarPlano(req.body))));

  app.put("/api/planos/:id", exige("planos", "editar"), (req, res) => {
    if (!banco.obterPlano(req.params.id)) return res.status(404).json({ erro: "Plano não encontrado." });
    res.json(banco.gravarPlano(req.params.id, validarPlano(req.body)));
  });

  app.delete("/api/planos/:id", exige("planos", "editar"), (req, res) => {
    if (!banco.excluirPlano(req.params.id)) return res.status(404).json({ erro: "Plano não encontrado." });
    res.status(204).end();
  });

  /* ---------- cotações ---------- */
  app.get("/api/cotacoes", exige("historico", "ver"), (req, res) => {
    const { fone, q, status } = req.query;
    const lista = banco.listarCotacoes({
      fone: typeof fone === "string" ? normFone(fone) : "",
      q: typeof q === "string" ? q : "",
      status: typeof status === "string" ? status : "",
      usuarioId: eAdmin(req) ? undefined : req.usuario.id,
    });
    res.json(eAdmin(req) ? lista.map((c) => ({ ...c, responsavel: responsavel(c.usuarioId) })) : lista);
  });

  app.post("/api/cotacoes", exige("cotacao", "editar"), (req, res) => {
    // O dono vem do login, nunca do que a tela envia.
    const { cotacao, duplicada } = banco.salvarCotacao({ ...validarCotacao(req.body), usuarioId: req.usuario?.id ?? "" });
    res.status(duplicada ? 200 : 201).json(cotacao);
  });

  app.put("/api/cotacoes/:id", exige("cotacao", "editar"), (req, res) => {
    if (!cotacaoVisivel(req)) return res.status(404).json(NAO_ACHOU_COTACAO);
    res.json(banco.atualizarCotacao(req.params.id, validarCotacao(req.body)));
  });

  app.patch("/api/cotacoes/:id", exige("historico", "editar"), (req, res) => {
    if (!STATUS.includes(req.body?.status)) throw new ErroEntrada("Situação inválida.");
    if (!cotacaoVisivel(req)) return res.status(404).json(NAO_ACHOU_COTACAO);
    res.json(banco.mudarStatus(req.params.id, req.body.status));
  });

  app.delete("/api/cotacoes/:id", exige("historico", "editar"), (req, res) => {
    if (!cotacaoVisivel(req) || !banco.excluirCotacao(req.params.id)) return res.status(404).json(NAO_ACHOU_COTACAO);
    res.status(204).end();
  });

  /* ---------- links públicos das propostas ---------- */
  // Todos os planos são conferidos antes de salvar qualquer coisa: o que não existe mais ou não aceita o tamanho
  // do grupo (ex.: Amil PME com 1 vida) é recusado, e nenhum link fica salvo pela metade.
  const planosDoPedido = (pedido) => pedido.planos.map((id) => {
    const plano = banco.obterPlano(String(id));
    if (!plano) throw new ErroEntrada("Um dos planos escolhidos não existe mais.");
    const v = planPrices(plano, pedido.vidas, pedido.over);
    if (v.minimo) throw new ErroEntrada(`${plano.nome} é para grupos a partir de ${v.minimo} vidas.`);
    if (v.maximo) throw new ErroEntrada(`${plano.nome} é para grupos de até ${v.maximo} vidas.`);
    return plano;
  });

  app.post("/api/propostas", exige("cotacao", "editar"), (req, res) => {
    const pedido = validarPedidoDeLinks(req.body);
    const { estado, url } = linkPublico();
    if (estado !== "ativo") return res.status(503).json({ erro: "Os links das propostas não estão disponíveis agora. Tente de novo em instantes.", codigo: "sem_link" });
    const corretor = corretorDaProposta(req);
    const links = planosDoPedido(pedido).map((plano) => {
      const token = banco.salvarProposta(montarSnapshot(plano, pedido, corretor), pedido.fone);
      return { id: plano.id, nome: plano.nome, url: `${url}/p/${token}` };
    });
    res.status(201).json({ links });
  });

  // Página de cada plano para virar imagem: nada fica salvo.
  app.post("/api/propostas/previa", exige("cotacao", "ver"), (req, res) => {
    const pedido = validarPedidoDeLinks(req.body);
    const corretor = corretorDe(req);
    res.json({
      paginas: planosDoPedido(pedido).map((plano) => ({ id: plano.id, html: renderizarProposta(montarSnapshot(plano, pedido, corretor), {}, { paraImagem: true }) })),
    });
  });

  // Vários planos lado a lado para virar imagem: nada fica salvo.
  app.post("/api/propostas/comparativo", exige("cotacao", "editar"), (req, res) => {
    const pedido = validarPedidoDeLinks(req.body);
    if (pedido.planos.length < 2 || pedido.planos.length > MAX_PLANOS_COMPARATIVO) {
      throw new ErroEntrada(`Escolha de 2 a ${MAX_PLANOS_COMPARATIVO} planos para comparar.`);
    }
    const corretor = corretorDe(req);
    const snapshots = planosDoPedido(pedido).map((plano) => montarSnapshot(plano, pedido, corretor));
    res.json({ html: renderizarComparativo(snapshots) });
  });

  /* ---------- atualização do sistema ---------- */
  if (sistema) {
    app.get("/api/sistema/versao", soAdmin, async (_req, res) => res.json(await sistema.versao()));
    app.post("/api/sistema/atualizar", soAdmin, async (_req, res) => {
      try {
        res.json(await sistema.atualizar());
      } catch (e) {
        console.error(e);
        res.status(500).json({ erro: "O GitHub não aceitou a atualização. Veja a janela do cotador no servidor." });
      }
    });
  }

  /* ---------- aceites ---------- */
  const donoDaProposta = (p) => p.dados.corretor?.usuarioId ?? "";
  app.get("/api/aceites", exige("aceites", "ver"), (req, res) => {
    res.json(banco.listarAceites().filter((a) => podeVer(req, donoDaProposta(a))).map((a) => {
      // A lista de documentos sai assinada pelo corretor da proposta, mesmo quando o administrador envia.
      const dono = donoDaProposta(a) ? banco.obterUsuario(donoDaProposta(a)) : null;
      return {
        token: a.token, fone: a.fone, cliente: a.dados.cliente, plano: a.dados.plano.nome, categoria: a.dados.plano.categoria,
        acomodacao: a.acomodacao, valor: a.valor, aceitoEm: a.aceitoEm, docsEnviadosEm: a.docsEnviadosEm,
        documentos: banco.documentosDaProposta(a.dados),
        corretor: dono ? { nome: dono.nome, fone: dono.fone, empresa: dono.empresa } : donoDaProposta(a) ? a.dados.corretor : null,
        ...(eAdmin(req) ? { responsavel: responsavel(donoDaProposta(a)) } : {}),
      };
    }));
  });

  app.post("/api/aceites/:token/documentos", exige("aceites", "editar"), (req, res) => {
    const proposta = banco.obterProposta(req.params.token);
    if (!proposta || !podeVer(req, donoDaProposta(proposta))) return res.status(404).json({ erro: "Aceite não encontrado." });
    const a = banco.marcarDocumentosEnviados(req.params.token);
    if (!a) return res.status(404).json({ erro: "Aceite não encontrado." });
    res.json({ docsEnviadosEm: a.docsEnviadosEm });
  });

  // Excluir apaga a proposta aceita: o link dela deixa de abrir, e a cotação continua no histórico.
  app.delete("/api/aceites/:token", exige("aceites", "editar"), (req, res) => {
    const proposta = banco.obterProposta(req.params.token);
    if (!proposta || !proposta.aceitoEm || !podeVer(req, donoDaProposta(proposta))) return res.status(404).json({ erro: "Aceite não encontrado." });
    banco.excluirAceite(req.params.token);
    res.status(204).end();
  });

  /* ---------- documentos por plano ---------- */
  const documentoDaRota = (req) => {
    const id = Number(req.params.id);
    const documento = Number.isInteger(id) ? banco.obterDocumento(id) : null;
    if (!documento) throw new ErroNaoEncontrado("Documento não encontrado.");
    return documento;
  };
  const NOME_DO_TIPO = { PF: "pessoa física", CNPJ: "CNPJ" };
  const nomeDeDocumento = (b, tipo, idAtual) => {
    const nome = textoOpc(b?.nome, "documento", 300);
    if (!nome) throw new ErroEntrada("Escreva o nome do documento.");
    const existente = banco.documentoComNome(nome, tipo);
    if (existente != null && existente !== idAtual) throw new ErroEntrada(`Já existe um documento de ${NOME_DO_TIPO[tipo]} com esse nome.`);
    return nome;
  };

  app.get("/api/documentos", exige("documentos", "ver"), (_req, res) => res.json(banco.listarDocumentos()));

  app.post("/api/documentos", exige("documentos", "editar"), (req, res) => {
    // O documento vale para todos os planos do tipo; sem tipo informado, é de pessoa física.
    const tipo = req.body?.tipo ?? "PF";
    if (tipo !== "PF" && tipo !== "CNPJ") throw new ErroEntrada("O tipo do documento precisa ser PF ou CNPJ.");
    res.status(201).json(banco.criarDocumento(nomeDeDocumento(req.body, tipo), tipo));
  });

  app.put("/api/documentos/:id", exige("documentos", "editar"), (req, res) => {
    const d = documentoDaRota(req);
    res.json(banco.renomearDocumento(d.id, nomeDeDocumento(req.body, d.tipo, d.id)));
  });

  app.delete("/api/documentos/:id", exige("documentos", "editar"), (req, res) => {
    banco.excluirDocumento(documentoDaRota(req).id);
    res.status(204).end();
  });

  /* ---------- configuração e backup ---------- */
  // Nome, telefone e corretora são de cada login e vão nas propostas que ele gera.
  app.get("/api/config", (req, res) => res.json(corretorDe(req)));

  app.put("/api/config", (req, res) => {
    const b = req.body ?? {};
    const dados = {
      nome: b.nome === undefined ? undefined : textoOpc(b.nome, "nome", 200),
      fone: b.fone === undefined ? undefined : textoOpc(b.fone, "telefone", 50),
      empresa: b.empresa === undefined ? undefined : textoOpc(b.empresa, "corretora", 200),
    };
    if (!req.usuario) return res.json(banco.gravarConfig(dados));
    if (b.email !== undefined) dados.email = emailLivre(b.email, req.usuario.id, true);
    const { nome, fone, empresa } = banco.atualizarDadosDoUsuario(req.usuario.id, dados);
    res.json({ nome, fone, empresa });
  });

  /* ---------- usuários ---------- */
  app.get("/api/eu", (req, res) => {
    if (!req.usuario) return res.json({ id: null, login: "", perfil: "admin", ...banco.lerConfig() });
    res.json(req.usuario);
  });

  // A foto fica junto das outras imagens enviadas; o nome vem sempre do servidor.
  const apagarFoto = (foto) => {
    if (foto) rmSync(join(pastaUploads, basename(foto)), { force: true });
  };
  app.post("/api/eu/foto", express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: MAX_FOTO }), (req, res) => {
    if (!req.usuario) throw new ErroEntrada("Entre com o seu login para escolher uma foto.");
    const dados = req.body;
    const ext = Buffer.isBuffer(dados) ? tipoImagem(dados) : null;
    if (!ext) throw new ErroEntrada("Envie uma imagem PNG, JPG ou WebP.");
    const nome = `foto-${randomUUID()}.${ext}`;
    writeFileSync(join(pastaUploads, nome), dados);
    apagarFoto(req.usuario.foto);
    const { foto } = banco.atualizarDadosDoUsuario(req.usuario.id, { foto: `uploads/${nome}` });
    res.status(201).json({ foto });
  });
  app.delete("/api/eu/foto", (req, res) => {
    if (!req.usuario) throw new ErroEntrada("Entre com o seu login para remover a foto.");
    apagarFoto(req.usuario.foto);
    banco.atualizarDadosDoUsuario(req.usuario.id, { foto: "" });
    res.status(204).end();
  });

  app.put("/api/eu/senha", async (req, res) => {
    if (!req.usuario) throw new ErroEntrada("Entre com o seu login para alterar a senha.");
    const hashAtual = banco.lerHashDaSenha(req.usuario.id);
    if (!conferirSenha(req.body?.atual ?? "", hashAtual)) throw new ErroEntrada("A senha atual está incorreta.");
    const hash = await gerarHashSemTravar(validarSenha(req.body?.nova));
    banco.alterarSenhaDoUsuario(req.usuario.id, hash);
    login.manterSessao(req.tokenDaSessao, hash);
    res.json({ ok: true });
  });

  const emailLivre = (v, idAtual = null, podeVazio = false) => {
    const email = validarEmail(v, podeVazio);
    const dono = banco.obterUsuarioPorEmail(email);
    if (dono && dono.id !== idAtual) throw new ErroEntrada("Já existe um usuário com este e-mail.");
    return email;
  };

  app.get("/api/usuarios", soAdmin, (_req, res) => res.json(banco.listarUsuarios()));

  app.post("/api/usuarios", soAdmin, async (req, res) => {
    const b = req.body ?? {};
    const novoLogin = validarLogin(b.login);
    const loginLivre = () => { if (banco.obterUsuarioPorLogin(novoLogin)) throw new ErroEntrada("Já existe um usuário com este login."); };
    loginLivre();
    emailLivre(b.email);
    const perfil = b.perfil === undefined ? "usuario" : validarPerfil(b.perfil);
    const permissoes = b.permissoes === undefined ? undefined : validarPermissoes(b.permissoes);
    const senhaHash = await gerarHashSemTravar(validarSenha(b.senha));
    // Outro pedido pode ter usado o mesmo login ou e-mail enquanto a senha era calculada.
    loginLivre();
    const email = emailLivre(b.email);
    res.status(201).json(banco.criarUsuario({ login: novoLogin, email, senhaHash, perfil, permissoes }));
  });

  app.put("/api/usuarios/:id", soAdmin, async (req, res) => {
    const b = req.body ?? {};
    // O cálculo da senha vem antes das conferências, que assim olham o banco já atualizado.
    const hash = b.senha === undefined ? undefined : await gerarHashSemTravar(validarSenha(b.senha));
    const alvo = banco.obterUsuario(req.params.id);
    if (!alvo) throw new ErroNaoEncontrado("Usuário não encontrado.");
    const perfil = b.perfil === undefined ? undefined : validarPerfil(b.perfil);
    const ativo = b.ativo === undefined ? undefined : !!b.ativo;
    const perdeAdmin = alvo.perfil === "admin" && alvo.ativo && ((perfil && perfil !== "admin") || ativo === false);
    if (perdeAdmin && req.usuario?.id === alvo.id) throw new ErroEntrada("Você não pode tirar o seu próprio acesso de administrador.");
    if (perdeAdmin && banco.contarAdminsAtivos() <= 1) throw new ErroEntrada("O sistema precisa de pelo menos um administrador ativo.");
    // Valida tudo antes de gravar, para um erro não deixar a alteração pela metade.
    const email = b.email === undefined ? undefined : emailLivre(b.email, alvo.id);
    const permissoes = b.permissoes === undefined ? undefined : validarPermissoes(b.permissoes);
    if (hash !== undefined) {
      banco.alterarSenhaDoUsuario(alvo.id, hash);
      if (req.usuario?.id === alvo.id) login.manterSessao(req.tokenDaSessao, hash);
    }
    if (email !== undefined) banco.atualizarDadosDoUsuario(alvo.id, { email });
    res.json(banco.alterarAcessoDoUsuario(alvo.id, { perfil, ativo, permissoes }));
  });

  app.delete("/api/usuarios/:id", soAdmin, (req, res) => {
    const alvo = banco.obterUsuario(req.params.id);
    if (!alvo) throw new ErroNaoEncontrado("Usuário não encontrado.");
    if (req.usuario?.id === alvo.id) throw new ErroEntrada("Você não pode excluir o seu próprio usuário.");
    if (alvo.perfil === "admin" && alvo.ativo && banco.contarAdminsAtivos() <= 1) throw new ErroEntrada("O sistema precisa de pelo menos um administrador ativo.");
    banco.excluirUsuario(alvo.id);
    apagarFoto(alvo.foto);
    res.status(204).end();
  });

  app.get("/api/backup", soAdmin, (_req, res) => {
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="cotador-${carimbo()}.db"`);
    res.send(banco.gerarBackup(pastaUploads));
  });

  app.use("/api", (_req, res) => res.status(404).json({ erro: "Rota não encontrada." }));

  app.use("/uploads", express.static(pastaUploads, { fallthrough: false, setHeaders: cacheDoEnvio() }));
  app.use(express.static(pastaPublica, { setHeaders: cacheDoArquivo }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ErroEntrada || err instanceof ErroBackup) return res.status(400).json({ erro: err.message });
    if (err instanceof ErroNaoEncontrado) return res.status(404).json({ erro: err.message });
    if (err instanceof ErroLeitura) return res.status(err.status).json({ erro: err.message, codigo: err.codigo });
    if (err.type === "entity.too.large") return res.status(413).json({ erro: "O arquivo enviado é grande demais." });
    if (err.type === "entity.parse.failed") return res.status(400).json({ erro: "Os dados enviados são inválidos." });
    if (err.status === 404) return res.status(404).json({ erro: "Arquivo não encontrado." });
    console.error(err);
    res.status(500).json({ erro: "Erro inesperado no cotador. Tente de novo." });
  });

  return app;
}
