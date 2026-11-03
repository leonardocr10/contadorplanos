// Banco local em node:sqlite: migrações versionadas, seed e acesso a planos, cotações e configuração.
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const STATUS = ["Enviada", "Em negociação", "Fechou", "Perdida"];

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
];

function migrar(db) {
  const versao = db.prepare("PRAGMA user_version").get().user_version;
  if (versao > MIGRACOES.length) {
    throw new Error("Este banco foi criado por uma versão mais nova do cotador.");
  }
  for (let v = versao; v < MIGRACOES.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRACOES[v]);
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
  corPrimaria: "cor_primaria", corEscura: "cor_escura",
};
const COLUNAS_BOOL = { ativo: "ativo", odonto: "odonto", fidelidade: "fidelidade", mostrarExtras: "mostrar_extras" };
const COLUNAS_JSON = { faixasEnf: "faixas_enf", faixasApto: "faixas_apto" };

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
    id: l.id, fone: l.fone, cliente: l.cliente, criadoEm: l.criado_em, tipo: l.tipo, idades: l.idades,
    vidas: JSON.parse(l.vidas), over: JSON.parse(l.overrides), planos: JSON.parse(l.planos), mensagem: l.mensagem, status: l.status,
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
    migrar(this.db);
    this.semear();
  }

  fechar() {
    this.db.close();
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
    return this.db.prepare("DELETE FROM planos WHERE id = ?").run(id).changes > 0;
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
      ultima && ultima.mensagem === c.mensagem && ultima.tipo === c.tipo &&
      JSON.stringify(ultima.vidas) === JSON.stringify(c.vidas) && JSON.stringify(ultima.planos) === JSON.stringify(c.planos)
    ) {
      return { cotacao: ultima, duplicada: true };
    }
    const id = "c" + randomUUID();
    this.db
      .prepare("INSERT INTO cotacoes (id, fone, cliente, criado_em, tipo, idades, vidas, overrides, planos, mensagem, status) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, c.fone, c.cliente, new Date().toISOString(), c.tipo, c.idades, JSON.stringify(c.vidas), JSON.stringify(c.over), JSON.stringify(c.planos), c.mensagem, c.status ?? "Enviada");
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
  // A mesma proposta reaproveita o mesmo link.
  salvarProposta(dados) {
    const json = JSON.stringify(dados);
    const chave = createHash("sha256").update(json).digest("hex");
    const existente = this.db.prepare("SELECT token FROM propostas WHERE chave = ?").get(chave);
    if (existente) return existente.token;
    const token = randomBytes(16).toString("base64url");
    this.db.prepare("INSERT INTO propostas (token, chave, dados, criado_em) VALUES (?, ?, ?, ?)").run(token, chave, json, new Date().toISOString());
    return token;
  }

  obterProposta(token) {
    const l = this.db.prepare("SELECT dados FROM propostas WHERE token = ?").get(token);
    return l ? JSON.parse(l.dados) : null;
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
