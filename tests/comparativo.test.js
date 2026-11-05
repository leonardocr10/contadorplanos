import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Banco } from "../server/db.js";
import { criarApp } from "../server/app.js";
import { montarRede, renderizarComparativo } from "../server/comparativo-html.js";
import { montarSnapshot, paraProposta } from "../server/proposta-html.js";

const raiz = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const seed = join(raiz, "dados", "planos.json");
const planos = JSON.parse(readFileSync(seed, "utf8"));
const plano = (id) => planos.find((p) => p.id === id);
const corretor = { nome: "Consultor", fone: "34999990000", empresa: "Corretora" };
const pedido = { vidas: [2, 0, 0, 0, 0, 0, 0, 0, 0, 0], over: {}, cliente: "Maria", opts: { copart: true, rede: true, acom: true } };
const snapshot = (id) => montarSnapshot(plano(id), pedido, corretor);
const comparar = (...ids) => renderizarComparativo(ids.map(snapshot));

// Valores de uma linha da tabela, sem as marcações.
function celulas(html, titulo) {
  const linha = html.match(new RegExp(`<tr[^>]*><th scope="row">${titulo}</th>(.*?)</tr>`));
  assert.ok(linha, `linha ${titulo} não encontrada`);
  return [...linha[1].matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

test("compara valores e destaca só o menor de cada acomodação", () => {
  const html = comparar("plam-saude-pf", "amil-ouro-total", "unimed-udiplan-on-pf");
  assert.deepEqual(celulas(html, "Enfermaria"), ["R$ 346,06 menor valor", "R$ 725,30", "R$ 526,36"]);
  assert.deepEqual(celulas(html, "Apartamento"), ["R$ 543,48 menor valor", "R$ 805,10", "R$ 679,38"]);
  assert.deepEqual(celulas(html, "Taxa associativa"), ["R$ 7,00", "—", "R$ 4,00"]);
  for (const logo of ["plam", "amil", "unimed"]) assert.ok(html.includes(`/img/logo-${logo}.png`));
  assert.ok(html.includes("Maria"));
});

test("valores iguais não recebem destaque", () => {
  const html = comparar("plam-saude-pf", "plamedh-pf");
  assert.deepEqual(celulas(html, "Enfermaria"), ["R$ 346,06", "R$ 346,06"]);
});

test("encontra a mesma coparticipação nas tabelas de cada operadora", () => {
  const html = comparar("plam-saude-pf", "amil-ouro-total", "unimed-udiplan-on-pf", "sulamerica-especial-100-rc");
  assert.deepEqual(celulas(html, "Consulta").slice(0, 3), ["R$ 30,00", "30%, até R$ 30,00", "R$ 40,00"]);
  assert.deepEqual(celulas(html, "Pronto-socorro").slice(0, 3), ["R$ 50,00", "40%, até R$ 90,00", "R$ 55,00"]);
  assert.deepEqual(celulas(html, "Internação em enfermaria"), ["R$ 245,00", "R$ 220,00", "R$ 100,00", "R$ 872,08"]);
  assert.deepEqual(celulas(html, "Internação em apartamento"), ["R$ 330,00", "R$ 220,00", "R$ 150,00", "R$ 872,08"]);
  assert.equal(celulas(html, "Situação considerada")[0], "Padrão");
});

test("plano só com enfermaria não ganha valor de apartamento na coparticipação", () => {
  assert.deepEqual(celulas(comparar("plamedh-basic-pme", "plam-total-cnpj"), "Internação em apartamento")[0], "—");
});

test("carências usam a primeira situação de cada plano", () => {
  const html = comparar("plam-saude-pf", "amil-ouro-total", "plamedh-basic-pme");
  assert.deepEqual(celulas(html, "Situação considerada")[2], "Padrão");
  assert.deepEqual(celulas(html, "Consulta").length, 3);
  // Na Amil, "não relacionada a doenças preexistentes" não é a linha de preexistência.
  assert.equal(celulas(html, "Preexistência")[1], "—");
  assert.equal(celulas(html, "Parto")[1], "300 dias");
  assert.equal(celulas(html, "Terapias").at(-1) !== undefined, true);
});

test("a rede junta os nomes diferentes do mesmo hospital", () => {
  const propostas = ["unimed-udiplan-on-pf", "sulamerica-especial-100-rc", "plamedh-pf"].map((id) => paraProposta(snapshot(id)));
  const rede = montarRede(propostas);
  const umc = rede.filter((r) => /UMC|Medical Center/.test(r.nome));
  assert.equal(umc.length, 1);
  assert.deepEqual([...umc[0].planos], [0, 1, 2]);
  assert.equal(rede[0].planos.size, 3);
  assert.equal(rede.filter((r) => /Madrecor/.test(r.nome)).length, 1);
});

test("Hospital de Clínicas do Triângulo e Hospital do Triângulo são o mesmo hospital", () => {
  const propostas = ["plam-saude-pf", "amil-ouro-total"].map((id) => paraProposta(snapshot(id)));
  const triangulo = montarRede(propostas).filter((r) => /Hospital.*Triângulo/.test(r.nome) && !/^Laboratório/.test(r.nome));
  assert.equal(triangulo.length, 1);
  assert.deepEqual([...triangulo[0].planos], [0, 1]);
});

test("plano sem rede cadastrada não aparece como se não tivesse o hospital", () => {
  const html = comparar("amil-ouro-total", "amil-platinum-r1-total");
  assert.equal(celulas(html, "Hospital Madrecor")[1], "Não informada");
});

test("rota do comparativo aceita de 2 a 4 planos e não salva nada", async (t) => {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-cmp-"));
  const banco = new Banco(join(pasta, "c.db"), seed);
  const app = criarApp({ banco, pastaPublica: join(raiz, "public"), pastaUploads: join(pasta, "u"), pastaBackups: join(pasta, "b"), env: {} });
  const servidor = await new Promise((ok) => { const s = app.listen(0, "127.0.0.1", () => ok(s)); });
  t.after(() => new Promise((fim) => { servidor.closeAllConnections(); servidor.close(() => { banco.fechar(); rmSync(pasta, { recursive: true, force: true }); fim(); }); }));
  const enviar = (ids) => fetch(`http://127.0.0.1:${servidor.address().port}/api/propostas/comparativo`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...pedido, planos: ids }),
  });
  const certo = await enviar(["plam-saude-pf", "amil-ouro-total"]);
  assert.equal(certo.status, 200);
  assert.match((await certo.json()).html, /Comparativo de planos/);
  assert.equal((await enviar(["plam-saude-pf"])).status, 400);
  assert.equal((await enviar(planos.slice(0, 5).map((p) => p.id))).status, 400);
  assert.equal((await enviar(["plam-saude-pf", "nao-existe"])).status, 400);
  assert.equal(banco.listarCotacoes({ fone: "", q: "", status: "" }).length, 0);
});
