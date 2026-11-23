// Administradora e entidade dos planos de pessoa física por adesão: cadastro e escolha no plano selecionado (não aparecem na mensagem nem na proposta).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adesaoDoPlano, entidadesDoPlano, vendidoEm } from "../public/js/calculo.js";
import { buildMsg } from "../public/js/mensagem.js";
import { montarSnapshot, renderizarProposta } from "../server/proposta-html.js";
import { Banco } from "../server/db.js";

const raiz = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const seed = join(raiz, "dados", "planos.json");
const planos = JSON.parse(readFileSync(seed, "utf8"));
const pf = planos.filter((p) => p.categoria === "PF");
const plano = (id) => planos.find((p) => p.id === id);

test("todo plano de pessoa física tem a administradora das tabelas", () => {
  for (const p of pf) assert.ok(p.administradora, p.id);
  assert.equal(plano("sulamerica-executivo-pleno").administradora, "Qualicorp");
  assert.equal(plano("hapvida-nosso-plano-total").administradora, "Affix");
  assert.equal(plano("aurora-saude-pf").administradora, "Quali");
  // Plano CNPJ não tem administradora.
  assert.ok(planos.filter((p) => p.categoria === "CNPJ").every((p) => !p.administradora));
});

test("as entidades são lidas uma por linha, com a sigla e o público", () => {
  assert.deepEqual(entidadesDoPlano(plano("hapvida-nosso-plano-total")).map((e) => e.sigla), ["FNEL", "UNIPRO", "ASCOSERVI", "FADESP", "ANSP"]);
  const sula = entidadesDoPlano(plano("sulamerica-direto-nacional"));
  assert.equal(sula.length, 25);
  assert.deepEqual(sula[0], { sigla: "ANAPROLIE", publico: "Médicos, dentistas, direito, enfermagem, engenharia e outras (tabela 002)" });
  assert.deepEqual(sula.find((e) => e.sigla === "AMB Magistrados"), { sigla: "AMB Magistrados", publico: "Associação dos Magistrados Brasileiros" });
  assert.deepEqual(entidadesDoPlano({ entidades: "ABC\n  \nXYZ - Médicos" }), [{ sigla: "ABC", publico: "" }, { sigla: "XYZ", publico: "Médicos" }]);
});

test("o plano selecionado traz a administradora e a entidade escolhida; com uma entidade só, ela já vem escolhida", () => {
  const hap = plano("hapvida-nosso-plano-total"), sula = plano("sulamerica-direto-nacional");
  assert.equal(adesaoDoPlano(hap).administradora, "Affix");
  assert.equal(adesaoDoPlano(hap).entidade, null);
  assert.deepEqual(adesaoDoPlano(hap, { [hap.id]: { entidade: "unipro" } }).entidade, { sigla: "UNIPRO", publico: "Profissionais liberais" });
  // Com várias entidades, nenhuma vem escolhida; com uma só (tabela 001 da ANAPROLIE), ela já vem.
  assert.equal(adesaoDoPlano(sula).entidade, null);
  assert.equal(adesaoDoPlano(sula, { [sula.id]: { entidade: "aasp" } }).entidade.sigla, "AASP");
  const sula001 = plano("sulamerica-direto-nacional-anaprolie-001");
  assert.equal(adesaoDoPlano(sula001).entidade.sigla, "ANAPROLIE");
  // "Nenhuma" escolhida de propósito fica sem entidade.
  assert.equal(adesaoDoPlano(sula001, { [sula001.id]: { entidade: "" } }).entidade, null);
  // Entidade que o plano não aceita não vale.
  assert.equal(adesaoDoPlano(hap, { [hap.id]: { entidade: "ANAPROLIE" } }).entidade, null);
  // Plano CNPJ não tem administradora.
  assert.deepEqual(adesaoDoPlano(plano("plam-total-cnpj")), { administradora: "", entidades: [], entidade: null });
});

test("a mensagem e a proposta não citam a administradora nem a entidade, mas usam o preço do plano escolhido", () => {
  const hap = plano("hapvida-nosso-plano-total");
  const vidas = [0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
  const over = { [hap.id]: { entidade: "UNIPRO" } };
  const msg = buildMsg({ items: [hap], vidas, over, nome: "Maria", corretor: { nome: "", fone: "", empresa: "" }, opts: {} });
  assert.ok(!msg.includes("Administradora") && !msg.includes("UNIPRO"));
  assert.ok(msg.includes("R$"));
  const html = renderizarProposta(montarSnapshot(hap, { vidas, over, cliente: "Maria", opts: {} }, { nome: "", fone: "", empresa: "" }));
  assert.ok(!html.includes("Administradora") && !html.includes("UNIPRO"));
});

test("ao atualizar, os planos recebem administradora e entidades; o que foi editado à mão fica", (t) => {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-adesao-"));
  t.after(() => rmSync(pasta, { recursive: true, force: true }));
  const caminho = join(pasta, "c.db");
  const antigo = new Banco(caminho, seed);
  antigo.db.exec("UPDATE planos SET administradora = '', entidades = ''; UPDATE planos SET administradora = 'Outra' WHERE id = 'plam-saude-pf'; PRAGMA user_version = 64");
  antigo.fechar();
  const novo = new Banco(caminho, seed);
  try {
    assert.equal(novo.obterPlano("sulamerica-direto-nacional").administradora, "Qualicorp");
    assert.equal(novo.obterPlano("sulamerica-direto-nacional").entidades, plano("sulamerica-direto-nacional").entidades);
    assert.equal(novo.obterPlano("plam-saude-pf").administradora, "Outra");
    // Gravar o plano guarda os dois campos.
    const p = novo.obterPlano("aurora-saude-pf");
    novo.gravarPlano(p.id, { ...p, entidades: "ABC – Teste" });
    assert.equal(novo.obterPlano(p.id).entidades, "ABC – Teste");
  } finally {
    novo.fechar();
  }
});

test("Amil por adesão (Supermed) tem as entidades ASPROLI e AAFP; ao atualizar, o banco recebe as duas", (t) => {
  const amil = pf.filter((p) => p.id.startsWith("amil-"));
  assert.equal(amil.length, 8);
  for (const p of amil) {
    assert.equal(p.administradora, "Supermed");
    assert.deepEqual(entidadesDoPlano(p), [{ sigla: "ASPROLI", publico: "Profissionais liberais" }, { sigla: "AAFP", publico: "Servidores públicos" }]);
  }
  const pasta = mkdtempSync(join(tmpdir(), "cotador-amil-"));
  t.after(() => rmSync(pasta, { recursive: true, force: true }));
  const caminho = join(pasta, "c.db");
  const antigo = new Banco(caminho, seed);
  antigo.db.exec("UPDATE planos SET entidades = '' WHERE id LIKE 'amil-%'; UPDATE planos SET entidades = 'XYZ – Outra' WHERE id = 'amil-ouro-parcial'; PRAGMA user_version = 65");
  antigo.fechar();
  const novo = new Banco(caminho, seed);
  try {
    assert.equal(novo.obterPlano("amil-ouro-total").entidades, "ASPROLI – Profissionais liberais\nAAFP – Servidores públicos");
    assert.equal(novo.obterPlano("amil-ouro-parcial").entidades, "XYZ – Outra");
    assert.equal(novo.obterPlano("amil-pme-prata-30").entidades, "");
  } finally {
    novo.fechar();
  }
});

test("Unimed BH por adesão: uma tabela por produto e entidade da Qualicorp, agrupadas pelo nome do plano", (t) => {
  const bh = planos.filter((p) => p.id.startsWith("unimed-bh-"));
  assert.equal(bh.length, 43);
  for (const p of bh) {
    assert.equal(p.administradora, "Qualicorp", p.id);
    assert.equal(entidadesDoPlano(p).length, 1, p.id);
    assert.ok(p.faixasEnf.every((v) => v > 0), p.id);
  }
  const porNome = Object.groupBy(bh, (p) => p.nome);
  assert.deepEqual(Object.keys(porNome).sort(), ["UNIMED BH PLENO COPART", "UNIMED BH UNIFÁCIL FLEX", "UNIMED BH UNIMAX", "UNIMED BH UNIPART FLEX", "UNIMED BH UNIPART FLEX REGIONAL"]);
  assert.equal(porNome["UNIMED BH UNIMAX"].length, 13);
  assert.equal(porNome["UNIMED BH UNIPART FLEX"].length, 15);
  // Mesmo plano, entidades diferentes, preços diferentes.
  const crp = plano("unimed-bh-unimax-crp-mg"), crn = plano("unimed-bh-unimax-crn-9-mg");
  assert.deepEqual([crp.faixasEnf[0], crn.faixasEnf[0]], [395.9, 577.46]);
  // Unifácil é só enfermaria.
  assert.ok(porNome["UNIMED BH UNIFÁCIL FLEX"].every((p) => p.faixasApto.every((v) => v == null)));
  // Bancos existentes recebem os planos novos.
  const pasta = mkdtempSync(join(tmpdir(), "cotador-unimedbh-"));
  t.after(() => rmSync(pasta, { recursive: true, force: true }));
  const caminho = join(pasta, "c.db");
  const antigo = new Banco(caminho, seed);
  antigo.db.exec("DELETE FROM planos WHERE id LIKE 'unimed-bh-%'; PRAGMA user_version = 66");
  antigo.fechar();
  const novo = new Banco(caminho, seed);
  try {
    assert.equal(novo.obterPlano("unimed-bh-unipart-flex-2-afae").entidades, "AFAE – Funcionários aposentados de MG · Flex 2, com coparticipação na internação");
    assert.equal(novo.listarPlanos().filter((p) => p.id.startsWith("unimed-bh-")).length, 43);
  } finally {
    novo.fechar();
  }
});

test("SulAmérica por adesão: a tabela das 24 entidades e da ANAPROLIE 002, o Clássico 100 e a tabela 001 da ANAPROLIE", (t) => {
  const sula = planos.filter((p) => p.id.startsWith("sulamerica-"));
  assert.equal(sula.length, 10);
  const porNome = Object.groupBy(sula, (p) => p.nome);
  assert.deepEqual(Object.values(porNome).map((v) => v.length), [2, 2, 2, 2, 2]);
  // A tabela 001 é 20% mais cara para titular sozinho ou com 1 dependente.
  const d2 = plano("sulamerica-direto-nacional"), d1 = plano("sulamerica-direto-nacional-anaprolie-001");
  assert.deepEqual([d2.faixasEnf[0], d1.faixasEnf[0], d1.faixasEnfFamilia[0]], [219.83, 263.8, 219.83]);
  // Clássico 100: só enfermaria e fora do Triângulo Mineiro.
  const classico = plano("sulamerica-classico-100");
  assert.deepEqual([classico.faixasEnf[0], classico.faixasEnfFamilia[0]], [301.83, 251.53]);
  assert.ok(classico.faixasApto.every((v) => v == null));
  assert.ok(!vendidoEm(classico, "MG", "Uberlândia") && vendidoEm(classico, "MG", "Belo Horizonte"));
  assert.ok(!classico.rede.includes("Mater Dei") && !classico.rede.includes("Labclass"));
  // Banco existente: a entidade antiga vira a lista nova; os planos novos entram.
  const pasta = mkdtempSync(join(tmpdir(), "cotador-sula-"));
  t.after(() => rmSync(pasta, { recursive: true, force: true }));
  const caminho = join(pasta, "c.db");
  const antigo = new Banco(caminho, seed);
  antigo.db.exec("DELETE FROM planos WHERE id LIKE 'sulamerica-classico%' OR id LIKE '%-anaprolie-001'; UPDATE planos SET entidades = 'ANAPROLIE – Profissionais liberais', descricao = '' WHERE id LIKE 'sulamerica-%'; UPDATE planos SET entidades = 'XYZ – Editada' WHERE id = 'sulamerica-executivo-pleno'; PRAGMA user_version = 67");
  antigo.fechar();
  const novo = new Banco(caminho, seed);
  try {
    assert.equal(novo.obterPlano("sulamerica-especial-100-rc").entidades, plano("sulamerica-especial-100-rc").entidades);
    assert.equal(novo.obterPlano("sulamerica-executivo-pleno").entidades, "XYZ – Editada");
    assert.equal(novo.listarPlanos().filter((p) => p.id.startsWith("sulamerica-")).length, 10);
  } finally {
    novo.fechar();
  }
});
