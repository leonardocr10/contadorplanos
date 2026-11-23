// Administradora e entidade dos planos de pessoa física por adesão: cadastro, filtro da cotação e mensagem.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aceitaAdesao, administradorasDosPlanos, entidadesDoPlano } from "../public/js/calculo.js";
import { buildMsg } from "../public/js/mensagem.js";
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

test("a cotação filtra pela administradora e pela entidade, sem diferenciar acento e maiúscula", () => {
  const ids = (adm, ent) => pf.filter((p) => aceitaAdesao(p, adm, ent)).map((p) => p.id);
  assert.equal(ids("", "").length, pf.length);
  assert.deepEqual(ids("qualicorp", ""), pf.filter((p) => p.id.startsWith("sulamerica-")).map((p) => p.id));
  assert.deepEqual(ids("Affix", "unipro"), ["hapvida-nosso-plano-total", "hapvida-nosso-plano-parcial"]);
  assert.deepEqual(ids("", "CAEEPP"), ["hapvida-nosso-plano-uberaba-total", "hapvida-nosso-plano-uberaba-parcial"]);
  // Entidade de outra administradora não mostra nada.
  assert.deepEqual(ids("Qualicorp", "UNIPRO"), []);
});

test("as administradoras da cotação trazem as entidades de cada uma, com quantos planos aceitam", () => {
  const adms = administradorasDosPlanos(pf);
  assert.deepEqual(adms.map((a) => a.nome), ["Affix", "Allcare", "Quali", "Qualicorp", "Supermed", "Unicor", "Union"]);
  const affix = adms.find((a) => a.nome === "Affix");
  assert.equal(affix.planos, 2);
  assert.deepEqual(affix.entidades.map((e) => [e.sigla, e.planos]), [["ANSP", 2], ["ASCOSERVI", 2], ["FADESP", 2], ["FNEL", 2], ["UNIPRO", 2]]);
  assert.deepEqual(adms.find((a) => a.nome === "Unicor").entidades.map((e) => e.sigla), ["CAEEPP"]);
});

test("a mensagem só cita administradora e entidade quando a cotação escolheu", () => {
  const base = { items: [plano("hapvida-nosso-plano-total")], vidas: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0], over: {}, nome: "Maria", corretor: { nome: "", fone: "", empresa: "" }, opts: {} };
  assert.ok(!buildMsg(base).includes("Administradora"));
  assert.ok(buildMsg({ ...base, administradora: "Affix" }).includes("🏛️ Administradora *Affix*\n"));
  assert.ok(buildMsg({ ...base, administradora: "Affix", entidade: "UNIPRO" }).includes("🏛️ Administradora *Affix* · Entidade *UNIPRO* (Profissionais liberais)"));
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
