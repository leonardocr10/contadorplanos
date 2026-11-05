// Aplicação Express: API REST e arquivos estáticos. Não abre porta; quem faz isso é o index.js.
import express from "express";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lerArea, normFone } from "../public/js/calculo.js";
import { ErroBackup, STATUS } from "./db.js";
import { ErroLeitura, MODELO_PADRAO, lerTabela } from "./claude.js";
import { criarLogin } from "./login.js";
import { montarSnapshot, renderizarProposta } from "./proposta-html.js";
import { MAX_PLANOS_COMPARATIVO, renderizarComparativo } from "./comparativo-html.js";

const MAX_UPLOAD = 15 * 1024 * 1024;

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
    carenciaTabela: textoOpc(b.carenciaTabela, "tabela de carências"),
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
    idades: textoOpc(b.idades, "idades", 500),
    vidas: b.vidas,
    over: b.over && typeof b.over === "object" ? b.over : {},
    planos: b.planos.map((p) => ({ id: textoOpc(p?.id, "plano", 200), nome: textoOpc(p?.nome, "plano", 200), enf: numeroOpc(p?.enf, "enfermaria"), apto: numeroOpc(p?.apto, "apartamento") })),
    mensagem: textoOpc(b.mensagem, "mensagem"),
    status,
  };
}

function tipoImagem(b) {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
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
  }
  const o = b.opts ?? {};
  return {
    planos: b.planos, vidas: b.vidas, over, cliente: textoOpc(b.cliente, "cliente", 200), fone: normFone(b.fone),
    opts: { copart: o.copart !== false, rede: o.rede !== false, acom: o.acom !== false },
    municipio: textoOpc(b.municipio, "cidade", 200),
  };
}

export function criarApp({ banco, pastaPublica, pastaUploads, pastaBackups, env = process.env, exigirLogin = false, aceitarQualquerHost = false, sistema, clienteClaude, linkPublico = () => ({ estado: "indisponivel", url: null }) }) {
  const app = express();
  app.disable("x-powered-by");
  mkdirSync(pastaUploads, { recursive: true });

  // O banco guarda dados de clientes: fora deste computador, só a versão externa atende, e sempre com login.
  app.use((req, res, next) => {
    if (aceitarQualquerHost || ["localhost", "127.0.0.1"].includes(req.hostname)) return next();
    res.status(403).json({ erro: "Acesso permitido só neste computador." });
  });

  if (exigirLogin) app.use(criarLogin(env));

  const chave = () => (env.ANTHROPIC_API_KEY || "").trim();
  const modelo = () => (env.ANTHROPIC_MODEL || "").trim() || MODELO_PADRAO;

  app.get("/api/status", (_req, res) => {
    res.json({ app: "cotador", leituraDisponivel: !!chave() || !!clienteClaude, modelo: modelo(), linkPublico: linkPublico() });
  });

  app.post("/api/ler-tabela", express.json({ limit: "160mb" }), async (req, res) => {
    const b = req.body ?? {};
    const resultado = await lerTabela(
      { nome: b.nome, subtitulo: b.subtitulo, imagens: b.imagens },
      { apiKey: chave(), modelo: modelo(), cliente: clienteClaude },
    );
    res.json(resultado);
  });

  app.post("/api/uploads", express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: MAX_UPLOAD }), (req, res) => {
    const dados = req.body;
    const ext = Buffer.isBuffer(dados) ? tipoImagem(dados) : null;
    if (!ext) throw new ErroEntrada("Envie uma imagem PNG, JPG ou WebP.");
    const nome = `${randomUUID()}.${ext}`;
    writeFileSync(join(pastaUploads, nome), dados);
    res.status(201).json({ caminho: `uploads/${nome}` });
  });

  app.post("/api/restaurar", express.raw({ type: "application/octet-stream", limit: "500mb" }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new ErroEntrada("Escolha um arquivo de backup.");
    mkdirSync(pastaBackups, { recursive: true });
    banco.restaurar(req.body, join(pastaBackups, `cotador-antes-de-restaurar-${carimbo()}.db`));
    res.json({ ok: true });
  });

  app.use("/api", express.json({ limit: "4mb" }));

  /* ---------- planos ---------- */
  app.get("/api/planos", (_req, res) => res.json(banco.listarPlanos()));

  app.post("/api/planos", (req, res) => res.status(201).json(banco.criarPlano(validarPlano(req.body))));

  app.put("/api/planos/:id", (req, res) => {
    if (!banco.obterPlano(req.params.id)) return res.status(404).json({ erro: "Plano não encontrado." });
    res.json(banco.gravarPlano(req.params.id, validarPlano(req.body)));
  });

  app.delete("/api/planos/:id", (req, res) => {
    if (!banco.excluirPlano(req.params.id)) return res.status(404).json({ erro: "Plano não encontrado." });
    res.status(204).end();
  });

  /* ---------- cotações ---------- */
  app.get("/api/cotacoes", (req, res) => {
    const { fone, q, status } = req.query;
    res.json(banco.listarCotacoes({
      fone: typeof fone === "string" ? normFone(fone) : "",
      q: typeof q === "string" ? q : "",
      status: typeof status === "string" ? status : "",
    }));
  });

  app.post("/api/cotacoes", (req, res) => {
    const { cotacao, duplicada } = banco.salvarCotacao(validarCotacao(req.body));
    res.status(duplicada ? 200 : 201).json(cotacao);
  });

  app.patch("/api/cotacoes/:id", (req, res) => {
    if (!STATUS.includes(req.body?.status)) throw new ErroEntrada("Situação inválida.");
    const c = banco.mudarStatus(req.params.id, req.body.status);
    if (!c) return res.status(404).json({ erro: "Cotação não encontrada." });
    res.json(c);
  });

  app.delete("/api/cotacoes/:id", (req, res) => {
    if (!banco.excluirCotacao(req.params.id)) return res.status(404).json({ erro: "Cotação não encontrada." });
    res.status(204).end();
  });

  /* ---------- links públicos das propostas ---------- */
  app.post("/api/propostas", (req, res) => {
    const pedido = validarPedidoDeLinks(req.body);
    const { estado, url } = linkPublico();
    if (estado !== "ativo") return res.status(503).json({ erro: "Os links das propostas não estão disponíveis agora. Tente de novo em instantes.", codigo: "sem_link" });
    const corretor = banco.lerConfig();
    const links = pedido.planos.map((id) => {
      const plano = banco.obterPlano(String(id));
      if (!plano) throw new ErroEntrada("Um dos planos escolhidos não existe mais.");
      const token = banco.salvarProposta(montarSnapshot(plano, pedido, corretor), pedido.fone);
      return { id: plano.id, nome: plano.nome, url: `${url}/p/${token}` };
    });
    res.status(201).json({ links });
  });

  // Página de cada plano para virar imagem: nada fica salvo.
  app.post("/api/propostas/previa", (req, res) => {
    const pedido = validarPedidoDeLinks(req.body);
    const corretor = banco.lerConfig();
    res.json({
      paginas: pedido.planos.map((id) => {
        const plano = banco.obterPlano(String(id));
        if (!plano) throw new ErroEntrada("Um dos planos escolhidos não existe mais.");
        return { id: plano.id, html: renderizarProposta(montarSnapshot(plano, pedido, corretor), {}, { paraImagem: true }) };
      }),
    });
  });

  // Vários planos lado a lado para virar imagem: nada fica salvo.
  app.post("/api/propostas/comparativo", (req, res) => {
    const pedido = validarPedidoDeLinks(req.body);
    if (pedido.planos.length < 2 || pedido.planos.length > MAX_PLANOS_COMPARATIVO) {
      throw new ErroEntrada(`Escolha de 2 a ${MAX_PLANOS_COMPARATIVO} planos para comparar.`);
    }
    const corretor = banco.lerConfig();
    const snapshots = pedido.planos.map((id) => {
      const plano = banco.obterPlano(String(id));
      if (!plano) throw new ErroEntrada("Um dos planos escolhidos não existe mais.");
      return montarSnapshot(plano, pedido, corretor);
    });
    res.json({ html: renderizarComparativo(snapshots) });
  });

  /* ---------- atualização do sistema ---------- */
  if (sistema) {
    app.get("/api/sistema/versao", async (_req, res) => res.json(await sistema.versao()));
    app.post("/api/sistema/atualizar", async (_req, res) => {
      try {
        res.json(await sistema.atualizar());
      } catch (e) {
        console.error(e);
        res.status(500).json({ erro: "O GitHub não aceitou a atualização. Veja a janela do cotador no servidor." });
      }
    });
  }

  /* ---------- aceites ---------- */
  app.get("/api/aceites", (_req, res) => {
    res.json(banco.listarAceites().map((a) => ({
      token: a.token, fone: a.fone, cliente: a.dados.cliente, plano: a.dados.plano.nome, categoria: a.dados.plano.categoria,
      acomodacao: a.acomodacao, valor: a.valor, aceitoEm: a.aceitoEm, docsEnviadosEm: a.docsEnviadosEm,
      documentos: banco.documentosDaProposta(a.dados),
    })));
  });

  app.post("/api/aceites/:token/documentos", (req, res) => {
    const a = banco.marcarDocumentosEnviados(req.params.token);
    if (!a) return res.status(404).json({ erro: "Aceite não encontrado." });
    res.json({ docsEnviadosEm: a.docsEnviadosEm });
  });

  /* ---------- documentos por plano ---------- */
  const documentoDaRota = (req) => {
    const id = Number(req.params.id);
    const documento = Number.isInteger(id) ? banco.obterDocumento(id) : null;
    if (!documento) throw new ErroNaoEncontrado("Documento não encontrado.");
    return documento;
  };
  const nomeDeDocumento = (b, idAtual) => {
    const nome = textoOpc(b?.nome, "documento", 300);
    if (!nome) throw new ErroEntrada("Escreva o nome do documento.");
    const existente = banco.documentoComNome(nome);
    if (existente != null && existente !== idAtual) throw new ErroEntrada("Já existe um documento com esse nome.");
    return nome;
  };
  const ativoDoPedido = (b) => {
    if (typeof b?.ativo !== "boolean") throw new ErroEntrada("Informe se o documento fica ativo ou inativo.");
    return b.ativo;
  };

  app.get("/api/documentos", (_req, res) => res.json(banco.listarDocumentos()));

  app.post("/api/documentos", (req, res) => {
    const nome = nomeDeDocumento(req.body);
    const planoId = req.body?.planoId ? String(req.body.planoId) : null;
    if (planoId && !banco.obterPlano(planoId)) throw new ErroNaoEncontrado("Plano não encontrado.");
    res.status(201).json(banco.criarDocumento(nome, planoId));
  });

  app.put("/api/documentos/:id", (req, res) => {
    const d = documentoDaRota(req);
    res.json(banco.renomearDocumento(d.id, nomeDeDocumento(req.body, d.id)));
  });

  app.delete("/api/documentos/:id", (req, res) => {
    banco.excluirDocumento(documentoDaRota(req).id);
    res.status(204).end();
  });

  app.put("/api/documentos/:id/planos", (req, res) => {
    res.json(banco.definirDocumentoEmTodos(documentoDaRota(req).id, ativoDoPedido(req.body)));
  });

  app.put("/api/documentos/:id/planos/:planoId", (req, res) => {
    const d = documentoDaRota(req);
    if (!banco.obterPlano(req.params.planoId)) throw new ErroNaoEncontrado("Plano não encontrado.");
    res.json(banco.definirDocumentoNoPlano(d.id, req.params.planoId, ativoDoPedido(req.body)));
  });

  /* ---------- configuração e backup ---------- */
  app.get("/api/config", (_req, res) => res.json(banco.lerConfig()));

  app.put("/api/config", (req, res) => {
    const b = req.body ?? {};
    res.json(banco.gravarConfig({
      nome: b.nome === undefined ? undefined : textoOpc(b.nome, "nome", 200),
      fone: b.fone === undefined ? undefined : textoOpc(b.fone, "telefone", 50),
      empresa: b.empresa === undefined ? undefined : textoOpc(b.empresa, "corretora", 200),
    }));
  });

  app.get("/api/backup", (_req, res) => {
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="cotador-${carimbo()}.db"`);
    res.send(banco.gerarBackup());
  });

  app.use("/api", (_req, res) => res.status(404).json({ erro: "Rota não encontrada." }));

  app.use("/uploads", express.static(pastaUploads, { fallthrough: false }));
  app.use(express.static(pastaPublica));

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
