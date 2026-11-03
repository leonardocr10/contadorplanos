import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { brl, colarPlanilha, faixaDe, fmtFone, idadesParaVidas, normFone, parseBRL, planPrices } from "../public/js/calculo.js";

const planos = JSON.parse(readFileSync(new URL("../dados/planos.json", import.meta.url), "utf8"));
const plano = (id) => planos.find((p) => p.id === id);

test("faixaDe segue as faixas da ANS", () => {
  const casos = [[0, 0], [18, 0], [19, 1], [23, 1], [24, 2], [33, 3], [34, 4], [58, 8], [59, 9], [80, 9]];
  for (const [idade, faixa] of casos) assert.equal(faixaDe(idade), faixa, `idade ${idade}`);
});

test("idades digitadas viram contagens por faixa", () => {
  assert.deepEqual(idadesParaVidas("35, 32, 7"), [1, 0, 0, 1, 1, 0, 0, 0, 0, 0]);
  assert.deepEqual(idadesParaVidas(""), Array(10).fill(0));
  assert.deepEqual(idadesParaVidas("200"), Array(10).fill(0));
});

test("PLAM SAÚDE com idades 35, 32 e 7", () => {
  const v = planPrices(plano("plam-saude-pf"), idadesParaVidas("35, 32, 7"));
  assert.equal(brl(v.enf), "769,76");
  assert.equal(brl(v.apto), "1.198,87");
});

test("AMIL OURO (coparticipação total) com idades 35, 32 e 7", () => {
  const v = planPrices(plano("amil-ouro-total"), idadesParaVidas("35, 32, 7"));
  assert.equal(brl(v.enf), "1.636,09");
  assert.equal(brl(v.apto), "1.816,05");
});

test("faixa sem valor deixa a acomodação sem total", () => {
  const v = planPrices(plano("amil-platinum-r1-total"), idadesParaVidas("35"));
  assert.equal(v.enf, null);
  assert.ok(v.apto > 0);
});

test("sem idades usa os valores de referência, editáveis por cotação", () => {
  const p = plano("plam-saude-pf"), vazio = Array(10).fill(0);
  assert.equal(planPrices(p, vazio).apto, 1168.14);
  assert.equal(planPrices(p, vazio, { [p.id]: { apto: 1000 } }).apto, 1000);
});

test("parseBRL aceita os formatos de moeda", () => {
  assert.equal(parseBRL("R$ 1.168,14"), 1168.14);
  assert.equal(parseBRL("1168,14"), 1168.14);
  assert.equal(parseBRL(""), null);
  assert.equal(parseBRL(null), null);
});

test("Colar da planilha com 10 linhas preenche as 10 faixas", () => {
  const faixas = ["De 0 a 18 anos", "De 19 a 23", "De 24 a 28", "De 29 a 33", "De 34 a 38", "De 39 a 43", "De 44 a 48", "De 49 a 53", "De 54 a 58", "59 ou mais"];
  const texto = faixas.map((f, i) => `${f}\tR$ ${171 + i},20\tR$ 1.${100 + i},04`).join("\r\n");
  const linhas = colarPlanilha(texto);
  assert.equal(linhas.length, 10);
  assert.deepEqual(linhas[0], { enf: "171,20", apto: "1.100,04" });
  assert.deepEqual(linhas[9], { enf: "180,20", apto: "1.109,04" });
});

test("número do cliente fica só com dígitos e sem o 55", () => {
  assert.equal(normFone("+55 (34) 99999-0000"), "34999990000");
  assert.equal(normFone("(55) 99999-0000"), "55999990000");
  assert.equal(fmtFone("34999990000"), "(34) 99999-0000");
});
