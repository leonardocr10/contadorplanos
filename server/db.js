// Banco local em node:sqlite: migrações versionadas, seed e acesso a planos, cotações e configuração.
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completarCarencias, redeDaCidade } from "../public/js/calculo.js";

export const STATUS = ["Enviada", "Em Negociação", "Vendida", "Negativa"];

const MIGRACOES = [
  `CREATE TABLE planos (
     id TEXT PRIMARY KEY,
     nome TEXT NOT NULL,
     subtitulo TEXT NOT NULL DEFAULT '',
     categoria TEXT NOT NULL CHECK (categoria IN ('PF','CNPJ')),
     ordem INTEGER NOT NULL DEFAULT 0,
     ativo INTEGER NOT NULL DEFAULT 1,
     faixas_enf TEXT,
     faixas_apto TEXT,
     enfermaria REAL,
     apartamento REAL,
     taxa REAL,
     odonto INTEGER NOT NULL DEFAULT 0,
     fidelidade INTEGER NOT NULL DEFAULT 0,
     cidade TEXT NOT NULL DEFAULT '',
     rede TEXT NOT NULL DEFAULT '',
     extras TEXT NOT NULL DEFAULT '',
     mostrar_extras INTEGER NOT NULL DEFAULT 0,
     descricao TEXT NOT NULL DEFAULT '',
     copart_texto TEXT NOT NULL DEFAULT '',
     copart_tabela TEXT NOT NULL DEFAULT '',
     copart_nota TEXT NOT NULL DEFAULT '',
     carencia_tabela TEXT NOT NULL DEFAULT '',
     carencia_nota TEXT NOT NULL DEFAULT '',
     img_copart TEXT NOT NULL DEFAULT '',
     img_carencia TEXT NOT NULL DEFAULT '',
     cor_primaria TEXT NOT NULL DEFAULT '',
     cor_escura TEXT NOT NULL DEFAULT '',
     atualizado_em TEXT NOT NULL
   );
   CREATE TABLE cotacoes (
     id TEXT PRIMARY KEY,
     fone TEXT NOT NULL,
     cliente TEXT NOT NULL DEFAULT '',
     criado_em TEXT NOT NULL,
     tipo TEXT NOT NULL,
     idades TEXT NOT NULL DEFAULT '',
     vidas TEXT NOT NULL,
     overrides TEXT NOT NULL DEFAULT '{}',
     planos TEXT NOT NULL,
     mensagem TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL DEFAULT 'Enviada'
   );
   CREATE INDEX idx_cotacoes_fone ON cotacoes (fone);
   CREATE TABLE config (
     chave TEXT PRIMARY KEY,
     valor TEXT NOT NULL DEFAULT ''
   );`,
  `CREATE TABLE propostas (
     token TEXT PRIMARY KEY,
     chave TEXT NOT NULL UNIQUE,
     dados TEXT NOT NULL,
     criado_em TEXT NOT NULL
   );`,
  `ALTER TABLE propostas ADD COLUMN fone TEXT NOT NULL DEFAULT '';
   ALTER TABLE propostas ADD COLUMN aceito_em TEXT;
   ALTER TABLE propostas ADD COLUMN acomodacao TEXT;
   ALTER TABLE propostas ADD COLUMN valor REAL;
   ALTER TABLE propostas ADD COLUMN docs_enviados_em TEXT;
   CREATE INDEX idx_propostas_aceito ON propostas (aceito_em);`,
  (db) => {
    db.exec(`CREATE TABLE documentos (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       nome TEXT NOT NULL UNIQUE COLLATE NOCASE
     );
     CREATE TABLE documentos_planos (
       documento_id INTEGER NOT NULL,
       plano_id TEXT NOT NULL,
       PRIMARY KEY (documento_id, plano_id)
     );`);
    // Converte as listas antigas de pessoa física e CNPJ, ativando cada documento nos planos do tipo.
    for (const [chave, categoria] of [["docsPf", "PF"], ["docsCnpj", "CNPJ"]]) {
      const valor = db.prepare("SELECT valor FROM config WHERE chave = ?").get(chave)?.valor ?? "";
      const planos = db.prepare("SELECT id FROM planos WHERE categoria = ?").all(categoria);
      for (const nome of valor.split("\n").map((x) => x.trim()).filter(Boolean)) {
        db.prepare("INSERT OR IGNORE INTO documentos (nome) VALUES (?)").run(nome);
        const { id } = db.prepare("SELECT id FROM documentos WHERE nome = ?").get(nome);
        for (const p of planos) db.prepare("INSERT OR IGNORE INTO documentos_planos (documento_id, plano_id) VALUES (?, ?)").run(id, p.id);
      }
    }
    db.exec("DELETE FROM config WHERE chave IN ('docsPf', 'docsCnpj')");
  },
  (db) => {
    const existe = db.prepare("PRAGMA table_info(planos)").all().some((c) => c.name === "mostrar_observacao");
    if (!existe) db.exec("ALTER TABLE planos ADD COLUMN mostrar_observacao INTEGER NOT NULL DEFAULT 0");
  },
  (db) => {
    const existe = db.prepare("PRAGMA table_info(planos)").all().some((c) => c.name === "faixas_modelo");
    if (!existe) db.exec("ALTER TABLE planos ADD COLUMN faixas_modelo TEXT NOT NULL DEFAULT ''");
  },
  // Sem mudança na estrutura: marca a chegada do PLAM TOTAL (ver PLANOS_NOVOS).
  () => {},
  "UPDATE planos SET fidelidade = 1 WHERE categoria = 'CNPJ'",
  "UPDATE cotacoes SET status = CASE status WHEN 'Em negociação' THEN 'Em Negociação' WHEN 'Fechou' THEN 'Vendida' WHEN 'Perdida' THEN 'Negativa' ELSE status END",
  (db) => {
    const colunas = db.prepare("PRAGMA table_info(planos)").all().map((c) => c.name);
    for (const c of ["faixas_enf_familia", "faixas_apto_familia"]) if (!colunas.includes(c)) db.exec(`ALTER TABLE planos ADD COLUMN ${c} TEXT`);
  },
  // Sem mudança na estrutura: marca os novos textos de coparticipação (ver atualizarTextosCoparticipacao).
  () => {},
  (db) => {
    const existe = db.prepare("PRAGMA table_info(planos)").all().some((c) => c.name === "area_comercializacao");
    if (!existe) db.exec("ALTER TABLE planos ADD COLUMN area_comercializacao TEXT NOT NULL DEFAULT ''");
  },
  // Sem mudança na estrutura: corrige a área e marca a rede por cidade (ver atualizarRedePorCidade).
  "UPDATE planos SET area_comercializacao = REPLACE(area_comercializacao, 'Timóteo Tiradentes', 'Timóteo, Tiradentes')",
  // Sem mudança na estrutura: marca a chegada da Aurora (ver PLANOS_NOVOS).
  () => {},
  (db) => {
    const colunas = db.prepare("PRAGMA table_info(cotacoes)").all().map((c) => c.name);
    for (const c of ["uf", "municipio"]) if (!colunas.includes(c)) db.exec(`ALTER TABLE cotacoes ADD COLUMN ${c} TEXT NOT NULL DEFAULT ''`);
  },
  (db) => {
    const atualizar = db.prepare("UPDATE planos SET carencia_tabela = ? WHERE id = ?");
    for (const p of db.prepare("SELECT id, carencia_tabela FROM planos").all()) {
      const completa = completarCarencias(p.carencia_tabela);
      if (completa !== p.carencia_tabela.trim()) atualizar.run(completa, p.id);
    }
  },
];

const VERSAO_TEXTOS_COPARTICIPACAO = 11;
const VERSAO_AREA_COMERCIALIZACAO = 12;
const VERSAO_REDE_POR_CIDADE = 13;

// Planos lançados depois que o banco já existia: entram uma única vez, ao atualizar.
const PLANOS_NOVOS = [{ id: "plamedh-basic-pme", versao: 6 }, { id: "plam-total-cnpj", versao: 7 }, ...["sulamerica-direto-nacional", "sulamerica-especial-100-rc", "sulamerica-especial-100-r1", "sulamerica-executivo-pleno"].map((id) => ({ id, versao: 10 })), { id: "aurora-saude-pf", versao: 14 }];

function migrar(db) {
  const versao = db.prepare("PRAGMA user_version").get().user_version;
  if (versao > MIGRACOES.length) {
    throw new Error("Este banco foi criado por uma versão mais nova do cotador.");
  }
  for (let v = versao; v < MIGRACOES.length; v++) {
    db.exec("BEGIN");
    try {
      if (typeof MIGRACOES[v] === "function") MIGRACOES[v](db);
      else db.exec(MIGRACOES[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}

const COLUNAS_PLANO = {
  nome: "nome", subtitulo: "subtitulo", categoria: "categoria", ordem: "ordem",
  enfermaria: "enfermaria", apartamento: "apartamento", taxa: "taxa", cidade: "cidade", rede: "rede", extras: "extras",
  descricao: "descricao", copartTexto: "copart_texto", copartTabela: "copart_tabela", copartNota: "copart_nota",
  carenciaTabela: "carencia_tabela", carenciaNota: "carencia_nota", imgCopart: "img_copart", imgCarencia: "img_carencia",
  corPrimaria: "cor_primaria", corEscura: "cor_escura", faixasModelo: "faixas_modelo", areaComercializacao: "area_comercializacao",
};
const COLUNAS_BOOL = { ativo: "ativo", odonto: "odonto", fidelidade: "fidelidade", mostrarExtras: "mostrar_extras", mostrarObservacao: "mostrar_observacao" };
const COLUNAS_JSON = { faixasEnf: "faixas_enf", faixasApto: "faixas_apto", faixasEnfFamilia: "faixas_enf_familia", faixasAptoFamilia: "faixas_apto_familia" };

function planoParaLinha(p) {
  const l = {};
  for (const [k, c] of Object.entries(COLUNAS_PLANO)) {
    l[c] = p[k] ?? (["enfermaria", "apartamento", "taxa"].includes(k) ? null : k === "ordem" ? 0 : "");
  }
  for (const [k, c] of Object.entries(COLUNAS_BOOL)) l[c] = (k === "ativo" ? p[k] !== false : !!p[k]) ? 1 : 0;
  for (const [k, c] of Object.entries(COLUNAS_JSON)) l[c] = Array.isArray(p[k]) ? JSON.stringify(p[k]) : null;
  return l;
}

function linhaParaPlano(l) {
  const p = { id: l.id, atualizadoEm: l.atualizado_em };
  for (const [k, c] of Object.entries(COLUNAS_PLANO)) p[k] = l[c];
  for (const [k, c] of Object.entries(COLUNAS_BOOL)) p[k] = !!l[c];
  for (const [k, c] of Object.entries(COLUNAS_JSON)) p[k] = l[c] ? JSON.parse(l[c]) : null;
  return p;
}

function linhaParaCotacao(l) {
  return {
    id: l.id, fone: l.fone, cliente: l.cliente, criadoEm: l.criado_em, tipo: l.tipo, uf: l.uf, municipio: l.municipio, idades: l.idades,
    vidas: JSON.parse(l.vidas), over: JSON.parse(l.overrides), planos: JSON.parse(l.planos), mensagem: l.mensagem, status: l.status,
  };
}

function linhaParaProposta(l) {
  return {
    token: l.token, dados: JSON.parse(l.dados), fone: l.fone, criadoEm: l.criado_em,
    aceitoEm: l.aceito_em, acomodacao: l.acomodacao, valor: l.valor, docsEnviadosEm: l.docs_enviados_em,
  };
}

export const slug = (s) =>
  String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "plano";

export class Banco {
  constructor(caminho, caminhoSeed) {
    this.caminho = caminho;
    this.caminhoSeed = caminhoSeed;
    this.abrir();
  }

  abrir() {
    this.db = new DatabaseSync(this.caminho);
    const versaoAntes = this.db.prepare("PRAGMA user_version").get().user_version;
    migrar(this.db);
    this.semear();
    this.incluirPlanosNovos(versaoAntes);
    this.atualizarTextosCoparticipacao(versaoAntes);
    this.preencherAreaComercializacao(versaoAntes);
    this.atualizarRedePorCidade(versaoAntes);
  }

  fechar() {
    this.db.close();
  }

  incluirPlanosNovos(versaoAntes) {
    const novos = PLANOS_NOVOS.filter((n) => versaoAntes > 0 && versaoAntes < n.versao);
    if (!novos.length || !this.caminhoSeed || !existsSync(this.caminhoSeed)) return;
    const planos = JSON.parse(readFileSync(this.caminhoSeed, "utf8"));
    for (const { id } of novos) {
      const p = planos.find((x) => x.id === id);
      if (p && !this.obterPlano(id)) this.gravarPlano(id, p);
    }
  }

  // O texto cita os valores da tabela: plano com a tabela editada fica como está, para não mostrar valor antigo.
  atualizarTextosCoparticipacao(versaoAntes) {
    if (versaoAntes === 0 || versaoAntes >= VERSAO_TEXTOS_COPARTICIPACAO) return;
    if (!this.caminhoSeed || !existsSync(this.caminhoSeed)) return;
    const atualizar = this.db.prepare("UPDATE planos SET copart_texto = ? WHERE id = ? AND TRIM(copart_tabela) = ?");
    for (const p of JSON.parse(readFileSync(this.caminhoSeed, "utf8"))) {
      atualizar.run(p.copartTexto ?? "", p.id, (p.copartTabela ?? "").trim());
    }
  }

  // Só preenche o que está vazio. Planos criados pela pessoa ficam sem área até ela informar.
  preencherAreaComercializacao(versaoAntes) {
    if (versaoAntes === 0 || versaoAntes >= VERSAO_AREA_COMERCIALIZACAO) return;
    if (!this.caminhoSeed || !existsSync(this.caminhoSeed)) return;
    const atualizar = this.db.prepare("UPDATE planos SET area_comercializacao = ? WHERE id = ? AND area_comercializacao = ''");
    for (const p of JSON.parse(readFileSync(this.caminhoSeed, "utf8"))) atualizar.run(p.areaComercializacao ?? "", p.id);
  }

  // Só troca a rede que continua igual à antiga, que era só a da cidade do plano. Rede editada fica como está.
  atualizarRedePorCidade(versaoAntes) {
    if (versaoAntes === 0 || versaoAntes >= VERSAO_REDE_POR_CIDADE) return;
    if (!this.caminhoSeed || !existsSync(this.caminhoSeed)) return;
    const atualizar = this.db.prepare("UPDATE planos SET rede = ? WHERE id = ? AND TRIM(rede) = ?");
    for (const p of JSON.parse(readFileSync(this.caminhoSeed, "utf8"))) {
      const antiga = redeDaCidade(p, p.cidade).join("\n");
      if (p.id.startsWith("sulamerica-") && antiga && antiga !== p.rede) atualizar.run(p.rede, p.id, antiga);
    }
  }

  semear() {
    if (!this.caminhoSeed || !existsSync(this.caminhoSeed)) return;
    if (this.db.prepare("SELECT COUNT(*) AS n FROM planos").get().n > 0) return;
    const planos = JSON.parse(readFileSync(this.caminhoSeed, "utf8"));
    this.db.exec("BEGIN");
    try {
      for (const p of planos) this.gravarPlano(p.id, p);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /* ---------- planos ---------- */
  listarPlanos() {
    return this.db.prepare("SELECT * FROM planos ORDER BY ordem, nome").all().map(linhaParaPlano);
  }

  obterPlano(id) {
    const l = this.db.prepare("SELECT * FROM planos WHERE id = ?").get(id);
    return l ? linhaParaPlano(l) : null;
  }

  gravarPlano(id, dados) {
    const l = { id, ...planoParaLinha(dados), atualizado_em: new Date().toISOString() };
    const cols = Object.keys(l);
    const update = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ");
    this.db
      .prepare(`INSERT INTO planos (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")}) ON CONFLICT (id) DO UPDATE SET ${update}`)
      .run(...cols.map((c) => l[c]));
    return this.obterPlano(id);
  }

  criarPlano(dados) {
    const base = slug(dados.nome);
    let id = base;
    for (let n = 2; this.obterPlano(id); n++) id = `${base}-${n}`;
    return this.gravarPlano(id, dados);
  }

  excluirPlano(id) {
    this.db.prepare("DELETE FROM documentos_planos WHERE plano_id = ?").run(id);
    return this.db.prepare("DELETE FROM planos WHERE id = ?").run(id).changes > 0;
  }

  /* ---------- documentos por plano ---------- */
  listarDocumentos() {
    const vinculos = this.db.prepare("SELECT documento_id, plano_id FROM documentos_planos").all();
    return this.db.prepare("SELECT id, nome FROM documentos ORDER BY id").all().map((d) => ({
      id: d.id, nome: d.nome, planos: vinculos.filter((v) => v.documento_id === d.id).map((v) => v.plano_id),
    }));
  }

  obterDocumento(id) {
    return this.listarDocumentos().find((d) => d.id === id) ?? null;
  }

  documentoComNome(nome) {
    return this.db.prepare("SELECT id FROM documentos WHERE nome = ?").get(nome)?.id ?? null;
  }

  criarDocumento(nome, planoId) {
    const id = Number(this.db.prepare("INSERT INTO documentos (nome) VALUES (?)").run(nome).lastInsertRowid);
    if (planoId) this.definirDocumentoNoPlano(id, planoId, true);
    return this.obterDocumento(id);
  }

  renomearDocumento(id, nome) {
    this.db.prepare("UPDATE documentos SET nome = ? WHERE id = ?").run(nome, id);
    return this.obterDocumento(id);
  }

  excluirDocumento(id) {
    this.db.prepare("DELETE FROM documentos_planos WHERE documento_id = ?").run(id);
    return this.db.prepare("DELETE FROM documentos WHERE id = ?").run(id).changes > 0;
  }

  definirDocumentoNoPlano(id, planoId, ativo) {
    const sql = ativo
      ? "INSERT OR IGNORE INTO documentos_planos (documento_id, plano_id) VALUES (?, ?)"
      : "DELETE FROM documentos_planos WHERE documento_id = ? AND plano_id = ?";
    this.db.prepare(sql).run(id, planoId);
    return this.obterDocumento(id);
  }

  definirDocumentoEmTodos(id, ativo) {
    this.db.prepare("DELETE FROM documentos_planos WHERE documento_id = ?").run(id);
    if (ativo) this.db.prepare("INSERT INTO documentos_planos (documento_id, plano_id) SELECT ?, id FROM planos").run(id);
    return this.obterDocumento(id);
  }

  documentosDoPlano(planoId) {
    return this.db
      .prepare("SELECT d.nome FROM documentos d JOIN documentos_planos v ON v.documento_id = d.id WHERE v.plano_id = ? ORDER BY d.id")
      .all(planoId)
      .map((d) => d.nome);
  }

  // Links criados antes dos documentos por plano guardam só o nome do plano.
  documentosDaProposta(dados) {
    const id = dados.plano.id ?? this.db.prepare("SELECT id FROM planos WHERE nome = ?").get(dados.plano.nome)?.id;
    return id ? this.documentosDoPlano(id) : [];
  }

  /* ---------- cotações ---------- */
  listarCotacoes({ fone = "", q = "", status = "" } = {}) {
    const where = [], args = [];
    if (fone) { where.push("fone = ?"); args.push(fone); }
    if (status) { where.push("status = ?"); args.push(status); }
    const sql = `SELECT * FROM cotacoes ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY criado_em DESC, id DESC`;
    let lista = this.db.prepare(sql).all(...args).map(linhaParaCotacao);
    const busca = q.trim().toLowerCase();
    if (busca) {
      const digitos = busca.replace(/\D/g, "");
      // LOWER do SQLite não trata acentos, então a busca por nome fica no JS.
      lista = lista.filter((c) => (digitos.length >= 3 && c.fone.includes(digitos)) || c.cliente.toLowerCase().includes(busca));
    }
    return lista;
  }

  obterCotacao(id) {
    const l = this.db.prepare("SELECT * FROM cotacoes WHERE id = ?").get(id);
    return l ? linhaParaCotacao(l) : null;
  }

  // Devolve a última cotação do número em vez de duplicar se nada mudou. Além da mensagem, compara vidas
  // e valores: a legenda padrão não cita valores, então cotações diferentes podem ter a mesma legenda.
  salvarCotacao(c) {
    const ultima = this.listarCotacoes({ fone: c.fone })[0];
    if (
      ultima && ultima.mensagem === c.mensagem && ultima.tipo === c.tipo && ultima.municipio === (c.municipio ?? "") &&
      JSON.stringify(ultima.vidas) === JSON.stringify(c.vidas) && JSON.stringify(ultima.planos) === JSON.stringify(c.planos)
    ) {
      return { cotacao: ultima, duplicada: true };
    }
    const id = "c" + randomUUID();
    this.db
      .prepare("INSERT INTO cotacoes (id, fone, cliente, criado_em, tipo, uf, municipio, idades, vidas, overrides, planos, mensagem, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, c.fone, c.cliente, new Date().toISOString(), c.tipo, c.uf ?? "", c.municipio ?? "", c.idades, JSON.stringify(c.vidas), JSON.stringify(c.over), JSON.stringify(c.planos), c.mensagem, c.status ?? "Enviada");
    return { cotacao: this.obterCotacao(id), duplicada: false };
  }

  mudarStatus(id, status) {
    return this.db.prepare("UPDATE cotacoes SET status = ? WHERE id = ?").run(status, id).changes > 0 ? this.obterCotacao(id) : null;
  }

  excluirCotacao(id) {
    return this.db.prepare("DELETE FROM cotacoes WHERE id = ?").run(id).changes > 0;
  }

  /* ---------- páginas públicas das propostas ---------- */
  // Guarda uma cópia da proposta: mudar o plano depois não altera o que o cliente já recebeu.
  // A mesma proposta para o mesmo número reaproveita o mesmo link. O número entra na chave para o aceite
  // de um cliente nunca aparecer em nome de outro com os mesmos dados.
  salvarProposta(dados, fone = "") {
    const json = JSON.stringify(dados);
    const chave = createHash("sha256").update(`${fone}\n${json}`).digest("hex");
    const existente = this.db.prepare("SELECT token FROM propostas WHERE chave = ?").get(chave);
    if (existente) return existente.token;
    const token = randomBytes(16).toString("base64url");
    this.db.prepare("INSERT INTO propostas (token, chave, dados, criado_em, fone) VALUES (?, ?, ?, ?, ?)").run(token, chave, json, new Date().toISOString(), fone);
    return token;
  }

  obterProposta(token) {
    const l = this.db.prepare("SELECT * FROM propostas WHERE token = ?").get(token);
    return l ? linhaParaProposta(l) : null;
  }

  // Só o primeiro aceite vale: repetir o envio do formulário não muda a escolha já registrada.
  aceitarProposta(token, acomodacao, valor) {
    this.db
      .prepare("UPDATE propostas SET aceito_em = ?, acomodacao = ?, valor = ? WHERE token = ? AND aceito_em IS NULL")
      .run(new Date().toISOString(), acomodacao, valor, token);
    return this.obterProposta(token);
  }

  listarAceites() {
    return this.db.prepare("SELECT * FROM propostas WHERE aceito_em IS NOT NULL ORDER BY aceito_em DESC").all().map(linhaParaProposta);
  }

  marcarDocumentosEnviados(token) {
    const r = this.db.prepare("UPDATE propostas SET docs_enviados_em = ? WHERE token = ? AND aceito_em IS NOT NULL").run(new Date().toISOString(), token);
    return r.changes > 0 ? this.obterProposta(token) : null;
  }

  /* ---------- configuração ---------- */
  lerConfig() {
    const cfg = { nome: "", fone: "", empresa: "" };
    for (const { chave, valor } of this.db.prepare("SELECT chave, valor FROM config").all()) cfg[chave] = valor;
    return cfg;
  }

  gravarConfig(cfg) {
    const st = this.db.prepare("INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor");
    for (const k of ["nome", "fone", "empresa"]) if (cfg[k] !== undefined) st.run(k, cfg[k]);
    return this.lerConfig();
  }

  /* ---------- backup ---------- */
  // VACUUM INTO gera uma cópia consistente do banco, mesmo com o servidor em uso.
  gerarBackup() {
    const destino = join(tmpdir(), `cotador-backup-${randomUUID()}.db`);
    this.db.prepare("VACUUM INTO ?").run(destino);
    const dados = readFileSync(destino);
    rmSync(destino, { force: true });
    return dados;
  }

  // Valida o arquivo numa cópia temporária antes de trocar o banco em uso.
  restaurar(dados, caminhoCopiaSeguranca) {
    if (dados.subarray(0, 16).toString("latin1") !== "SQLite format 3\0") {
      throw new ErroBackup("Este arquivo não é um backup do cotador.");
    }
    const temporario = join(tmpdir(), `cotador-restaurar-${randomUUID()}.db`);
    writeFileSync(temporario, dados);
    try {
      const teste = new DatabaseSync(temporario);
      try {
        const nomes = teste.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
        if (!["planos", "cotacoes", "config"].every((t) => nomes.includes(t))) {
          throw new ErroBackup("Este arquivo não é um backup do cotador.");
        }
        migrar(teste);
      } catch (e) {
        throw e instanceof ErroBackup ? e : new ErroBackup("Não consegui ler este backup: " + e.message);
      } finally {
        teste.close();
      }
      if (caminhoCopiaSeguranca) writeFileSync(caminhoCopiaSeguranca, this.gerarBackup());
      this.fechar();
      try {
        copyFileSync(temporario, this.caminho);
      } finally {
        this.abrir();
      }
    } finally {
      rmSync(temporario, { force: true });
    }
  }
}

export class ErroBackup extends Error {}
