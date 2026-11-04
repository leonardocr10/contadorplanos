import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { idadesParaVidas } from "../public/js/calculo.js";
import { aplicarLinks, buildLegenda, buildMsg, linkWhatsApp, mensagemDocumentos, waHtml } from "../public/js/mensagem.js";

const planos = JSON.parse(readFileSync(new URL("../dados/planos.json", import.meta.url), "utf8"));
const plano = (id) => planos.find((p) => p.id === id);
const corretor = { nome: "Diego Araújo", empresa: "Corretora", fone: "(34) 91234-5678" };

test("legenda com um plano", () => {
  const msg = buildLegenda({ items: [plano("plam-saude-pf")], nome: "Maria", corretor });
  assert.equal(msg, [
    "Olá, *Maria*!",
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
  assert.ok(msg.startsWith("Olá!\n"));
  assert.ok(!msg.includes("Tudo bem") && !msg.includes("😊"));
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

test("valor da mensalidade vem em tabela alinhada, com o valor total de cada faixa", () => {
  const p = plano("plam-saude-pf");
  const msg = buildMsg({
    items: [p], vidas: idadesParaVidas("35, 32, 30, 7"), over: {}, nome: "Maria", corretor,
    opts: { texto: true },
  });
  assert.ok(msg.startsWith("Olá, *Maria*!\n") && !msg.includes("Tudo bem") && !msg.includes("😊"));
  const bloco = msg.match(/```\n([\s\S]*?)\n```/)[1].split("\n");
  assert.match(bloco[0], /^Idade\s+Enf\. R\$\s+Apto R\$$/);
  assert.equal(bloco.length, 4);
  assert.match(bloco[2], /^29 a 33 ×2\s/);
  assert.equal(new Set(bloco.map((l) => l.length)).size, 1, "colunas alinhadas");
  assert.ok(Math.max(...bloco.map((l) => l.length)) <= 33, "cabe no celular");
  assert.ok(!msg.includes("▫"));
  const html = waHtml(msg);
  assert.ok(html.includes('<span class="wa-mono">Idade') && !html.includes("```"));
});

test("tabela de valores mostra só a acomodação com valor", () => {
  const p = { ...plano("plam-saude-pf"), faixasApto: null, apartamento: null };
  const msg = buildMsg({ items: [p], vidas: idadesParaVidas("35"), over: {}, nome: "", corretor: {}, opts: { texto: true } });
  assert.match(msg.match(/```\n(.*)\n/)[1], /^Idade\s+Enf\. R\$$/);
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

test("legenda com links traz um link por plano e não cita imagens", () => {
  const items = [plano("plam-saude-pf"), plano("amil-ouro-total")];
  const msg = buildLegenda({ items, nome: "", corretor: {}, links: true });
  assert.ok(msg.includes("[link PLAM SAÚDE]") && msg.includes("[link AMIL OURO]"));
  const final = aplicarLinks(msg, [{ nome: "PLAM SAÚDE", url: "https://x/p/a" }, { nome: "AMIL OURO", url: "https://x/p/b" }]);
  assert.ok(final.includes("https://x/p/a") && final.includes("https://x/p/b"));
  assert.ok(!final.includes("[link "));
  const completo = buildMsg({ items, vidas: idadesParaVidas("35"), over: {}, nome: "", corretor: {}, links: true, opts: { texto: true } });
  assert.ok(completo.includes("[link AMIL OURO]"));
  assert.doesNotMatch(completo, /imagens? estão/);
});

test("mensagem de documentos lista um documento por linha e traz a assinatura", () => {
  const msg = mensagemDocumentos({ cliente: "Maria", plano: "PLAM SAÚDE", acomodacao: "Apartamento", documentos: ["RG", "CPF"], corretor });
  assert.match(msg, /aceite da proposta do plano \*PLAM SAÚDE\* \(Apartamento\)/);
  assert.ok(msg.includes("• RG\n• CPF"));
  assert.ok(msg.endsWith("(34) 91234-5678"));
});

test("filtro dos selects ignora acentos e maiúsculas e procura também no grupo", async () => {
  const { filtrarOpcoes, normalizar } = await import("../public/js/filtro-select.js");
  assert.equal(normalizar(" PLAM Saúde "), "plam saude");
  const opcoes = [{ texto: "PLAM SAÚDE", grupo: "Pessoa física" }, { texto: "AMIL OURO", grupo: "Pessoa física" }, { texto: "Plano X", grupo: "CNPJ" }];
  assert.deepEqual(filtrarOpcoes(opcoes, "saude").map((o) => o.texto), ["PLAM SAÚDE"]);
  assert.deepEqual(filtrarOpcoes(opcoes, "cnpj").map((o) => o.texto), ["Plano X"]);
  assert.deepEqual(filtrarOpcoes([{ texto: "Unimed – carências" }, { texto: "Unimed – coparticipação" }], "unimed car").map((o) => o.texto), ["Unimed – carências"]);
  assert.equal(filtrarOpcoes(opcoes, "").length, 3);
  assert.equal(filtrarOpcoes(opcoes, "nada").length, 0);
});

test("prévia escapa HTML e aplica negrito", () => {
  assert.equal(waHtml("*<b>*"), "<b>&lt;b&gt;</b>");
});
