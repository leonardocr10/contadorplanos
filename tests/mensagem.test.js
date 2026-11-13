import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { idadesParaVidas } from "./apoio.js";
import { buildMsg, linkConversaDireta, linkWhatsApp, textoDosLinks, mensagemDocumentos, mensagemDocumentosDoPlano, waHtml } from "../public/js/mensagem.js";

const planos = JSON.parse(readFileSync(new URL("../dados/planos.json", import.meta.url), "utf8"));
const plano = (id) => planos.find((p) => p.id === id);
const corretor = { nome: "Diego Araújo", empresa: "Corretora", fone: "(34) 91234-5678" };

const OPTS = { copart: true, rede: true, acom: true };
const CORRETOR = { nome: "Diego Araújo", empresa: "Corretora Exemplo", fone: "(34) 99999-1234" };
const COPART_MODELO = "Você paga a mensalidade normalmente e, caso utilize consultas, exames ou procedimentos, paga apenas um pequeno valor conforme a tabela de coparticipação. Esses valores vêm no boleto do mês seguinte.";
const montar = (ids, idades, extra = {}) => buildMsg({ items: ids.map(plano), vidas: idadesParaVidas(idades), over: {}, nome: "Maria", corretor: CORRETOR, opts: OPTS, ...extra });

test("teste 1: PLAM SAÚDE é idêntico ao modelo", () => {
  // O texto da coparticipação vem do cadastro do plano; aqui usa o do modelo.
  const msg = buildMsg({ items: [{ ...plano("plam-saude-pf"), copartTexto: COPART_MODELO }], vidas: idadesParaVidas("7"), over: {}, nome: "Maria", corretor: CORRETOR, opts: OPTS });
  assert.equal(msg, [
    "Olá, *Maria*! Tudo bem? 😊",
    "Preparamos esta proposta para que você conheça as condições do plano *PLAM SAÚDE*.",
    "",
    "━━━━━━━━━━━━━━",
    "🏥 *PLAM SAÚDE*",
    "_Plam Total Adesão – plano com coparticipação_",
    "",
    "💰 *Valor da mensalidade* (1 vida)",
    "▫️ 0 a 18 anos: Enf. R$ 173,03 · Apto R$ 271,74",
    "",
    "✅ *Total Enfermaria: R$ 173,03*",
    "✅ *Total Apartamento: R$ 271,74*",
    "➕ R$ 7,00 de taxa associativa",
    "",
    "🏨 *Rede Credenciada*",
    "• Hospital de Clínicas do Triângulo",
    "• Hospital Santa Marta",
    "• Hospital Madrecor",
    "• Laboratório Exame",
    "• Laboratório Exame – Unidade Hospital do Triângulo",
    "━━━━━━━━━━━━━━",
    "",
    "❓ *Como funciona a coparticipação?*",
    COPART_MODELO,
    "",
    "_*Enfermaria: acomodação compartilhada._",
    "_*Apartamento: acomodação individual._",
    "",
    "📎 As tabelas de coparticipação e carência seguem na imagem.",
    "",
    "*Diego Araújo*",
    "Corretora Exemplo · (34) 99999-1234",
  ].join("\n"));
});

test("teste 2: idades 35, 32 e 7", () => {
  const msg = montar(["plam-saude-pf"], "35, 32, 7");
  for (const f of ["▫️ 0 a 18 anos", "▫️ 29 a 33 anos", "▫️ 34 a 38 anos"]) assert.ok(msg.includes(f), f);
  assert.ok(msg.includes("✅ *Total Enfermaria: R$ 769,76*") && msg.includes("✅ *Total Apartamento: R$ 1.198,87*"));
});

test("teste 3: duas pessoas na mesma faixa", () => {
  assert.ok(montar(["plam-saude-pf"], "25, 26").includes("▫️ 2× 24 a 28 anos: Enf. R$ 501,28 · Apto R$ 750,02"));
});

test("teste 4: AMIL PLATINUM R1 só com apartamento e com benefícios", () => {
  const msg = montar(["amil-platinum-r1-total"], "40");
  assert.ok(!msg.includes("Enf.") && !msg.includes("Total Enfermaria") && !msg.includes("—"));
  assert.ok(msg.includes("🎁 *Benefícios do plano*"));
});

test("teste 5: dois planos", () => {
  const msg = montar(["plam-saude-pf", "amil-ouro-total"], "35");
  assert.ok(msg.includes("dos planos *PLAM SAÚDE* e *AMIL OURO*"));
  assert.equal(msg.split("Como funciona a coparticipação?").length, 2);
  assert.ok(msg.includes("seguem nas imagens."));
});

test("cada plano mostra a sua coparticipação, e texto igual aparece uma vez", () => {
  const dois = montar(["plam-saude-pf", "amil-ouro-total"], "35");
  assert.ok(dois.includes(`*PLAM SAÚDE*\n${plano("plam-saude-pf").copartTexto}`));
  assert.ok(dois.includes(`*AMIL OURO*\n${plano("amil-ouro-total").copartTexto}`));
  const iguais = montar(["amil-prata-mg1-total", "amil-ouro-total"], "35");
  assert.equal(iguais.split(plano("amil-ouro-total").copartTexto).length, 2);
});

test("teste 6: sem nome e sem Meus dados", () => {
  const msg = montar(["plam-saude-pf"], "35", { nome: "", corretor: {} });
  assert.ok(msg.startsWith("Olá! Tudo bem? 😊\n"));
  assert.ok(msg.endsWith("seguem na imagem."));
});

test("regras: sem idades, assinatura parcial, sem link, sem descrição e sem linhas sobrando", () => {
  const p = plano("plam-saude-pf");
  const semIdades = montar(["plam-saude-pf"], "", { over: { [p.id]: { enf: 100, apto: 200 } } });
  assert.ok(semIdades.includes("✅ *Enfermaria: R$ 100,00*") && semIdades.includes("✅ *Apartamento: R$ 200,00*"));
  const vazio = buildMsg({ items: [{ ...p, faixasEnf: null, faixasApto: null, enfermaria: null, apartamento: null }], vidas: Array(10).fill(0), over: {}, nome: "", corretor: {}, opts: OPTS });
  assert.ok(vazio.includes("• Valores sob consulta"));
  assert.ok(montar(["plam-saude-pf"], "35", { corretor: { nome: "D", fone: "1" } }).endsWith("*D*\n1"));
  const msg = montar(["plam-saude-pf"], "35");
  assert.ok(!msg.includes("[link") && !msg.includes("Proposta completa"));
  if (p.descricao) assert.ok(!msg.includes(p.descricao));
  assert.ok(!/\n\n\n/.test(msg) && !/[ \t]\n/.test(msg));
});

test("link do WhatsApp preserva os emojis e não passa pelo wa.me", () => {
  const url = new URL(linkWhatsApp("34999990000", "Olá 😊 ✅"));
  assert.equal(url.hostname, "api.whatsapp.com");
  assert.equal(url.searchParams.get("phone"), "5534999990000");
  assert.equal(url.searchParams.get("text"), "Olá 😊 ✅");
  assert.ok(url.search.includes("%F0%9F%98%8A"));
  assert.equal(new URL(linkWhatsApp("", "Oi")).searchParams.has("phone"), false);
});

test("mensagem de documentos lista um documento por linha e traz a assinatura", () => {
  const msg = mensagemDocumentos({ cliente: "Maria", plano: "PLAM SAÚDE", acomodacao: "Apartamento", documentos: ["RG", "CPF"], corretor });
  assert.match(msg, /aceite da proposta do plano \*PLAM SAÚDE\* \(Apartamento\)/);
  assert.ok(msg.includes("• RG\n• CPF"));
  assert.ok(msg.endsWith("(34) 91234-5678"));
});

test("mensagem da tela Documentos lista os documentos do plano para qualquer cliente", () => {
  const msg = mensagemDocumentosDoPlano({ plano: "UNIMED", tipo: "CNPJ", documentos: ["Cartão CNPJ", "RG"], corretor });
  assert.ok(msg.startsWith("Olá! Tudo bem?"));
  assert.ok(msg.includes("contratação do plano *UNIMED* (empresarial)"));
  assert.ok(msg.includes("• Cartão CNPJ\n• RG"));
  assert.ok(msg.endsWith("(34) 91234-5678"));
  assert.ok(!mensagemDocumentosDoPlano({ plano: "PLAM SAÚDE", tipo: "PF", documentos: ["RG"], corretor: {} }).includes("empresarial"));
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

test("Copiar link: um plano traz só o endereço; vários trazem o nome de cada um", () => {
  assert.equal(textoDosLinks([{ nome: "A", url: "http://x/p/1" }]), "http://x/p/1");
  assert.equal(textoDosLinks([{ nome: "A", url: "http://x/p/1" }, { nome: "B", url: "http://x/p/2" }]), "*A*\nhttp://x/p/1\n\n*B*\nhttp://x/p/2");
});

test("observação entra na mensagem só quando marcada", () => {
  const p = { ...plano("plam-saude-pf"), descricao: "Observação de teste" };
  const base = { vidas: idadesParaVidas("35"), over: {}, nome: "", corretor: {}, opts: OPTS };
  assert.ok(!buildMsg({ ...base, items: [p] }).includes("Observação de teste"));
  assert.ok(buildMsg({ ...base, items: [{ ...p, mostrarObservacao: true }] }).includes("📝 *Observação*\nObservação de teste"));
});

test("mensagem de documentos informa o valor aceito", () => {
  const msg = mensagemDocumentos({ cliente: "Maria", plano: "PLAM SAÚDE", acomodacao: "Enfermaria", valor: 1234.5, documentos: ["RG"], corretor });
  assert.match(msg, /\(Enfermaria\), no valor de \*R\$ 1\.234,50\* por mês\./);
  assert.ok(!mensagemDocumentos({ cliente: "", plano: "X", acomodacao: "Enfermaria", documentos: [], corretor: {} }).includes("no valor"));
});

test("enviar documentos abre direto o WhatsApp Web no computador e o aplicativo no celular", () => {
  const web = new URL(linkConversaDireta("34999990000", "Olá 😊", "Mozilla/5.0 (Windows NT 10.0)"));
  assert.equal(web.hostname, "web.whatsapp.com");
  assert.equal(web.searchParams.get("phone"), "5534999990000");
  assert.equal(web.searchParams.get("text"), "Olá 😊");
  assert.equal(new URL(linkConversaDireta("34999990000", "Oi", "Mozilla/5.0 (Linux; Android 14)")).hostname, "api.whatsapp.com");
});

test("conversa direta sem número ou sem texto não deixa parâmetro vazio", () => {
  assert.equal(linkConversaDireta("", "Oi"), "https://web.whatsapp.com/send?text=Oi");
  assert.equal(linkConversaDireta("34999990000"), "https://web.whatsapp.com/send?phone=5534999990000");
});
