import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { idadesParaVidas } from "../public/js/calculo.js";
import { buildLegenda, buildMsg, linkWhatsApp, waHtml } from "../public/js/mensagem.js";
import { themeFor } from "../public/js/proposta.js";

const planos = JSON.parse(readFileSync(new URL("../dados/planos.json", import.meta.url), "utf8"));
const plano = (id) => planos.find((p) => p.id === id);
const corretor = { nome: "Diego Araújo", empresa: "Corretora", fone: "(34) 91234-5678" };

test("legenda com um plano", () => {
  const msg = buildLegenda({ items: [plano("plam-saude-pf")], nome: "Maria", corretor });
  assert.equal(msg, [
    "Olá, *Maria*! Tudo bem? 😊",
    "",
    "Segue a sua proposta do plano *PLAM SAÚDE*, com valores, coparticipação, carências e rede credenciada.",
    "",
    "*Diego Araújo*",
    "Corretora",
    "(34) 91234-5678",
  ].join("\n"));
});

test("legenda com 2 planos", () => {
  const msg = buildLegenda({ items: [plano("plam-saude-pf"), plano("amil-ouro-total")], nome: "", corretor: {} });
  assert.match(msg, /dos planos \*PLAM SAÚDE\* e \*AMIL OURO\*/);
  assert.ok(msg.startsWith("Olá! Tudo bem?"));
});

test("legenda com 3 planos", () => {
  const msg = buildLegenda({ items: [plano("plam-saude-pf"), plano("plamedh-pf"), plano("amil-ouro-total")], nome: "", corretor: {} });
  assert.match(msg, /dos planos \*PLAM SAÚDE\*, \*PLAMEDH\* e \*AMIL OURO\*/);
});

test("texto completo traz totais e não traz a observação do plano", () => {
  const p = plano("plam-saude-pf");
  const msg = buildMsg({
    items: [p], vidas: idadesParaVidas("35, 32, 7"), over: {}, nome: "Maria", corretor,
    opts: { texto: true, copart: true, rede: true, acom: true },
  });
  assert.match(msg, /Total Enfermaria: R\$ 769,76/);
  assert.match(msg, /Total Apartamento: R\$ 1\.198,87/);
  assert.match(msg, /R\$ 7,00 de taxa associativa/);
  if (p.descricao) assert.ok(!msg.includes(p.descricao));
});

test("benefícios só saem no texto completo dos planos com mostrarExtras", () => {
  const opts = { texto: true, copart: false, rede: false, acom: false };
  const base = { vidas: idadesParaVidas("35"), over: {}, nome: "", corretor: {}, opts };
  assert.match(buildMsg({ ...base, items: [plano("amil-ouro-total")] }), /Benefícios do plano/);
  assert.doesNotMatch(buildMsg({ ...base, items: [plano("plam-saude-pf")] }), /Benefícios do plano/);
});

test("link do WhatsApp preserva os emojis e não passa pelo wa.me", () => {
  const url = new URL(linkWhatsApp("34999990000", "Olá 😊 ✅"));
  assert.equal(url.hostname, "api.whatsapp.com");
  assert.equal(url.searchParams.get("phone"), "5534999990000");
  assert.equal(url.searchParams.get("text"), "Olá 😊 ✅");
  assert.ok(url.search.includes("%F0%9F%98%8A"));
  assert.equal(new URL(linkWhatsApp("", "Oi")).searchParams.has("phone"), false);
});

test("prévia escapa HTML e aplica negrito", () => {
  assert.equal(waHtml("*<b>*"), "<b>&lt;b&gt;</b>");
});

test("tema usa as cores da operadora", () => {
  const t = themeFor(plano("plam-saude-pf"));
  assert.equal(t.band, "#00564d");
  assert.equal(t.thead, "#007e70");
  // A cor principal da PLAMEDH é clara, então os títulos usam a cor escura.
  assert.equal(themeFor(plano("plamedh-pf")).accent, "#0f5fb3");
});
