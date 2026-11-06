// Banco local em node:sqlite: migrações versionadas, seed e acesso a planos, cotações e configuração.
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completarCarencias, redeDaCidade } from "../public/js/calculo.js";
import { permissoesDoUsuario } from "./permissoes.js";

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
  `CREATE TABLE IF NOT EXISTS usuarios (
     id TEXT PRIMARY KEY,
     login TEXT NOT NULL UNIQUE COLLATE NOCASE,
     senha_hash TEXT NOT NULL,
     perfil TEXT NOT NULL CHECK (perfil IN ('admin','usuario')),
     nome TEXT NOT NULL DEFAULT '',
     fone TEXT NOT NULL DEFAULT '',
     empresa TEXT NOT NULL DEFAULT '',
     ativo INTEGER NOT NULL DEFAULT 1,
     criado_em TEXT NOT NULL
   );`,
  // Sem dono ('') são as cotações de antes dos logins: só o administrador as vê.
  (db) => {
    const existe = db.prepare("PRAGMA table_info(cotacoes)").all().some((c) => c.name === "usuario_id");
    if (!existe) db.exec("ALTER TABLE cotacoes ADD COLUMN usuario_id TEXT NOT NULL DEFAULT ''");
  },
  (db) => {
    const existe = db.prepare("PRAGMA table_info(usuarios)").all().some((c) => c.name === "email");
    if (!existe) db.exec("ALTER TABLE usuarios ADD COLUMN email TEXT NOT NULL DEFAULT ''");
    const temPermissoes = db.prepare("PRAGMA table_info(usuarios)").all().some((c) => c.name === "permissoes");
    if (!temPermissoes) db.exec("ALTER TABLE usuarios ADD COLUMN permissoes TEXT NOT NULL DEFAULT ''");
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios (email COLLATE NOCASE) WHERE email <> '';
      CREATE TABLE IF NOT EXISTS recuperacoes_senha (
        token_hash TEXT PRIMARY KEY,
        usuario_id TEXT NOT NULL,
        expira_em INTEGER NOT NULL
      );`);
  },
  (db) => {
    const existe = db.prepare("PRAGMA table_info(usuarios)").all().some((c) => c.name === "foto");
    if (!existe) db.exec("ALTER TABLE usuarios ADD COLUMN foto TEXT NOT NULL DEFAULT ''");
  },
  // Cada documento passa a ser de pessoa física ou de CNPJ, e o nome só se repete entre tipos diferentes.
  (db) => {
    db.exec(`CREATE TABLE documentos_tipo (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       nome TEXT NOT NULL COLLATE NOCASE,
       tipo TEXT NOT NULL CHECK (tipo IN ('PF','CNPJ')),
       UNIQUE (nome, tipo)
     );
     INSERT INTO documentos_tipo (id, nome, tipo) SELECT id, nome, 'PF' FROM documentos;
     DROP TABLE documentos;
     ALTER TABLE documentos_tipo RENAME TO documentos;`);
    // Ativo nos dois tipos, o documento vira dois: o de pessoa física e uma cópia para CNPJ.
    const ativosEm = (id, categoria) => db.prepare(
      "SELECT COUNT(*) AS n FROM documentos_planos v JOIN planos p ON p.id = v.plano_id WHERE v.documento_id = ? AND p.categoria = ?",
    ).get(id, categoria).n;
    for (const d of db.prepare("SELECT id, nome FROM documentos ORDER BY id").all()) {
      if (!ativosEm(d.id, "CNPJ")) continue;
      if (!ativosEm(d.id, "PF")) { db.prepare("UPDATE documentos SET tipo = 'CNPJ' WHERE id = ?").run(d.id); continue; }
      const copia = Number(db.prepare("INSERT INTO documentos (nome, tipo) VALUES (?, 'CNPJ')").run(d.nome).lastInsertRowid);
      db.prepare("UPDATE documentos_planos SET documento_id = ? WHERE documento_id = ? AND plano_id IN (SELECT id FROM planos WHERE categoria = 'CNPJ')").run(copia, d.id);
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
    id: l.id, fone: l.fone, cliente: l.cliente, criadoEm: l.criado_em, usuarioId: l.usuario_id, tipo: l.tipo, uf: l.uf, municipio: l.municipio, idades: l.idades,
    vidas: JSON.parse(l.vidas), over: JSON.parse(l.overrides), planos: JSON.parse(l.planos), mensagem: l.mensagem, status: l.status,
  };
}

function linhaParaUsuario(l) {
  return { id: l.id, login: l.login, email: l.email, perfil: l.perfil, permissoes: permissoesDoUsuario(l.perfil, l.permissoes), nome: l.nome, fone: l.fone, empresa: l.empresa, foto: l.foto, ativo: !!l.ativo, criadoEm: l.criado_em };
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
    return this.db.prepare("SELECT id, nome, tipo FROM documentos ORDER BY id").all().map((d) => ({
      id: d.id, nome: d.nome, tipo: d.tipo, planos: vinculos.filter((v) => v.documento_id === d.id).map((v) => v.plano_id),
    }));
  }

  obterDocumento(id) {
    return this.listarDocumentos().find((d) => d.id === id) ?? null;
  }

  documentoComNome(nome, tipo) {
    return this.db.prepare("SELECT id FROM documentos WHERE nome = ? AND tipo = ?").get(nome, tipo)?.id ?? null;
  }

  criarDocumento(nome, tipo, planoId) {
    const id = Number(this.db.prepare("INSERT INTO documentos (nome, tipo) VALUES (?, ?)").run(nome, tipo).lastInsertRowid);
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
    // "Todos" são os planos do mesmo tipo do documento.
    if (ativo) this.db.prepare("INSERT INTO documentos_planos (documento_id, plano_id) SELECT d.id, p.id FROM documentos d JOIN planos p ON p.categoria = d.tipo WHERE d.id = ?").run(id);
    return this.obterDocumento(id);
  }

  documentosDoPlano(planoId) {
    // Um plano que mudou de tipo não leva os documentos do tipo antigo.
    return this.db
      .prepare("SELECT d.nome FROM documentos d JOIN documentos_planos v ON v.documento_id = d.id JOIN planos p ON p.id = v.plano_id AND p.categoria = d.tipo WHERE v.plano_id = ? ORDER BY d.id")
      .all(planoId)
      .map((d) => d.nome);
  }

  // Links criados antes dos documentos por plano guardam só o nome do plano.
  documentosDaProposta(dados) {
    const id = dados.plano.id ?? this.db.prepare("SELECT id FROM planos WHERE nome = ?").get(dados.plano.nome)?.id;
    return id ? this.documentosDoPlano(id) : [];
  }

  /* ---------- cotações ---------- */
  // Sem usuarioId, lista as cotações de todos.
  listarCotacoes({ fone = "", q = "", status = "", usuarioId } = {}) {
    const where = [], args = [];
    if (usuarioId !== undefined) { where.push("usuario_id = ?"); args.push(usuarioId); }
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
    const ultima = this.listarCotacoes({ fone: c.fone, usuarioId: c.usuarioId ?? "" })[0];
    if (
      ultima && ultima.fone === c.fone && ultima.mensagem === c.mensagem && ultima.tipo === c.tipo && ultima.municipio === (c.municipio ?? "") &&
      JSON.stringify(ultima.vidas) === JSON.stringify(c.vidas) && JSON.stringify(ultima.planos) === JSON.stringify(c.planos)
    ) {
      return { cotacao: ultima, duplicada: true };
    }
    const id = "c" + randomUUID();
    this.db
      .prepare("INSERT INTO cotacoes (id, usuario_id, fone, cliente, criado_em, tipo, uf, municipio, idades, vidas, overrides, planos, mensagem, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, c.usuarioId ?? "", c.fone, c.cliente, new Date().toISOString(), c.tipo, c.uf ?? "", c.municipio ?? "", c.idades, JSON.stringify(c.vidas), JSON.stringify(c.over), JSON.stringify(c.planos), c.mensagem, c.status ?? "Enviada");
    return { cotacao: this.obterCotacao(id), duplicada: false };
  }

  // A cotação em andamento: a data e a situação ficam como estão.
  atualizarCotacao(id, c) {
    const r = this.db
      .prepare("UPDATE cotacoes SET fone = ?, cliente = ?, tipo = ?, uf = ?, municipio = ?, idades = ?, vidas = ?, overrides = ?, planos = ?, mensagem = ? WHERE id = ?")
      .run(c.fone, c.cliente, c.tipo, c.uf ?? "", c.municipio ?? "", c.idades, JSON.stringify(c.vidas), JSON.stringify(c.over), JSON.stringify(c.planos), c.mensagem, id);
    return r.changes > 0 ? this.obterCotacao(id) : null;
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

  excluirAceite(token) {
    return this.db.prepare("DELETE FROM propostas WHERE token = ? AND aceito_em IS NOT NULL").run(token).changes > 0;
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

  /* ---------- usuários ---------- */
  // Fora deste bloco, o hash da senha nunca acompanha os dados do usuário.
  contarUsuarios() {
    return this.db.prepare("SELECT COUNT(*) AS n FROM usuarios").get().n;
  }

  contarAdminsAtivos() {
    return this.db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE perfil = 'admin' AND ativo = 1").get().n;
  }

  listarUsuarios() {
    return this.db.prepare("SELECT * FROM usuarios ORDER BY login COLLATE NOCASE").all().map(linhaParaUsuario);
  }

  obterUsuario(id) {
    const l = this.db.prepare("SELECT * FROM usuarios WHERE id = ?").get(id);
    return l ? linhaParaUsuario(l) : null;
  }

  obterUsuarioPorLogin(login) {
    const l = this.db.prepare("SELECT * FROM usuarios WHERE login = ?").get(String(login).trim());
    return l ? linhaParaUsuario(l) : null;
  }

  obterUsuarioPorEmail(email) {
    const valor = String(email).trim();
    if (!valor) return null;
    const l = this.db.prepare("SELECT * FROM usuarios WHERE email = ? COLLATE NOCASE").get(valor);
    return l ? linhaParaUsuario(l) : null;
  }

  // Só o hash do token fica guardado, e um pedido novo cancela os anteriores do mesmo usuário.
  criarRecuperacaoDeSenha(usuarioId, tokenHash, expiraEm) {
    this.db.prepare("DELETE FROM recuperacoes_senha WHERE usuario_id = ? OR expira_em < ?").run(usuarioId, Date.now());
    this.db.prepare("INSERT INTO recuperacoes_senha (token_hash, usuario_id, expira_em) VALUES (?, ?, ?)").run(tokenHash, usuarioId, expiraEm);
  }

  lerRecuperacaoDeSenha(tokenHash) {
    const l = this.db.prepare("SELECT usuario_id, expira_em FROM recuperacoes_senha WHERE token_hash = ?").get(tokenHash);
    return l && l.expira_em >= Date.now() ? l.usuario_id : null;
  }

  apagarRecuperacoesDeSenha(usuarioId) {
    this.db.prepare("DELETE FROM recuperacoes_senha WHERE usuario_id = ?").run(usuarioId);
  }

  lerHashDaSenha(id) {
    return this.db.prepare("SELECT senha_hash FROM usuarios WHERE id = ?").get(id)?.senha_hash ?? null;
  }

  criarUsuario({ login, senhaHash, perfil = "usuario", nome = "", fone = "", empresa = "", email = "", permissoes }) {
    const id = "u" + randomUUID();
    this.db
      .prepare("INSERT INTO usuarios (id, login, senha_hash, perfil, nome, fone, empresa, email, permissoes, ativo, criado_em) VALUES (?,?,?,?,?,?,?,?,?,1,?)")
      .run(id, login, senhaHash, perfil, nome, fone, empresa, email, permissoes ? JSON.stringify(permissoes) : "", new Date().toISOString());
    return this.obterUsuario(id);
  }

  atualizarDadosDoUsuario(id, { nome, fone, empresa, email, foto }) {
    const st = (coluna, valor) => { if (valor !== undefined) this.db.prepare(`UPDATE usuarios SET ${coluna} = ? WHERE id = ?`).run(valor, id); };
    st("nome", nome);
    st("fone", fone);
    st("empresa", empresa);
    st("email", email);
    st("foto", foto);
    return this.obterUsuario(id);
  }

  alterarSenhaDoUsuario(id, senhaHash) {
    this.db.prepare("UPDATE usuarios SET senha_hash = ? WHERE id = ?").run(senhaHash, id);
  }

  alterarAcessoDoUsuario(id, { perfil, ativo, permissoes }) {
    if (permissoes !== undefined) this.db.prepare("UPDATE usuarios SET permissoes = ? WHERE id = ?").run(JSON.stringify(permissoes), id);
    if (perfil !== undefined) this.db.prepare("UPDATE usuarios SET perfil = ? WHERE id = ?").run(perfil, id);
    if (ativo !== undefined) this.db.prepare("UPDATE usuarios SET ativo = ? WHERE id = ?").run(ativo ? 1 : 0, id);
    return this.obterUsuario(id);
  }

  excluirUsuario(id) {
    return this.db.prepare("DELETE FROM usuarios WHERE id = ?").run(id).changes > 0;
  }

  /* ---------- backup ---------- */
  // VACUUM INTO gera uma cópia consistente do banco, mesmo com o servidor em uso.
  // Com a pasta das imagens, elas entram na própria cópia, e o backup continua sendo um arquivo só.
  gerarBackup(pastaImagens) {
    const destino = join(tmpdir(), `cotador-backup-${randomUUID()}.db`);
    try {
      this.db.prepare("VACUUM INTO ?").run(destino);
      if (pastaImagens && existsSync(pastaImagens)) guardarImagensNoBackup(destino, pastaImagens);
      return readFileSync(destino);
    } finally {
      rmSync(destino, { force: true });
    }
  }

  // Valida o arquivo numa cópia temporária antes de trocar o banco em uso.
  restaurar(dados, caminhoCopiaSeguranca, pastaImagens) {
    if (dados.subarray(0, 16).toString("latin1") !== "SQLite format 3\0") {
      throw new ErroBackup("Este arquivo não é um backup do cotador.");
    }
    const temporario = join(tmpdir(), `cotador-restaurar-${randomUUID()}.db`);
    writeFileSync(temporario, dados);
    try {
      let imagens = [];
      const teste = new DatabaseSync(temporario);
      try {
        const nomes = teste.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
        if (!["planos", "cotacoes", "config"].every((t) => nomes.includes(t))) {
          throw new ErroBackup("Este arquivo não é um backup do cotador.");
        }
        migrar(teste);
        // Backups antigos não têm imagens. As imagens saem do banco, que não precisa carregá-las.
        if (nomes.includes(TABELA_IMAGENS)) {
          imagens = teste.prepare(`SELECT nome, dados FROM ${TABELA_IMAGENS}`).all();
          if (!imagens.every((i) => imagemValida(i.nome, Buffer.from(i.dados)))) {
            throw new ErroBackup("Este backup traz um arquivo que não é uma imagem válida.");
          }
          teste.exec(`DROP TABLE ${TABELA_IMAGENS}; VACUUM`);
        }
      } catch (e) {
        throw e instanceof ErroBackup ? e : new ErroBackup("Não consegui ler este backup: " + e.message);
      } finally {
        teste.close();
      }
      if (caminhoCopiaSeguranca) writeFileSync(caminhoCopiaSeguranca, this.gerarBackup(pastaImagens));
      // Nenhuma imagem atual é apagada: um backup antigo ainda pode depender dela.
      if (pastaImagens && imagens.length) {
        mkdirSync(pastaImagens, { recursive: true });
        for (const i of imagens) writeFileSync(join(pastaImagens, i.nome), i.dados);
      }
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

const TABELA_IMAGENS = "backup_imagens";

export function tipoImagem(b) {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
}

// O nome vem de um arquivo enviado: sem caminho, e com a extensão de acordo com o conteúdo.
function imagemValida(nome, dados) {
  const m = /^[\w-]+\.(png|jpg|webp)$/.exec(String(nome));
  return !!m && tipoImagem(dados) === m[1];
}

function guardarImagensNoBackup(caminhoBanco, pasta) {
  const copia = new DatabaseSync(caminhoBanco);
  try {
    copia.exec(`CREATE TABLE ${TABELA_IMAGENS} (nome TEXT PRIMARY KEY, dados BLOB NOT NULL)`);
    const inserir = copia.prepare(`INSERT INTO ${TABELA_IMAGENS} (nome, dados) VALUES (?, ?)`);
    for (const item of readdirSync(pasta, { withFileTypes: true })) {
      if (!item.isFile()) continue;
      const dados = readFileSync(join(pasta, item.name));
      if (imagemValida(item.name, dados)) inserir.run(item.name, dados);
    }
  } finally {
    copia.close();
  }
}
