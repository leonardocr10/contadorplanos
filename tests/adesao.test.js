// Administradora e entidade dos planos de pessoa física por adesão: cadastro e escolha no plano selecionado (não aparecem na mensagem nem na proposta).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adesaoDoPlano, entidadesDoPlano } from "../public/js/calculo.js";
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
  assert.deepEqual(entidadesDoPlano(plano("sulamerica-direto-nacional")), [{ sigla: "ANAPROLIE", publico: "Profissionais liberais" }]);
  assert.deepEqual(entidadesDoPlano({ entidades: "ABC\n  \nXYZ - Médicos" }), [{ sigla: "ABC", publico: "" }, { sigla: "XYZ", publico: "Médicos" }]);
});

test("o plano selecionado traz a administradora e a entidade escolhida; com uma entidade só, ela já vem escolhida", () => {
  const hap = plano("hapvida-nosso-plano-total"), sula = plano("sulamerica-direto-nacional");
  assert.equal(adesaoDoPlano(hap).administradora, "Affix");
  assert.equal(adesaoDoPlano(hap).entidade, null);
  assert.deepEqual(adesaoDoPlano(hap, { [hap.id]: { entidade: "unipro" } }).entidade, { sigla: "UNIPRO", publico: "Profissionais liberais" });
  assert.equal(adesaoDoPlano(sula).entidade.sigla, "ANAPROLIE");
  // "Nenhuma" escolhida de propósito fica sem entidade.
  assert.equal(adesaoDoPlano(sula, { [sula.id]: { entidade: "" } }).entidade, null);
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
    assert.equal(novo.obterPlano("sulamerica-direto-nacional").entidades, "ANAPROLIE – Profissionais liberais");
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
