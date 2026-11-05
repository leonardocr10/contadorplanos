import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lerArea, locaisDosPlanos, vendidoEm } from "../public/js/calculo.js";
import { Banco } from "../server/db.js";
import { criarApp } from "../server/app.js";

const raiz = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const seed = join(raiz, "dados", "planos.json");
const planos = JSON.parse(readFileSync(seed, "utf8"));
const nomesEm = (uf, cidade) => planos.filter((p) => vendidoEm(p, uf, cidade)).map((p) => p.id);

test("lê a área por estado e aponta linhas fora do formato", () => {
  const { estados, invalidas } = lerArea("MG: Uberlândia, Araguari.\ngo: Catalão\nUberaba\nXX: Lugar\nSP:");
  assert.deepEqual(estados, [{ uf: "MG", cidades: ["Uberlândia", "Araguari"] }, { uf: "GO", cidades: ["Catalão"] }]);
  assert.deepEqual(invalidas, ["Uberaba", "XX: Lugar", "SP:"]);
});

test("filtra por estado e cidade, sem diferenciar acento", () => {
  const p = { areaComercializacao: "MG: Uberlândia\nGO: Catalão" };
  assert.ok(vendidoEm(p, "", ""));
  assert.ok(vendidoEm(p, "GO", ""));
  assert.ok(vendidoEm(p, "MG", "uberlandia"));
  assert.ok(!vendidoEm(p, "MG", "Catalão"));
  assert.ok(!vendidoEm(p, "SP", ""));
});

test("plano sem área cadastrada continua aparecendo", () => {
  assert.ok(vendidoEm({ areaComercializacao: "" }, "SP", "Santos"));
});

test("todos os planos da base têm área válida", () => {
  for (const p of planos) {
    const { estados, invalidas } = lerArea(p.areaComercializacao);
    assert.deepEqual(invalidas, [], p.id);
    assert.ok(estados.length, p.id);
  }
});

test("as tabelas definem quais planos aparecem em cada cidade", () => {
  // Uberlândia está na área de todos os planos atuais.
  assert.equal(nomesEm("MG", "Uberlândia").length, planos.length);
  // Só a tabela Union da Plamedh chega a Goiás.
  assert.deepEqual(nomesEm("GO", ""), ["plamedh-pf", "plamedh-kids-pf"]);
  assert.deepEqual(nomesEm("GO", "Catalão"), ["plamedh-pf", "plamedh-kids-pf"]);
  const uberaba = nomesEm("MG", "Uberaba");
  assert.ok(uberaba.includes("plamedh-basic-pme") && uberaba.includes("amil-ouro-total") && uberaba.includes("sulamerica-direto-nacional"));
  assert.ok(!uberaba.includes("plam-saude-pf") && !uberaba.includes("plamedh-pf") && !uberaba.includes("unimed-pleno-on-pf"));
  // Belo Horizonte: Amil e SulAmérica.
  assert.ok(nomesEm("MG", "Belo Horizonte").every((id) => /^(amil|sulamerica)-/.test(id)));
  assert.equal(nomesEm("MG", "Cidade Que Não Existe").length, 0);
});

test("lista estados e cidades uma vez só, em ordem", () => {
  const locais = locaisDosPlanos([{ areaComercializacao: "MG: Uberlândia, Araguari\nGO: Catalão" }, { areaComercializacao: "MG: Uberlandia, Prata" }, { areaComercializacao: "" }]);
  assert.deepEqual(locais.map((l) => l.nome), ["Goiás", "Minas Gerais"]);
  assert.deepEqual(locais[1].cidades, ["Araguari", "Prata", "Uberlândia"]);
});

test("ao atualizar, preenche a área sem apagar a informada nem mexer em plano próprio", (t) => {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-area-"));
  t.after(() => rmSync(pasta, { recursive: true, force: true }));
  const caminho = join(pasta, "c.db");
  const antigo = new Banco(caminho, seed);
  antigo.gravarPlano("meu-plano", { ...planos[0], id: "meu-plano", nome: "MEU PLANO", areaComercializacao: "" });
  antigo.db.exec("UPDATE planos SET area_comercializacao = ''");
  antigo.db.exec("UPDATE planos SET area_comercializacao = 'MG: Prata' WHERE id = 'plamedh-pf'");
  antigo.db.exec("PRAGMA user_version = 11");
  antigo.fechar();
  const novo = new Banco(caminho, seed);
  assert.equal(novo.obterPlano("plam-saude-pf").areaComercializacao, "MG: Uberlândia");
  assert.equal(novo.obterPlano("plamedh-pf").areaComercializacao, "MG: Prata");
  assert.equal(novo.obterPlano("meu-plano").areaComercializacao, "");
  novo.fechar();
});

test("a API recusa área fora do formato e guarda a válida", async (t) => {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-area-"));
  const banco = new Banco(join(pasta, "c.db"), seed);
  const app = criarApp({ banco, pastaPublica: join(raiz, "public"), pastaUploads: join(pasta, "u"), pastaBackups: join(pasta, "b"), env: {} });
  const servidor = await new Promise((ok) => { const s = app.listen(0, "127.0.0.1", () => ok(s)); });
  t.after(() => new Promise((fim) => { servidor.closeAllConnections(); servidor.close(() => { banco.fechar(); rmSync(pasta, { recursive: true, force: true }); fim(); }); }));
  const url = `http://127.0.0.1:${servidor.address().port}/api/planos`;
  const enviar = (areaComercializacao) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome: "NOVO", categoria: "PF", areaComercializacao }) });
  const ruim = await enviar("Uberlândia e Araguari");
  assert.equal(ruim.status, 400);
  assert.match((await ruim.json()).erro ?? "", /MG: Uberlândia/);
  const bom = await enviar("MG: Uberlândia");
  assert.ok(bom.ok);
  assert.ok(banco.listarPlanos().some((p) => p.nome === "NOVO" && p.areaComercializacao === "MG: Uberlândia"));
});
