// Banco local em node:sqlite: migrações versionadas, seed e acesso a planos, cotações e configuração.
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completarCarencias, linhaDoPlano, redeDaCidade } from "../public/js/calculo.js";
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
  // Sem mudança na estrutura: marca a chegada da Hapvida (ver PLANOS_NOVOS).
  () => {},
  // Rede credenciada e taxa associativa da Hapvida; o que já foi cadastrado à mão fica como está.
  "UPDATE planos SET taxa = 10 WHERE id IN ('hapvida-nosso-plano-total', 'hapvida-nosso-plano-parcial') AND taxa IS NULL; UPDATE planos SET rede = 'Hospital e Maternidade Madrecor' || char(10) || 'Clínica e Diagnóstico Uberlândia' || char(10) || 'Clínica Marechal Deodoro' WHERE id IN ('hapvida-nosso-plano-total', 'hapvida-nosso-plano-parcial') AND rede = ''",
  // O nome da administradora sai do subtítulo dos planos da Hapvida.
  "UPDATE planos SET subtitulo = REPLACE(subtitulo, ' (Affix)', '') WHERE id IN ('hapvida-nosso-plano-total', 'hapvida-nosso-plano-parcial')",
  // Sem mudança na estrutura: marca a chegada dos planos PME da Unimed (ver PLANOS_NOVOS).
  () => {},
  // Planos de empresa com mínimo de vidas e preço que muda com o tamanho do grupo (ver tabelaPorVidas).
  (db) => {
    const colunas = db.prepare("PRAGMA table_info(planos)").all().map((c) => c.name);
    if (!colunas.includes("vidas_minimas")) db.exec("ALTER TABLE planos ADD COLUMN vidas_minimas INTEGER");
    if (!colunas.includes("tabelas_por_vidas")) db.exec("ALTER TABLE planos ADD COLUMN tabelas_por_vidas TEXT");
  },
  // Sem mudança na estrutura: as carências da Amil PME passam a ser as do plano adesão (ver atualizarCarenciasAmilPme).
  () => {},
  // Sem mudança na estrutura: benefícios exclusivos nos planos Amil PME (ver atualizarBeneficiosAmilPme).
  () => {},
  // Unimed PME: contratação a partir de 2 vidas.
  "UPDATE planos SET vidas_minimas = 2 WHERE id IN ('unimed-pleno-on-pme', 'unimed-udiplan-on-pme', 'unimed-pontual-on-pme', 'unimed-uniplan-on-pme') AND vidas_minimas IS NULL; UPDATE planos SET subtitulo = REPLACE(subtitulo, '(3 a 99 vidas)', '(2 a 99 vidas)'), descricao = REPLACE(descricao, 'Empresarial PME de 3 a 99 vidas', 'Empresarial PME de 2 a 99 vidas') WHERE id IN ('unimed-pleno-on-pme', 'unimed-udiplan-on-pme', 'unimed-pontual-on-pme', 'unimed-uniplan-on-pme')",
  // Área de comercialização dos planos Amil CNPJ na ordem da tabela da Amil; área editada à mão fica como está.
  "UPDATE planos SET area_comercializacao = 'MG: Araguari, Belo Horizonte, Belo Vale, Betim, Bocaiúva, Bonfim, Brumadinho, Cachoeira de Minas, Caeté, Confins, Congonhas, Conselheiro Lafaiete, Contagem, Cristiano Otoni, Esmeraldas, Espírito Santo do Dourado, Florestal, Ibirité, Igarapé, Indianópolis, Itabirito, Itaverava, Jaboticatubas, Janaúba, Juatuba, Juiz de Fora, Lagoa Santa, Mariana, Mário Campos, Mateus Leme, Matozinhos, Moeda, Monte Alegre de Minas, Montes Claros, Nova Lima, Nova União, Ouro Branco, Ouro Preto, Pedro Leopoldo, Pouso Alegre, Prata, Queluzito, Raposos, Ribeirão das Neves, Rio Acima, Rio Manso, Sabará, Santa Luzia, Santana dos Montes, São Joaquim de Bicas, São José da Lapa, Sarzedo, Taquaraçu de Minas, Tupaciguara, Uberaba, Uberlândia, Vespasiano' WHERE id LIKE 'amil-pme-%' AND area_comercializacao = 'MG: Araguari, Belo Horizonte, Belo Vale, Betim, Bonfim, Brumadinho, Cachoeira de Minas, Caeté, Confins, Congonhas, Conselheiro Lafaiete, Contagem, Cristiano Otoni, Esmeraldas, Espírito Santo do Dourado, Florestal, Ibirité, Igarapé, Indianópolis, Itabirito, Itaverava, Jaboticatubas, Juatuba, Juiz de Fora, Lagoa Santa, Mariana, Mário Campos, Mateus Leme, Matozinhos, Moeda, Monte Alegre de Minas, Montes Claros, Nova Lima, Nova União, Ouro Branco, Ouro Preto, Pedro Leopoldo, Pouso Alegre, Prata, Queluzito, Raposos, Ribeirão das Neves, Rio Acima, Rio Manso, Sabará, Santa Luzia, Santana dos Montes, São Joaquim de Bicas, São José da Lapa, Sarzedo, Taquaraçu de Minas, Tupaciguara, Uberaba, Uberlândia, Vespasiano, Janaúba, Bocaiúva'",
  // Sem mudança na estrutura: marca a chegada dos planos PME da Hapvida (ver PLANOS_NOVOS).
  () => {},
  // Sem mudança na estrutura: tabelas promocionais da Hapvida PME, com Uberaba (ver atualizarHapvidaPme).
  () => {},
  // Sem mudança na estrutura: marca a chegada do Hapvida pessoa física de Uberaba (ver PLANOS_NOVOS).
  () => {},
  // Sem mudança na estrutura: Hapvida PME volta à cotação de 1 a 99 vidas, com Uberaba (ver atualizarHapvidaPme).
  () => {},
  // Sem mudança na estrutura: Hapvida PME de Uberlândia com a tabela nova, taxa de R$ 20,00 e odonto novo (ver atualizarHapvidaPme).
  () => {},
  // Sem mudança na estrutura: carências da Unimed PME com as colunas PRC 10, 20 e 50 (ver atualizarCarenciasUnimedPme).
  () => {},
  // Sem mudança na estrutura: rede da Unimed PME com hospitais e laboratórios de cada plano (ver atualizarRedeUnimedPme).
  () => {},
  // Documentos passam a ser de cada cartão de plano: os que valiam para todo o tipo ficam em todos os planos dele.
  `DELETE FROM documentos_planos;
   INSERT INTO documentos_planos (documento_id, plano_id) SELECT d.id, p.id FROM documentos d JOIN planos p ON p.categoria = d.tipo;`,
  // Documentos dos planos CNPJ: a Unimed PME com a lista da Unimed e os demais com a lista empresarial. Troca a lista anterior.
  (db) => trocarDocumentosCnpj(db, { unimed: true }),
  // Lista empresarial com os nomes mais curtos (sem "cópia"); a Unimed PME fica com a lista dela.
  (db) => trocarDocumentosCnpj(db, { unimed: false }),
  // Contratos vendidos: cliente, plano, valor e a data de ativação, quando o corretor deve entrar em contato.
  `CREATE TABLE IF NOT EXISTS contratos (
     id TEXT PRIMARY KEY,
     usuario_id TEXT NOT NULL DEFAULT '',
     nome TEXT NOT NULL,
     fone TEXT NOT NULL,
     plano TEXT NOT NULL,
     valor REAL NOT NULL,
     ativacao TEXT NOT NULL,
     contato_em TEXT,
     criado_em TEXT NOT NULL
   );`,
  // Documentos que o cliente enviou, guardados no próprio banco: entram no backup e nunca ficam num link público.
  `CREATE TABLE IF NOT EXISTS contratos_arquivos (
     id TEXT PRIMARY KEY,
     contrato_id TEXT NOT NULL,
     nome TEXT NOT NULL,
     tipo TEXT NOT NULL,
     tamanho INTEGER NOT NULL,
     dados BLOB NOT NULL,
     criado_em TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS contratos_arquivos_contrato ON contratos_arquivos (contrato_id);`,
  // Documento que tenha ficado sem contrato é apagado.
  "DELETE FROM contratos_arquivos WHERE contrato_id NOT IN (SELECT id FROM contratos)",
  // Sem mudança na estrutura: carta de permanência em todos os planos (ver incluirCartaDePermanencia).
  () => {},
  // Envio de documentos pelo cliente que aceitou a proposta: ele entra com o telefone e envia aos poucos.
  // Os arquivos ficam no banco, como os dos contratos: entram no backup e nunca num link público.
  (db) => {
    const colunas = db.prepare("PRAGMA table_info(propostas)").all().map((c) => c.name);
    const novas = { docs_fone: "TEXT NOT NULL DEFAULT ''", docs_chave: "TEXT", docs_concluido_em: "TEXT" };
    for (const [nome, tipo] of Object.entries(novas)) if (!colunas.includes(nome)) db.exec(`ALTER TABLE propostas ADD COLUMN ${nome} ${tipo}`);
    db.exec(`CREATE TABLE IF NOT EXISTS propostas_arquivos (
     id TEXT PRIMARY KEY,
     token TEXT NOT NULL,
     documento TEXT NOT NULL,
     nome TEXT NOT NULL,
     tipo TEXT NOT NULL,
     tamanho INTEGER NOT NULL,
     dados BLOB NOT NULL,
     criado_em TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS propostas_arquivos_token ON propostas_arquivos (token);`);
  },
];

// Troca os documentos dos planos CNPJ pela lista empresarial; com unimed, a Unimed PME recebe a lista dela.
function trocarDocumentosCnpj(db, { unimed }) {
  const todos = db.prepare("SELECT id FROM planos WHERE categoria = 'CNPJ'").all().map((p) => p.id);
  const outros = todos.filter((id) => !UNIMED_PME.includes(id)), daUnimed = unimed ? todos.filter((id) => UNIMED_PME.includes(id)) : [];
  const trocar = [...outros, ...daUnimed];
  if (!trocar.length) return;
  db.prepare(`DELETE FROM documentos_planos WHERE plano_id IN (${trocar.map(() => "?").join(",")})`).run(...trocar);
  // Some antes o que não sobrou em nenhum plano: a lista nova é criada na ordem certa.
  db.exec("DELETE FROM documentos WHERE id NOT IN (SELECT documento_id FROM documentos_planos)");
  const ligar = db.prepare("INSERT OR IGNORE INTO documentos_planos (documento_id, plano_id) VALUES (?, ?)");
  const documento = (nome) => db.prepare("SELECT id FROM documentos WHERE nome = ? AND tipo = 'CNPJ'").get(nome)?.id
    ?? Number(db.prepare("INSERT INTO documentos (nome, tipo) VALUES (?, 'CNPJ')").run(nome).lastInsertRowid);
  for (const [lista, planos] of [[DOCUMENTOS_CNPJ, outros], [DOCUMENTOS_UNIMED_PME, daUnimed]]) {
    if (!planos.length) continue;
    for (const nome of lista) { const id = documento(nome); for (const plano of planos) ligar.run(id, plano); }
  }
  db.exec("DELETE FROM documentos WHERE id NOT IN (SELECT documento_id FROM documentos_planos)");
}

const VERSAO_TEXTOS_COPARTICIPACAO = 11;
const VERSAO_AREA_COMERCIALIZACAO = 12;
const VERSAO_REDE_POR_CIDADE = 13;
const VERSAO_CARENCIAS_AMIL_PME = 27;
const VERSAO_BENEFICIOS_AMIL_PME = 28;
const VERSAO_HAPVIDA_PME = 35;
const VERSAO_CARENCIAS_UNIMED_PME = 36;
const VERSAO_REDE_UNIMED_PME = 37;
const VERSAO_CARTA_DE_PERMANENCIA = 44;
// Relação de documentos do plano empresarial/PJ: da empresa, depois do titular e dos dependentes.
const DOCUMENTOS_CNPJ = [
  "CARTÃO CNPJ",
  "CONTRATO SOCIAL DA EMPRESA OU CCMEI",
  "DOCUMENTAÇÃO DOS RESPONSÁVEIS DA EMPRESA (CPF E RG OU CNH)",
  "COMPROVANTE DE ENDEREÇO DOS RESPONSÁVEIS",
  "E-MAIL E TELEFONES DE CONTATO DA EMPRESA",
  "CPF E RG OU CNH DO TITULAR E DEPENDENTES",
  "E-MAIL E TELEFONES DE CONTATO DO TITULAR E DEPENDENTES",
];
const UNIMED_PME = ["unimed-pleno-on-pme", "unimed-udiplan-on-pme", "unimed-pontual-on-pme", "unimed-uniplan-on-pme"];
// Documentação comprobatória da Unimed PME, na ordem da lista: empresa, titulares e dependentes.
const DOCUMENTOS_UNIMED_PME = [
  "Cartão CNPJ",
  "Contrato Social registrado no órgão competente ou requerimento de empresário, registrado na junta comercial",
  "Última alteração contratual (se houver)",
  "Cópia do RG/CNH do responsável pela assinatura do contrato",
  "Inscrição Municipal ou Alvará de Funcionamento",
  "DCTFweb com demonstrativo CLT e recibo de transmissão",
  "Relatório S2200 e E-social completo",
  "RG/CNH dos titulares",
  "Comprovante de endereço atualizado (sócio ou administrador)",
  "Cartão Nacional do SUS dos titulares",
  "RG/CNH dos dependentes (cônjuge e filhos/enteados)",
  "Cartão Nacional do SUS dos dependentes",
  "Certidão de Casamento ou União Estável",
  "Certidão de Escolaridade (filhos/enteados de 19 a 23 anos e 11 meses)",
];
// Rede que a Unimed PME tinha antes da tabela de rede: outra rede foi editada à mão.
const REDE_ANTIGA_UNIMED_PME = { "unimed-pleno-on-pme": "Hospital Santa Clara\nHospital Santa Marta\nHospital UMC\nHospital Orthomed", "unimed-udiplan-on-pme": "Hospital Santa Genoveva\nHospital Santa Marta\nHospital Santa Clara\nHospital UMC\nOrthomed Center", "unimed-pontual-on-pme": "", "unimed-uniplan-on-pme": "" };
// Tabela de carências que a Unimed PME tinha só com a coluna PRC 10: outra tabela foi editada à mão.
const CARENCIA_ANTIGA_UNIMED_PME = ["Procedimentos | PRC 10 – contratual", "Pronto Socorro | 24 horas", "Consulta Eletiva | 24 horas", "Exames de Rotina | 24 horas", "Exames Básicos | 60 dias", "Exames Intermediário | 90 dias", "Exames Avançados | 180 dias", "Exames Especializado | 180 dias", "Internações | 180 dias", "Parto | 300 dias", "Terapias | 180 dias", "CPT | 720 dias"].join("\n");
// Primeira faixa das tabelas que a Hapvida PME já teve: plano com outro valor foi editado à mão.
const HAPVIDA_PME_ANTIGA = { "hapvida-nosso-plano-pme-total": [170.72, 114.32], "hapvida-nosso-plano-pme-parcial": [252.94, 168.22], "hapvida-nosso-plano-pme-uberaba-total": [174.44, 120.59], "hapvida-nosso-plano-pme-uberaba-parcial": [255.75, 158.93] };
// Prazos da lei que os planos Amil PME tiveram até a tabela da Amil chegar.
const CARENCIA_PROVISORIA_AMIL_PME = "Cobertura | Prazo máximo (Lei 9.656/98)";

// Planos lançados depois que o banco já existia: entram uma única vez, ao atualizar.
const PLANOS_NOVOS = [{ id: "plamedh-basic-pme", versao: 6 }, { id: "plam-total-cnpj", versao: 7 }, ...["sulamerica-direto-nacional", "sulamerica-especial-100-rc", "sulamerica-especial-100-r1", "sulamerica-executivo-pleno"].map((id) => ({ id, versao: 10 })), { id: "aurora-saude-pf", versao: 14 }, ...["hapvida-nosso-plano-total", "hapvida-nosso-plano-parcial"].map((id) => ({ id, versao: 22 })), ...["unimed-pleno-on-pme", "unimed-udiplan-on-pme", "unimed-pontual-on-pme", "unimed-uniplan-on-pme"].map((id) => ({ id, versao: 25 })), ...["amil-pme-prata-30", "amil-pme-prata-30-mei", "amil-pme-prata-40", "amil-pme-prata-40-mei", "amil-pme-prata-parcial", "amil-pme-prata-parcial-mei", "amil-pme-ouro-30", "amil-pme-ouro-30-mei", "amil-pme-ouro-40", "amil-pme-ouro-40-mei", "amil-pme-ouro-parcial", "amil-pme-ouro-parcial-mei", "amil-pme-platinum-r1-30", "amil-pme-platinum-r1-30-mei", "amil-pme-platinum-r1-40", "amil-pme-platinum-r1-40-mei", "amil-pme-platinum-r1-parcial", "amil-pme-platinum-r1-parcial-mei", "amil-pme-platinum-r2-30", "amil-pme-platinum-r2-30-mei", "amil-pme-platinum-r2-40", "amil-pme-platinum-r2-40-mei", "amil-pme-platinum-r2-parcial", "amil-pme-platinum-r2-parcial-mei"].map((id) => ({ id, versao: 26 })), ...["hapvida-nosso-plano-pme-total", "hapvida-nosso-plano-pme-parcial"].map((id) => ({ id, versao: 31 })), ...["hapvida-nosso-plano-pme-uberaba-total", "hapvida-nosso-plano-pme-uberaba-parcial"].map((id) => ({ id, versao: 32 })), ...["hapvida-nosso-plano-uberaba-total", "hapvida-nosso-plano-uberaba-parcial"].map((id) => ({ id, versao: 34 }))];

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
  vidasMinimas: "vidas_minimas",
};
const COLUNAS_BOOL = { ativo: "ativo", odonto: "odonto", fidelidade: "fidelidade", mostrarExtras: "mostrar_extras", mostrarObservacao: "mostrar_observacao" };
const COLUNAS_JSON = { faixasEnf: "faixas_enf", faixasApto: "faixas_apto", faixasEnfFamilia: "faixas_enf_familia", faixasAptoFamilia: "faixas_apto_familia", tabelasPorVidas: "tabelas_por_vidas" };

function planoParaLinha(p) {
  const l = {};
  for (const [k, c] of Object.entries(COLUNAS_PLANO)) {
    l[c] = p[k] ?? (["enfermaria", "apartamento", "taxa", "vidasMinimas"].includes(k) ? null : k === "ordem" ? 0 : "");
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
    docsFone: l.docs_fone, docsChave: l.docs_chave, docsConcluidoEm: l.docs_concluido_em,
  };
}

function linhaParaContrato(l) {
  return {
    id: l.id, usuarioId: l.usuario_id, nome: l.nome, fone: l.fone, plano: l.plano, valor: l.valor,
    ativacao: l.ativacao, contatoEm: l.contato_em, criadoEm: l.criado_em,
  };
}

const slug = (s) =>
  String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "plano";

export class Banco {
  constructor(caminho, caminhoSeed) {
    this.caminho = caminho;
    this.caminhoSeed = caminhoSeed;
    this.abrir();
  }

  // Num backup restaurado, a versão de antes é a do backup: a cópia já chega migrada, mas os planos novos e as
  // correções de dados das versões seguintes ainda precisam entrar.
  abrir(versaoDoBackup) {
    this.db = new DatabaseSync(this.caminho);
    // O que é apagado (como os documentos dos clientes) é sobrescrito com zeros, e o espaço volta para o disco:
    // com o auto_vacuum incremental, o arquivo do banco encolhe depois de cada exclusão.
    this.db.exec("PRAGMA secure_delete = ON");
    if (this.db.prepare("PRAGMA auto_vacuum").get().auto_vacuum !== 2) this.db.exec("PRAGMA auto_vacuum = INCREMENTAL; VACUUM");
    const versaoAntes = versaoDoBackup ?? this.db.prepare("PRAGMA user_version").get().user_version;
    migrar(this.db);
    this.semear();
    this.incluirPlanosNovos(versaoAntes);
    this.atualizarTextosCoparticipacao(versaoAntes);
    this.preencherAreaComercializacao(versaoAntes);
    this.atualizarRedePorCidade(versaoAntes);
    this.atualizarCarenciasAmilPme(versaoAntes);
    this.atualizarBeneficiosAmilPme(versaoAntes);
    this.atualizarHapvidaPme(versaoAntes);
    this.atualizarCarenciasUnimedPme(versaoAntes);
    this.atualizarRedeUnimedPme(versaoAntes);
    this.incluirCartaDePermanencia(versaoAntes);
  }

  // A carta de permanência passa a ser pedida em todos os planos, de pessoa física e de CNPJ.
  incluirCartaDePermanencia(versaoAntes) {
    if (versaoAntes === 0 || versaoAntes >= VERSAO_CARTA_DE_PERMANENCIA) return;
    for (const tipo of ["PF", "CNPJ"]) {
      const nome = "CARTA DE PERMANÊNCIA";
      const id = this.documentoComNome(nome, tipo) ?? this.criarDocumento(nome, tipo).id;
      this.db.prepare("INSERT OR IGNORE INTO documentos_planos (documento_id, plano_id) SELECT ?, id FROM planos WHERE categoria = ?").run(id, tipo);
    }
  }

  // Os planos das tabelas anteriores passam para a tabela atual; plano com valores editados à mão fica como está.
  atualizarHapvidaPme(versaoAntes) {
    if (versaoAntes === 0 || versaoAntes >= VERSAO_HAPVIDA_PME) return;
    if (!this.caminhoSeed || !existsSync(this.caminhoSeed)) return;
    const planos = JSON.parse(readFileSync(this.caminhoSeed, "utf8"));
    for (const [id, primeiras] of Object.entries(HAPVIDA_PME_ANTIGA)) {
      const atual = this.obterPlano(id);
      const novo = planos.find((p) => p.id === id);
      if (atual && novo && primeiras.includes(atual.faixasEnf?.[0])) this.gravarPlano(id, novo);
    }
  }

  // Só os benefícios que vieram com o plano (vazio ou só o reembolso): o que foi editado à mão fica.
  atualizarBeneficiosAmilPme(versaoAntes) {
    if (versaoAntes === 0 || versaoAntes >= VERSAO_BENEFICIOS_AMIL_PME) return;
    if (!this.caminhoSeed || !existsSync(this.caminhoSeed)) return;
    const atualizar = this.db.prepare("UPDATE planos SET extras = ?, mostrar_extras = 1 WHERE id = ? AND (extras = '' OR (extras LIKE '💳 Reembolso%' AND instr(extras, char(10)) = 0))");
    for (const p of JSON.parse(readFileSync(this.caminhoSeed, "utf8"))) {
      if (p.id.startsWith("amil-pme-")) atualizar.run(p.extras, p.id);
    }
  }

  // Troca só a tabela provisória: carência editada à mão fica como está.
  atualizarCarenciasAmilPme(versaoAntes) {
    if (versaoAntes === 0 || versaoAntes >= VERSAO_CARENCIAS_AMIL_PME) return;
    if (!this.caminhoSeed || !existsSync(this.caminhoSeed)) return;
    const atualizar = this.db.prepare("UPDATE planos SET carencia_tabela = ?, carencia_nota = ? WHERE id = ? AND carencia_tabela LIKE ?");
    for (const p of JSON.parse(readFileSync(this.caminhoSeed, "utf8"))) {
      if (p.id.startsWith("amil-pme-")) atualizar.run(p.carenciaTabela, p.carenciaNota ?? "", p.id, `${CARENCIA_PROVISORIA_AMIL_PME}%`);
    }
  }

  // Troca só a tabela antiga: carência editada à mão fica como está.
  atualizarCarenciasUnimedPme(versaoAntes) {
    if (versaoAntes === 0 || versaoAntes >= VERSAO_CARENCIAS_UNIMED_PME) return;
    if (!this.caminhoSeed || !existsSync(this.caminhoSeed)) return;
    const atualizar = this.db.prepare("UPDATE planos SET carencia_tabela = ?, carencia_nota = ? WHERE id = ? AND carencia_tabela = ?");
    for (const p of JSON.parse(readFileSync(this.caminhoSeed, "utf8"))) {
      if (/^unimed-.*-pme$/.test(p.id)) atualizar.run(p.carenciaTabela, p.carenciaNota ?? "", p.id, CARENCIA_ANTIGA_UNIMED_PME);
    }
  }

  // Troca só a rede antiga: rede editada à mão fica como está.
  atualizarRedeUnimedPme(versaoAntes) {
    if (versaoAntes === 0 || versaoAntes >= VERSAO_REDE_UNIMED_PME) return;
    if (!this.caminhoSeed || !existsSync(this.caminhoSeed)) return;
    const atualizar = this.db.prepare("UPDATE planos SET rede = ? WHERE id = ? AND rede = ?");
    for (const p of JSON.parse(readFileSync(this.caminhoSeed, "utf8"))) {
      if (p.id in REDE_ANTIGA_UNIMED_PME) atualizar.run(p.rede ?? "", p.id, REDE_ANTIGA_UNIMED_PME[p.id]);
    }
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

  /* ---------- documentos ---------- */
  obterDocumento(id) {
    return this.db.prepare("SELECT id, nome, tipo FROM documentos WHERE id = ?").get(id) ?? null;
  }

  documentoComNome(nome, tipo) {
    return this.db.prepare("SELECT id FROM documentos WHERE nome = ? AND tipo = ?").get(nome, tipo)?.id ?? null;
  }

  criarDocumento(nome, tipo) {
    const id = Number(this.db.prepare("INSERT INTO documentos (nome, tipo) VALUES (?, ?)").run(nome, tipo).lastInsertRowid);
    return this.obterDocumento(id);
  }

  renomearDocumento(id, nome) {
    this.db.prepare("UPDATE documentos SET nome = ? WHERE id = ?").run(nome, id);
    return this.obterDocumento(id);
  }

  /* Documentos por cartão: cada documento fica ligado aos planos do cartão (como na Nova cotação, ex.: UNIMED,
     AMIL PRATA MG I). O cartão pede os documentos ligados a qualquer plano dele, então uma opção nova do
     cartão já entra pedindo os mesmos documentos. */
  // Só id, nome e tipo, na ordem de Planos e valores: o cartão sai do nome, sem ler o plano inteiro.
  planosResumidos() {
    return this.db.prepare("SELECT id, nome, categoria FROM planos ORDER BY ordem, nome").all();
  }

  planosDoCartao(tipo, cartao) {
    return this.planosResumidos().filter((p) => p.categoria === tipo && linhaDoPlano(p) === cartao).map((p) => p.id);
  }

  // Planos que a ação alcança: uma opção do cartão (ex.: AMIL OURO 30% MEI) ou, sem ela, o cartão inteiro.
  escopoDoCartao(tipo, cartao, plano = "") {
    const ids = this.planosDoCartao(tipo, cartao);
    return plano ? ids.filter((id) => id === plano) : ids;
  }

  // Documentos do cartão, cada um com as opções (ids dos planos) em que está.
  documentosDoCartao(tipo, cartao) {
    const ids = this.planosDoCartao(tipo, cartao);
    if (!ids.length) return [];
    const docs = new Map();
    for (const l of this.db
      .prepare(`SELECT d.id, d.nome, v.plano_id FROM documentos d JOIN documentos_planos v ON v.documento_id = d.id
        WHERE d.tipo = ? AND v.plano_id IN (${ids.map(() => "?").join(",")}) ORDER BY d.id`)
      .all(tipo, ...ids)) {
      if (!docs.has(l.id)) docs.set(l.id, { id: l.id, nome: l.nome, planos: [] });
      docs.get(l.id).planos.push(l.plano_id);
    }
    // As opções seguem a ordem do cartão.
    for (const d of docs.values()) d.planos.sort((a, b) => ids.indexOf(a) - ids.indexOf(b));
    return [...docs.values()];
  }

  // Tudo com duas consultas: os planos e as ligações de todos os documentos.
  cartoesDeDocumentos() {
    const cartoes = new Map(), cartaoDoPlano = new Map();
    for (const [ordem, p] of this.planosResumidos().entries()) {
      const nome = linhaDoPlano(p), chave = `${p.categoria}|${nome}`;
      if (!cartoes.has(chave)) cartoes.set(chave, { tipo: p.categoria, nome, planos: [], documentos: [] });
      cartoes.get(chave).planos.push({ id: p.id, nome: p.nome, ordem });
      cartaoDoPlano.set(p.id, cartoes.get(chave));
    }
    const docs = new Map();
    for (const l of this.db.prepare("SELECT d.id, d.nome, d.tipo, v.plano_id FROM documentos d JOIN documentos_planos v ON v.documento_id = d.id ORDER BY d.id").all()) {
      const c = cartaoDoPlano.get(l.plano_id);
      if (!c || c.tipo !== l.tipo) continue;
      const chave = `${c.tipo}|${c.nome}|${l.id}`;
      if (!docs.has(chave)) { docs.set(chave, { id: l.id, nome: l.nome, planos: [] }); c.documentos.push(docs.get(chave)); }
      docs.get(chave).planos.push(l.plano_id);
    }
    for (const c of cartoes.values()) {
      const ordem = c.planos.map((p) => p.id);
      for (const d of c.documentos) d.planos.sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b));
    }
    return [...cartoes.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }

  // Liga o documento (pelo nome, sem diferença de maiúsculas) aos planos do cartão, ou só à opção escolhida.
  adicionarDocumentoAoCartao(tipo, cartao, nome, plano = "") {
    const id = this.documentoComNome(nome, tipo) ?? this.criarDocumento(nome, tipo).id;
    const ligar = this.db.prepare("INSERT OR IGNORE INTO documentos_planos (documento_id, plano_id) VALUES (?, ?)");
    for (const planoId of this.escopoDoCartao(tipo, cartao, plano)) ligar.run(id, planoId);
    return this.obterDocumento(id);
  }

  // Tira o documento só deste cartão (ou da opção); documento que não sobra em nenhum plano é apagado.
  tirarDocumentoDoCartao(id, tipo, cartao, plano = "") {
    const ids = this.escopoDoCartao(tipo, cartao, plano);
    if (!ids.length) return false;
    const r = this.db.prepare(`DELETE FROM documentos_planos WHERE documento_id = ? AND plano_id IN (${ids.map(() => "?").join(",")})`).run(id, ...ids);
    this.apagarDocumentosSemPlano();
    return r.changes > 0;
  }

  // Renomear no cartão (ou na opção) troca o documento só ali: os outros continuam com o nome antigo.
  renomearDocumentoNoCartao(id, tipo, cartao, nome, plano = "") {
    const outro = this.documentoComNome(nome, tipo);
    if (outro === id) return this.renomearDocumento(id, nome);
    // Documento só destes planos, com nome livre: muda no lugar e mantém o id.
    const ids = this.escopoDoCartao(tipo, cartao, plano);
    const fora = this.db
      .prepare(`SELECT COUNT(*) AS n FROM documentos_planos WHERE documento_id = ? AND plano_id NOT IN (${ids.map(() => "?").join(",")})`)
      .get(id, ...ids).n;
    if (outro == null && !fora) return this.renomearDocumento(id, nome);
    const ligados = this.db.prepare("SELECT plano_id FROM documentos_planos WHERE documento_id = ?").all(id).map((l) => l.plano_id);
    const alvo = ids.filter((p) => ligados.includes(p));
    this.tirarDocumentoDoCartao(id, tipo, cartao, plano);
    const novo = this.documentoComNome(nome, tipo) ?? this.criarDocumento(nome, tipo).id;
    const ligar = this.db.prepare("INSERT OR IGNORE INTO documentos_planos (documento_id, plano_id) VALUES (?, ?)");
    for (const p of alvo) ligar.run(novo, p);
    return this.obterDocumento(novo);
  }

  apagarDocumentosSemPlano() {
    this.db.exec("DELETE FROM documentos WHERE id NOT IN (SELECT documento_id FROM documentos_planos)");
  }

  // Documentos de uma opção. Opção nova, ainda sem documentos, pede os que todas as outras opções do cartão pedem.
  documentosDoPlano(planoId) {
    const p = this.obterPlano(planoId);
    if (!p) return [];
    const docs = this.documentosDoCartao(p.categoria, linhaDoPlano(p));
    const proprios = docs.filter((d) => d.planos.includes(p.id));
    if (proprios.length) return proprios.map((d) => d.nome);
    const outros = new Set(docs.flatMap((d) => d.planos));
    return outros.size ? docs.filter((d) => [...outros].every((o) => d.planos.includes(o))).map((d) => d.nome) : [];
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

  /* ---------- contratos vendidos ---------- */
  listarContratos({ usuarioId } = {}) {
    const sql = `SELECT * FROM contratos ${usuarioId !== undefined ? "WHERE usuario_id = ?" : ""} ORDER BY ativacao DESC, criado_em DESC`;
    return this.db.prepare(sql).all(...(usuarioId !== undefined ? [usuarioId] : [])).map(linhaParaContrato);
  }

  obterContrato(id) {
    const l = this.db.prepare("SELECT * FROM contratos WHERE id = ?").get(id);
    return l ? linhaParaContrato(l) : null;
  }

  criarContrato(c) {
    const id = randomBytes(9).toString("base64url");
    this.db.prepare("INSERT INTO contratos (id, usuario_id, nome, fone, plano, valor, ativacao, criado_em) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, c.usuarioId ?? "", c.nome, c.fone, c.plano, c.valor, c.ativacao, new Date().toISOString());
    return this.obterContrato(id);
  }

  // Mudar a data de ativação refaz o aviso: o contato volta a ficar pendente.
  gravarContrato(id, c) {
    const antes = this.obterContrato(id);
    if (!antes) return null;
    this.db.prepare("UPDATE contratos SET nome = ?, fone = ?, plano = ?, valor = ?, ativacao = ?, contato_em = ? WHERE id = ?")
      .run(c.nome, c.fone, c.plano, c.valor, c.ativacao, antes.ativacao === c.ativacao ? antes.contatoEm : null, id);
    return this.obterContrato(id);
  }

  marcarContato(id, feito) {
    this.db.prepare("UPDATE contratos SET contato_em = ? WHERE id = ?").run(feito ? new Date().toISOString() : null, id);
    return this.obterContrato(id);
  }

  // O contrato e os documentos dele saem juntos: nunca fica documento sem contrato no banco.
  excluirContrato(id) {
    let apagou = false;
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM contratos_arquivos WHERE contrato_id = ?").run(id);
      apagou = this.db.prepare("DELETE FROM contratos WHERE id = ?").run(id).changes > 0;
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    this.liberarEspaco();
    return apagou;
  }

  // Devolve ao disco o espaço do que foi apagado.
  liberarEspaco() {
    this.db.exec("PRAGMA incremental_vacuum");
  }

  // Lista sem o conteúdo: só o que a tela mostra.
  arquivosDosContratos(ids) {
    const porContrato = new Map(ids.map((id) => [id, []]));
    if (!ids.length) return porContrato;
    const linhas = this.db.prepare(`SELECT id, contrato_id, nome, tipo, tamanho, criado_em FROM contratos_arquivos WHERE contrato_id IN (${ids.map(() => "?").join(",")}) ORDER BY criado_em, rowid`).all(...ids);
    for (const l of linhas) porContrato.get(l.contrato_id)?.push({ id: l.id, nome: l.nome, tipo: l.tipo, tamanho: l.tamanho, criadoEm: l.criado_em });
    return porContrato;
  }

  guardarArquivoDoContrato(contratoId, { nome, tipo, dados }) {
    const id = randomBytes(9).toString("base64url");
    this.db.prepare("INSERT INTO contratos_arquivos (id, contrato_id, nome, tipo, tamanho, dados, criado_em) VALUES (?,?,?,?,?,?,?)")
      .run(id, contratoId, nome, tipo, dados.length, dados, new Date().toISOString());
    return this.arquivosDosContratos([contratoId]).get(contratoId).find((a) => a.id === id);
  }

  lerArquivoDoContrato(contratoId, id) {
    const l = this.db.prepare("SELECT nome, tipo, dados FROM contratos_arquivos WHERE contrato_id = ? AND id = ?").get(contratoId, id);
    return l ? { nome: l.nome, tipo: l.tipo, dados: Buffer.from(l.dados) } : null;
  }

  excluirArquivoDoContrato(contratoId, id) {
    const apagou = this.db.prepare("DELETE FROM contratos_arquivos WHERE contrato_id = ? AND id = ?").run(contratoId, id).changes > 0;
    if (apagou) this.liberarEspaco();
    return apagou;
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

  // O aceite e os documentos que o cliente enviou saem juntos.
  excluirAceite(token) {
    let apagou = false;
    this.db.exec("BEGIN");
    try {
      apagou = this.db.prepare("DELETE FROM propostas WHERE token = ? AND aceito_em IS NOT NULL").run(token).changes > 0;
      if (apagou) this.db.prepare("DELETE FROM propostas_arquivos WHERE token = ?").run(token);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    if (apagou) this.liberarEspaco();
    return apagou;
  }

  /* ---------- documentos enviados pelo cliente ---------- */
  // Chave do acesso do cliente aos documentos desta proposta: criada na primeira entrada e mantida depois,
  // para ele continuar o envio de onde parou, em qualquer aparelho em que já tenha entrado.
  chaveDosDocumentos(token) {
    const atual = this.db.prepare("SELECT docs_chave FROM propostas WHERE token = ? AND aceito_em IS NOT NULL").get(token);
    if (!atual) return null;
    if (atual.docs_chave) return atual.docs_chave;
    const chave = randomBytes(32).toString("base64url");
    this.db.prepare("UPDATE propostas SET docs_chave = ? WHERE token = ?").run(chave, token);
    return chave;
  }

  // Proposta feita sem o número do cliente: o primeiro telefone informado passa a ser o login dela.
  definirFoneDosDocumentos(token, fone) {
    this.db.prepare("UPDATE propostas SET docs_fone = ? WHERE token = ? AND docs_fone = ''").run(fone, token);
  }

  // Lista sem o conteúdo: só o que as telas mostram.
  arquivosDasPropostas(tokens) {
    const porToken = new Map(tokens.map((t) => [t, []]));
    if (!tokens.length) return porToken;
    const linhas = this.db.prepare(`SELECT id, token, documento, nome, tipo, tamanho, criado_em FROM propostas_arquivos WHERE token IN (${tokens.map(() => "?").join(",")}) ORDER BY criado_em, rowid`).all(...tokens);
    for (const l of linhas) porToken.get(l.token)?.push({ id: l.id, documento: l.documento, nome: l.nome, tipo: l.tipo, tamanho: l.tamanho, criadoEm: l.criado_em });
    return porToken;
  }

  arquivosDaProposta(token) {
    return this.arquivosDasPropostas([token]).get(token);
  }

  guardarArquivoDaProposta(token, { documento, nome, tipo, dados }) {
    const id = randomBytes(9).toString("base64url");
    this.db.prepare("INSERT INTO propostas_arquivos (id, token, documento, nome, tipo, tamanho, dados, criado_em) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, token, documento, nome, tipo, dados.length, dados, new Date().toISOString());
    return id;
  }

  lerArquivoDaProposta(token, id) {
    const l = this.db.prepare("SELECT nome, tipo, dados FROM propostas_arquivos WHERE token = ? AND id = ?").get(token, id);
    return l ? { nome: l.nome, tipo: l.tipo, dados: Buffer.from(l.dados) } : null;
  }

  excluirArquivoDaProposta(token, id) {
    const apagou = this.db.prepare("DELETE FROM propostas_arquivos WHERE token = ? AND id = ?").run(token, id).changes > 0;
    if (apagou) this.liberarEspaco();
    return apagou;
  }

  // O cliente avisa que terminou; reabrir o envio tira o aviso.
  concluirDocumentos(token, concluido) {
    this.db.prepare("UPDATE propostas SET docs_concluido_em = ? WHERE token = ? AND aceito_em IS NOT NULL").run(concluido ? new Date().toISOString() : null, token);
    return this.obterProposta(token);
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
      let versaoDoBackup;
      const teste = new DatabaseSync(temporario);
      try {
        const nomes = teste.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
        if (!["planos", "cotacoes", "config"].every((t) => nomes.includes(t))) {
          throw new ErroBackup("Este arquivo não é um backup do cotador.");
        }
        versaoDoBackup = teste.prepare("PRAGMA user_version").get().user_version;
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
      let copiou = false;
      try {
        copyFileSync(temporario, this.caminho);
        copiou = true;
      } finally {
        this.abrir(copiou ? versaoDoBackup : undefined);
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
