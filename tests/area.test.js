import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completarCarencias, gruposDeVidas, lerArea, planPrices, locaisDosPlanos, redeDaCidade, resumoDaRede, vendidoEm } from "../public/js/calculo.js";
import { buildMsg } from "../public/js/mensagem.js";
import { montarSnapshot, renderizarProposta } from "../server/proposta-html.js";
import { renderizarComparativo } from "../server/comparativo-html.js";
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

test("a rede mostra só a cidade escolhida", () => {
  const plamedh = planos.find((p) => p.id === "plamedh-pf");
  assert.deepEqual(redeDaCidade(plamedh, "Uberlândia"), ["Hospital UMC", "Hospital do Triângulo"]);
  assert.deepEqual(redeDaCidade(plamedh, "araxa"), ["Melhoramentos Dom Bosco"]);
  assert.deepEqual(redeDaCidade(plamedh, "Prata"), []);
  // Sem cidade escolhida, a rede fica completa.
  assert.equal(redeDaCidade(plamedh, "").length, 6);
});

test("linha sem cidade é da cidade do plano, e traço no nome não é cidade", () => {
  const basic = planos.find((p) => p.id === "plamedh-basic-pme");
  assert.ok(redeDaCidade(basic, "Uberlândia").includes("LABAC – Laboratório de Análises Clínicas"));
  assert.deepEqual(redeDaCidade(basic, "Uberaba"), []);
  const plam = planos.find((p) => p.id === "plam-saude-pf");
  assert.ok(redeDaCidade(plam, "Uberlândia").includes("Laboratório Exame – Unidade Hospital do Triângulo"));
});

test("a Hapvida segue a tabela: total e parcial, área, coparticipação, carências e logo", (t) => {
  const total = planos.find((p) => p.id === "hapvida-nosso-plano-total");
  const parcial = planos.find((p) => p.id === "hapvida-nosso-plano-parcial");
  assert.deepEqual([total.faixasEnf[0], total.faixasApto[0], total.faixasEnf[9], total.faixasApto[9]], [209, 274.63, 1138.78, 1529.99]);
  assert.deepEqual([parcial.faixasEnf[0], parcial.faixasApto[0], parcial.faixasEnf[9], parcial.faixasApto[9]], [294.02, 389.36, 1645.5, 2213.85]);
  for (const p of [total, parcial]) {
    assert.equal(p.faixasEnf.length, 10);
    assert.equal(p.faixasApto.length, 10);
    assert.ok(vendidoEm(p, "MG", "Uberlândia") && !vendidoEm(p, "MG", "Uberaba"));
    assert.equal(p.taxa, 10);
    assert.ok(!p.subtitulo.includes("Affix"));
  }
  const pedido = { vidas: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0], over: {}, cliente: "", opts: { copart: true, rede: true, acom: true }, municipio: "Uberlândia" };
  const corretor = { nome: "C", fone: "34999990000", empresa: "E" };
  const html = renderizarComparativo([total, parcial].map((p) => montarSnapshot(p, pedido, corretor)));
  assert.ok(html.includes("/img/logo-hapvida.png"));
  assert.ok(html.includes("R$ 209,00") && html.includes("R$ 389,36"));
  const linha = (titulo) => [...html.matchAll(new RegExp(`<th scope="row">${titulo}</th>((?:<td[^>]*>.*?</td>)+)`, "g"))][0]?.[1].match(/<td[^>]*>(.*?)<\/td>/g).map((c) => c.replace(/<[^>]+>/g, ""));
  assert.deepEqual(linha("Consulta")?.slice(0, 2), ["R$ 43,63", "—"]);
  assert.deepEqual(linha("Pronto-socorro"), ["R$ 61,82", "—"]);
  assert.equal(linha("Exames básicos")[0], "30 dias");
  assert.equal(linha("Internação")[0], "180 dias");
  assert.equal(linha("Parto")[0], "300 dias");
  assert.equal(linha("Preexistência")[0], "24 meses");
  assert.deepEqual(redeDaCidade(total, "Uberlândia"), ["Hospital e Maternidade Madrecor", "Clínica e Diagnóstico Uberlândia", "Clínica Marechal Deodoro"]);
  assert.deepEqual(redeDaCidade(parcial, "Uberlândia"), redeDaCidade(total, "Uberlândia"));
  // Com a Amil, o Madrecor aparece numa linha só, marcado nos dois planos.
  const amil = planos.find((p) => p.id === "amil-prata-mg1-total");
  const lado = renderizarComparativo([total, amil].map((p) => montarSnapshot(p, pedido, corretor)));
  assert.equal(lado.match(/Madrecor/g).length, 1);
  // O banco da versão anterior recebe a rede, e a rede já cadastrada à mão não muda.
  const pasta = mkdtempSync(join(tmpdir(), "cotador-hapvida-"));
  t.after(() => rmSync(pasta, { recursive: true, force: true }));
  const caminho = join(pasta, "c.db");
  const antigo = new Banco(caminho, seed);
  antigo.db.exec("UPDATE planos SET rede = '', taxa = NULL, subtitulo = subtitulo || ' (Affix)' WHERE id = 'hapvida-nosso-plano-total'; UPDATE planos SET rede = 'Minha rede', taxa = 12 WHERE id = 'hapvida-nosso-plano-parcial'; PRAGMA user_version = 22");
  antigo.fechar();
  const novo = new Banco(caminho, seed);
  assert.equal(novo.obterPlano("hapvida-nosso-plano-total").rede, "Hospital e Maternidade Madrecor\nClínica e Diagnóstico Uberlândia\nClínica Marechal Deodoro");
  assert.equal(novo.obterPlano("hapvida-nosso-plano-parcial").rede, "Minha rede");
  assert.equal(novo.obterPlano("hapvida-nosso-plano-total").taxa, 10);
  assert.equal(novo.obterPlano("hapvida-nosso-plano-total").subtitulo, "Coparticipação total – Enfermaria e Apartamento, coletivo por adesão");
  assert.equal(novo.obterPlano("hapvida-nosso-plano-parcial").taxa, 12);
  novo.fechar();
});

test("os planos PME da Hapvida seguem as cotações de Uberlândia e Uberaba", (t) => {
  const plano = (id) => planos.find((p) => p.id === id);
  const soma = (v) => Math.round(v.reduce((a, b) => a + b, 0) * 100) / 100;
  const ids = ["hapvida-nosso-plano-pme-total", "hapvida-nosso-plano-pme-parcial", "hapvida-nosso-plano-pme-uberaba-total", "hapvida-nosso-plano-pme-uberaba-parcial"];
  // Total de cada PDF com uma pessoa em cada faixa: enfermaria e apartamento.
  assert.deepEqual(ids.map((id) => [soma(plano(id).faixasEnf), soma(plano(id).faixasApto)]), [[4288.57, 5776.38], [6353.57, 8564.27], [4281.32, 5766.67], [6273.81, 8461.8]]);
  assert.deepEqual(ids.map((id) => plano(id).nome), ["HAPVIDA NOSSO PLANO UBERLÂNDIA", "HAPVIDA NOSSO PLANO UBERLÂNDIA PARCIAL", "HAPVIDA NOSSO PLANO UBERABA", "HAPVIDA NOSSO PLANO UBERABA PARCIAL"]);
  for (const id of ids) {
    const p = plano(id);
    assert.equal(p.categoria, "CNPJ", id);
    // PME de 1 a 99 vidas, com uma tabela só.
    assert.equal(p.vidasMinimas, undefined, id);
    assert.equal(p.tabelasPorVidas, undefined, id);
    const cidade = id.includes("uberaba") ? "Uberaba" : "Uberlândia";
    assert.ok(vendidoEm(p, "MG", cidade) && !vendidoEm(p, "MG", cidade === "Uberaba" ? "Uberlândia" : "Uberaba"), id);
    assert.ok(p.carenciaTabela.includes("Parto a termo | 300 dias"), id);
    assert.ok(p.extras.includes("R$ 15,00"), id);
    assert.ok(p.copartTabela.includes(id.endsWith("total") ? "Consultas eletivas | R$ 47,77" : "Terapias neurológicas especiais | R$ 86,36"), id);
  }
  assert.ok(!plano("hapvida-nosso-plano-pme-parcial").copartTabela.includes("Consultas"));
  assert.equal(plano("hapvida-nosso-plano-pme-uberaba-total").rede, "");
  assert.equal(planPrices(plano("hapvida-nosso-plano-pme-uberaba-total"), [1, 0, 0, 0, 0, 0, 0, 0, 0, 0], {}).enf, 174.44);
  // O banco das versões anteriores recebe a tabela atual; plano editado à mão fica como está.
  const pasta = mkdtempSync(join(tmpdir(), "cotador-hapvida-pme-"));
  t.after(() => rmSync(pasta, { recursive: true, force: true }));
  const caminho = join(pasta, "c.db");
  const antigo = new Banco(caminho, seed);
  const promo = (id, primeira, extra = {}) => antigo.gravarPlano(id, { ...plano(id), faixasEnf: [primeira, ...plano(id).faixasEnf.slice(1)], vidasMinimas: 2, tabelasPorVidas: [{ aPartirDe: 30, ate: 99, faixasEnf: plano(id).faixasEnf, faixasApto: plano(id).faixasApto }], ...extra });
  promo("hapvida-nosso-plano-pme-total", 114.32, { nome: "HAPVIDA NOSSO PLANO" });
  promo("hapvida-nosso-plano-pme-parcial", 999);
  promo("hapvida-nosso-plano-pme-uberaba-total", 120.59);
  antigo.db.exec("PRAGMA user_version = 32");
  antigo.fechar();
  const novoBanco = new Banco(caminho, seed);
  const udi = novoBanco.obterPlano("hapvida-nosso-plano-pme-total");
  assert.deepEqual([udi.nome, udi.faixasEnf[0], udi.vidasMinimas ?? null, udi.tabelasPorVidas ?? null], ["HAPVIDA NOSSO PLANO UBERLÂNDIA", 170.72, null, null]);
  assert.equal(novoBanco.obterPlano("hapvida-nosso-plano-pme-parcial").faixasEnf[0], 999);
  assert.equal(novoBanco.obterPlano("hapvida-nosso-plano-pme-uberaba-total").faixasEnf[0], 174.44);
  novoBanco.fechar();
});

test("os planos PME da Unimed seguem a tabela: valores, área, coparticipação e carências", (t) => {
  const ids = ["unimed-pleno-on-pme", "unimed-udiplan-on-pme", "unimed-pontual-on-pme", "unimed-uniplan-on-pme"];
  const pme = ids.map((id) => planos.find((p) => p.id === id));
  // Total do PDF com uma pessoa em cada faixa.
  const soma = (v) => Math.round(v.reduce((a, b) => a + b, 0) * 100) / 100;
  assert.deepEqual(pme.map((p) => [soma(p.faixasEnf), soma(p.faixasApto)]), [[4454.1, 5690.99], [5530.65, 7160.18], [6626.61, 8587.55], [7155.24, 9251.24]]);
  for (const p of pme) {
    assert.equal(p.categoria, "CNPJ");
    // Contratação a partir de 2 vidas.
    assert.equal(p.vidasMinimas, 2);
    assert.ok(p.subtitulo.includes("(2 a 99 vidas)"));
    assert.equal(planPrices(p, [1, 0, 0, 0, 0, 0, 0, 0, 0, 0]).minimo, 2);
    assert.equal(planPrices(p, [2, 0, 0, 0, 0, 0, 0, 0, 0, 0]).tabelaVidas, "");
    assert.ok(vendidoEm(p, "MG", "Uberlândia") && vendidoEm(p, "MG", "Centralina") && !vendidoEm(p, "MG", "Uberaba"));
  }
  const pedido = { vidas: [2, 0, 0, 0, 0, 0, 0, 0, 0, 0], over: {}, cliente: "", opts: { copart: true, rede: true, acom: true }, municipio: "Uberlândia" };
  const corretor = { nome: "C", fone: "34999990000", empresa: "E" };
  const html = renderizarComparativo(pme.map((p) => montarSnapshot(p, pedido, corretor)));
  assert.ok(html.includes("/img/logo-unimed.png"));
  assert.ok(html.includes("R$ 364,82") && html.includes("R$ 740,82"));
  const linha = (titulo) => [...html.matchAll(new RegExp(`<th scope="row">${titulo}</th>((?:<td[^>]*>.*?</td>)+)`, "g"))][0]?.[1].match(/<td[^>]*>(.*?)<\/td>/g).map((c) => c.replace(/<[^>]+>/g, ""));
  assert.deepEqual(linha("Consulta"), Array(4).fill("R$ 40,00"));
  assert.deepEqual(linha("Pronto-socorro"), Array(4).fill("R$ 55,00"));
  assert.deepEqual(linha("Internação em apartamento"), Array(4).fill("R$ 150,00"));
  assert.ok(html.includes("Prazo de fidelidade") || html.includes("Fidelidade"));
});

test("a Aurora segue a tabela: valores, área, rede por cidade e comparativo", (t) => {
  const aurora = planos.find((p) => p.id === "aurora-saude-pf");
  assert.equal(aurora.faixasEnf.length, 10);
  assert.equal(aurora.faixasApto.length, 10);
  assert.equal(aurora.faixasEnf[0], 188.56);
  assert.equal(aurora.faixasApto[9], 1564.38);
  assert.ok(vendidoEm(aurora, "MG", "Uberaba") && vendidoEm(aurora, "MG", "Campo Florido") && !vendidoEm(aurora, "MG", "Uberlândia"));
  assert.equal(redeDaCidade(aurora, "Uberaba").length, 10);
  assert.equal(redeDaCidade(aurora, "Patos de Minas").length, 15);
  assert.ok(redeDaCidade(aurora, "Uberaba").includes("Hospital Santa Lúcia"));
  assert.deepEqual(redeDaCidade(aurora, "Araxá"), []);
  const pedido = { vidas: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0], over: {}, cliente: "", opts: { copart: true, rede: true, acom: true }, municipio: "Uberaba" };
  const corretor = { nome: "C", fone: "34999990000", empresa: "E" };
  // Os produtos adicionais são pagos à parte: não podem aparecer como inclusos na proposta.
  assert.deepEqual(montarSnapshot(aurora, pedido, corretor).plano.beneficios, []);
  const amil = planos.find((p) => p.id === "amil-ouro-total");
  const html = renderizarComparativo([aurora, amil].map((p) => montarSnapshot(p, pedido, corretor)));
  assert.ok(html.includes("/img/logo-aurora.png"));
  assert.ok(html.includes("R$ 188,56") && html.includes("R$ 282,22"));
  const linha = (titulo) => html.match(new RegExp(`<th scope="row">${titulo}</th><td[^>]*>(.*?)</td>`))?.[1];
  assert.equal(linha("Consulta"), "R$ 45,00");
  assert.equal(linha("Pronto-socorro"), "R$ 60,00");
  assert.equal(linha("Internação em enfermaria"), "R$ 130,00");
  assert.equal(linha("Internação em apartamento"), "R$ 200,00");
  assert.equal(linha("Exames básicos"), "24 horas");
  assert.equal(linha("Internação"), "180 dias");
  assert.equal(linha("Parto"), "300 dias");
  assert.equal(linha("Preexistência"), "24 meses");
  const pasta = mkdtempSync(join(tmpdir(), "cotador-aurora-"));
  t.after(() => rmSync(pasta, { recursive: true, force: true }));
  const caminho = join(pasta, "c.db");
  const antigo = new Banco(caminho, seed);
  antigo.excluirPlano("aurora-saude-pf");
  antigo.db.exec("PRAGMA user_version = 13");
  antigo.fechar();
  const novo = new Banco(caminho, seed);
  assert.equal(novo.obterPlano("aurora-saude-pf").nome, "AURORA SAÚDE");
  // Entra uma vez só: quem excluir o plano depois não o recebe de volta.
  novo.excluirPlano("aurora-saude-pf");
  novo.fechar();
  const depois = new Banco(caminho, seed);
  assert.ok(!depois.obterPlano("aurora-saude-pf"));
  depois.fechar();
});

test("a SulAmérica tem a rede de cada cidade, conforme a tabela", () => {
  const especial = planos.find((p) => p.id === "sulamerica-especial-100-rc");
  const direto = planos.find((p) => p.id === "sulamerica-direto-nacional");
  assert.deepEqual(redeDaCidade(especial, "Uberaba"), ["Hospital São Marcos", "Hospital Universitário Mário Palmerio", "Hospital da Criança", "Laboratório Santa Lucilia"]);
  assert.deepEqual(redeDaCidade(especial, "Prata"), ["Hospital e Mat. Renascer", "Biomed"]);
  // Nova Lima: Labclass não atende o Clássico, mas atende o Especial. Na tabela do Direto as colunas são outras.
  assert.ok(redeDaCidade(especial, "Nova Lima").includes("Labclass"));
  assert.ok(redeDaCidade(especial, "Ituiutaba").includes("Arantes Medicina Laboratorial"));
  assert.ok(!redeDaCidade(direto, "Ituiutaba").includes("Arantes Medicina Laboratorial"));
  // Uberlândia continua com a mesma lista, e sem cidade escolhida a proposta não traz centenas de linhas.
  assert.deepEqual(redeDaCidade(direto, ""), ["Madrecor Hospital", "Uberlândia Medical Center", "Anatomo", "Check Up Laboratório de Análises Clínicas", "Labormed"]);
  assert.deepEqual(redeDaCidade(direto, "Uberlândia"), redeDaCidade(direto, ""));
  // Toda cidade da rede está na área, senão a linha seria tomada como de Uberlândia.
  for (const p of planos.filter((x) => x.id.startsWith("sulamerica-"))) {
    const area = lerArea(p.areaComercializacao).estados[0].cidades;
    assert.ok(area.includes("Timóteo") && area.includes("Tiradentes"));
    for (const l of p.rede.split("\n")) {
      const m = l.match(/ – ([^–]+)$/);
      if (m) assert.ok(vendidoEm(p, "MG", m[1]), `${p.id}: ${l}`);
    }
  }
});

test("ao atualizar, recebe a rede por cidade sem trocar rede editada", (t) => {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-rede-"));
  t.after(() => rmSync(pasta, { recursive: true, force: true }));
  const caminho = join(pasta, "c.db");
  const antigo = new Banco(caminho, seed);
  const direto = planos.find((p) => p.id === "sulamerica-direto-nacional");
  const especial = planos.find((p) => p.id === "sulamerica-especial-100-rc");
  antigo.db.prepare("UPDATE planos SET rede = ? WHERE id = ?").run(redeDaCidade(direto, "").join("\n"), direto.id);
  antigo.db.prepare("UPDATE planos SET rede = ? WHERE id = ?").run("Hospital Meu", especial.id);
  antigo.db.exec("UPDATE planos SET area_comercializacao = REPLACE(area_comercializacao, 'Timóteo, Tiradentes', 'Timóteo Tiradentes')");
  antigo.db.exec("PRAGMA user_version = 12");
  antigo.fechar();
  const novo = new Banco(caminho, seed);
  assert.equal(novo.obterPlano(direto.id).rede, direto.rede);
  assert.equal(novo.obterPlano(especial.id).rede, "Hospital Meu");
  assert.ok(novo.obterPlano(direto.id).areaComercializacao.includes("Timóteo, Tiradentes"));
  novo.fechar();
});

test("uma tabela nova, no formato da leitura, já separa a rede por cidade", () => {
  const novo = {
    cidade: "Triângulo Mineiro",
    areaComercializacao: "MG: Uberaba, Patos de Minas, Araxá",
    rede: "Hospital Santa Lúcia – Uberaba\nLaboratório Salk – Uberaba\nHospital Vera Cruz – Patos de Minas\nCLIMA – Clínica de Imagem",
  };
  assert.deepEqual(redeDaCidade(novo, "Patos de Minas"), ["Hospital Vera Cruz", "CLIMA – Clínica de Imagem"]);
  assert.ok(vendidoEm(novo, "MG", "Araxá"));
  assert.deepEqual(resumoDaRede(novo), {
    cidades: [{ cidade: "Patos de Minas", total: 1 }, { cidade: "Uberaba", total: 2 }],
    semCidade: 1,
    destinoSemCidade: "",
  });
  assert.equal(resumoDaRede({ ...novo, cidade: "uberaba" }).destinoSemCidade, "Uberaba");
});

test("plano sem área ou com região no lugar da cidade não perde a rede", () => {
  assert.deepEqual(redeDaCidade({ rede: "Hospital A\nHospital B – Araxá", cidade: "Uberlândia", areaComercializacao: "" }, "Uberaba"), ["Hospital A", "Hospital B – Araxá"]);
  assert.deepEqual(redeDaCidade({ rede: "Hospital A\nHospital B – Araxá", cidade: "Triângulo Mineiro", areaComercializacao: "MG: Araxá, Prata" }, "Prata"), ["Hospital A"]);
});

test("mensagem, imagem e comparativo usam a rede da cidade", () => {
  const plamedh = planos.find((p) => p.id === "plamedh-pf"), amil = planos.find((p) => p.id === "amil-ouro-total");
  const corretor = { nome: "C", fone: "34999990000", empresa: "E" }, opts = { copart: true, rede: true, acom: true };
  const pedido = { vidas: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0], over: {}, cliente: "", opts, municipio: "Ituiutaba" };
  const msg = buildMsg({ items: [plamedh], vidas: pedido.vidas, over: {}, nome: "", corretor, opts, cidade: "Ituiutaba" });
  assert.ok(msg.includes("🏨 *Rede Credenciada em Ituiutaba*\n• Hospital Nossa Senhora da Abadia\n"));
  assert.ok(!msg.includes("Hospital UMC"));
  const snap = montarSnapshot(plamedh, pedido, corretor);
  assert.deepEqual(snap.plano.rede, ["Hospital Nossa Senhora da Abadia"]);
  const pagina = renderizarProposta(snap, {}, { paraImagem: true });
  assert.ok(pagina.includes("Rede Credenciada em Ituiutaba") && pagina.includes("Hospital Nossa Senhora da Abadia") && !pagina.includes("Hospital UMC"));
  const comparativo = renderizarComparativo([plamedh, plamedh].map((p) => montarSnapshot(p, pedido, corretor)));
  assert.ok(comparativo.includes("Rede credenciada em Ituiutaba") && !comparativo.includes("Hospital UMC"));
  // Sem rede na cidade, a seção some em vez de mostrar outra cidade.
  const semRede = buildMsg({ items: [amil], vidas: pedido.vidas, over: {}, nome: "", corretor, opts, cidade: "Uberaba" });
  assert.ok(!semRede.includes("Rede Credenciada") && !semRede.includes("Madrecor"));
  // Sem cidade, nada muda.
  const completa = buildMsg({ items: [plamedh], vidas: pedido.vidas, over: {}, nome: "", corretor, opts });
  assert.ok(completa.includes("🏨 *Rede Credenciada*\n• Hospital UMC – Uberlândia\n"));
});

test("a cotação guarda a cidade, e a cotação antiga continua abrindo", (t) => {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-cid-"));
  t.after(() => rmSync(pasta, { recursive: true, force: true }));
  const caminho = join(pasta, "c.db");
  const banco = new Banco(caminho, seed);
  const base = { fone: "34999990000", cliente: "Maria", tipo: "PF", idades: "", vidas: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0], over: {}, planos: [{ id: "amil-ouro-total", nome: "AMIL OURO", enf: 1, apto: 2 }], mensagem: "m" };
  const antiga = banco.salvarCotacao(base).cotacao;
  assert.equal(antiga.municipio, "");
  const { cotacao, duplicada } = banco.salvarCotacao({ ...base, uf: "MG", municipio: "Uberaba" });
  // Mesma mensagem em outra cidade é outra cotação.
  assert.equal(duplicada, false);
  assert.equal(cotacao.uf, "MG");
  assert.equal(cotacao.municipio, "Uberaba");
  assert.equal(banco.salvarCotacao({ ...base, uf: "MG", municipio: "Uberaba" }).duplicada, true);
  banco.db.exec("PRAGMA user_version = 14");
  banco.fechar();
  const depois = new Banco(caminho, seed);
  assert.equal(depois.obterCotacao(cotacao.id).municipio, "Uberaba");
  depois.fechar();
});

test("toda tabela de carências traz terapias e preexistência", () => {
  assert.equal(completarCarencias("Item | A | B\nParto | 300 dias | 300 dias"), "Item | A | B\nParto | 300 dias | 300 dias\nTerapias | 180 dias | 180 dias\nDoenças e lesões preexistentes | 24 meses | 24 meses");
  // Fica antes da preexistência que já existe.
  assert.equal(completarCarencias("Item | A\nParto | 300 dias\nCPT | 720 dias"), "Item | A\nParto | 300 dias\nTerapias | 180 dias\nCPT | 720 dias");
  // O que já existe não muda, inclusive prazos reduzidos.
  const pronta = "Item | A | B\nTerapias Simples | 180 dias | 60 dias\nCobertura Parcial Temporária | 720 dias | 720 dias";
  assert.equal(completarCarencias(pronta), pronta);
  // Citações que não são a linha do assunto não contam.
  const citacoes = completarCarencias("Item | A\nExames, Exceto em Terapias | 1 dia\nInternação (Não Relacionada a Doenças Preexistentes) | 180 dias");
  assert.ok(citacoes.includes("Terapias | 180 dias") && citacoes.includes("Doenças e lesões preexistentes | 24 meses"));
  assert.equal(completarCarencias(""), "");
  for (const p of planos) assert.equal(completarCarencias(p.carenciaTabela), p.carenciaTabela, p.id);
});

test("o comparativo mostra terapias e preexistência em todos os planos", () => {
  const corretor = { nome: "C", fone: "34999990000", empresa: "E" };
  const pedido = { vidas: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0], over: {}, cliente: "", opts: { copart: true, rede: true, acom: true } };
  for (let i = 0; i < planos.length; i += 6) {
    const grupo = planos.slice(i, i + 6);
    const html = renderizarComparativo((grupo.length > 1 ? grupo : [grupo[0], planos[0]]).map((p) => montarSnapshot(p, pedido, corretor)));
    const secao = html.slice(html.indexOf(">Carências<"));
    for (const titulo of ["Terapias", "Preexistência"]) {
      const linha = secao.match(new RegExp(`<th scope="row">${titulo}</th>(.*?)</tr>`))[1];
      const valores = [...linha.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => m[1]);
      assert.deepEqual([...new Set(valores)], [titulo === "Terapias" ? "180 dias" : "24 meses"], `${titulo}: ${grupo.map((p) => p.id)}`);
    }
  }
});

test("ao atualizar e ao salvar, a tabela recebe as duas linhas", async (t) => {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-car-"));
  const caminho = join(pasta, "c.db");
  const antigo = new Banco(caminho, seed);
  antigo.gravarPlano("meu-plano", { ...planos[0], id: "meu-plano", nome: "MEU", carenciaTabela: "Item | Prazo\nParto | 300 dias" });
  antigo.db.exec("PRAGMA user_version = 15");
  antigo.fechar();
  const banco = new Banco(caminho, seed);
  assert.equal(banco.obterPlano("meu-plano").carenciaTabela, "Item | Prazo\nParto | 300 dias\nTerapias | 180 dias\nDoenças e lesões preexistentes | 24 meses");
  const app = criarApp({ banco, pastaPublica: join(raiz, "public"), pastaUploads: join(pasta, "u"), pastaBackups: join(pasta, "b"), env: {} });
  const servidor = await new Promise((ok) => { const s = app.listen(0, "127.0.0.1", () => ok(s)); });
  t.after(() => new Promise((fim) => { servidor.closeAllConnections(); servidor.close(() => { banco.fechar(); rmSync(pasta, { recursive: true, force: true }); fim(); }); }));
  const r = await fetch(`http://127.0.0.1:${servidor.address().port}/api/planos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome: "NOVO CAR", categoria: "PF", carenciaTabela: "Item | Prazo\nParto | 300 dias" }) });
  assert.ok(r.ok);
  assert.ok(banco.listarPlanos().find((p) => p.nome === "NOVO CAR").carenciaTabela.includes("Terapias | 180 dias"));
});

test("Amil PME: o preço muda com o total de vidas, de 2 a 99", () => {
  const amil = planos.filter((p) => p.id.startsWith("amil-pme-"));
  assert.equal(amil.length, 24);
  assert.equal(new Set(amil.map((p) => p.nome)).size, 24);
  const prata = amil.find((p) => p.id === "amil-pme-prata-30");
  const grupo = (n, faixa = 0) => { const vidas = Array(10).fill(0); vidas[faixa] = n; return planPrices(prata, vidas); };
  assert.deepEqual(gruposDeVidas(prata).map((g) => g.nome), ["2 a 4 vidas", "5 a 29 vidas", "30 a 99 vidas"]);
  // Valores do PDF, 0 a 18 anos: 188,99 (2 a 4), 169,98 (5 a 29) e 164,99 (30 a 99, compulsório).
  assert.deepEqual([2, 4, 5, 29, 30, 99].map((n) => [grupo(n).enf, grupo(n).tabelaVidas]), [[377.98, "2 a 4 vidas"], [755.96, "2 a 4 vidas"], [849.9, "5 a 29 vidas"], [4929.42, "5 a 29 vidas"], [4949.7, "30 a 99 vidas"], [16334.01, "30 a 99 vidas"]]);
  assert.deepEqual([grupo(1).minimo, grupo(1).enf], [2, null]);
  assert.deepEqual([grupo(100).maximo, grupo(100).apto], [99, null]);
  // MEI tem preço próprio; o Platinum é só apartamento.
  const mei = amil.find((p) => p.id === "amil-pme-prata-30-mei");
  assert.equal(planPrices(mei, [2, 0, 0, 0, 0, 0, 0, 0, 0, 0]).enf, 451.7);
  const r2 = amil.find((p) => p.id === "amil-pme-platinum-r2-parcial");
  const v = planPrices(r2, [0, 0, 0, 0, 0, 0, 0, 0, 0, 5]);
  assert.deepEqual([v.enf, v.apto], [null, 11576.1]);
  // A mensagem e a proposta dizem qual tabela de vidas foi usada.
  const pedido = { vidas: [5, 0, 0, 0, 0, 0, 0, 0, 0, 0], over: {}, cliente: "", opts: { copart: true, rede: true, acom: true }, municipio: "Uberlândia" };
  const msg = buildMsg({ items: [prata], vidas: pedido.vidas, over: {}, nome: "", corretor: { nome: "C", fone: "", empresa: "" }, opts: pedido.opts });
  assert.ok(msg.includes("5 vidas · preço para empresas de 5 a 29 vidas"));
  const snap = montarSnapshot(prata, pedido, { nome: "C", fone: "34999990000", empresa: "E" });
  assert.equal(snap.precos.tabelaVidas, "5 a 29 vidas");
  assert.ok(renderizarProposta(snap, { token: "x".repeat(24) }).includes("preço de 5 a 29 vidas"));
  // Rede dos PDFs da Amil: o UMC atende Ouro e Platinum, mas não Prata.
  const ouro = amil.find((p) => p.id === "amil-pme-ouro-30");
  assert.ok(redeDaCidade(ouro, "Uberlândia").includes("Uberlândia Medical Center - UMC"));
  assert.ok(!redeDaCidade(prata, "Uberlândia").includes("Uberlândia Medical Center - UMC"));
  assert.ok(redeDaCidade(prata, "Uberlândia").includes("Hospital Santa Genoveva"));
  assert.ok(redeDaCidade(prata, "Uberaba").includes("Hospital São Marcos de Uberaba"));
  // Benefícios exclusivos Amil em todos, e o reembolso só onde existe.
  for (const p of amil) {
    assert.ok(p.mostrarExtras && p.extras.startsWith("🦷 Plano odontológico sem custo por 12 meses"), p.id);
    assert.ok(p.extras.includes("🚑 Amil Resgate sem custo por 12 meses"), p.id);
    assert.equal(p.extras.includes("Reembolso"), !p.id.startsWith("amil-pme-prata"), p.id);
  }
  assert.ok(montarSnapshot(prata, pedido, { nome: "C", fone: "34999990000", empresa: "E" }).plano.beneficios.includes("📱 Telemedicina"));
  // Carências: as mesmas do plano adesão da Amil.
  assert.equal(prata.carenciaTabela, planos.find((p) => p.id === "amil-prata-mg1-total").carenciaTabela);
  // Coparticipação da Linha Amil: Platinum tem limites próprios.
  assert.ok(amil.find((p) => p.id === "amil-pme-platinum-r1-30").copartTabela.includes("Internação | – | 400,00"));
  // No comparativo, a Santa Clara da Amil e a da Unimed ficam numa linha só.
  const unimed = planos.find((p) => p.id === "unimed-pleno-on-pme");
  const lado = renderizarComparativo([ouro, unimed].map((p) => montarSnapshot(p, pedido, { nome: "C", fone: "34999990000", empresa: "E" })));
  assert.equal(lado.match(/Santa Clara/g).length, 1);
});

test("restaurar um backup antigo traz os planos e as correções das versões seguintes", (t) => {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-restaura-"));
  t.after(() => rmSync(pasta, { recursive: true, force: true }));
  // Um backup feito antes da Amil PME (versão 25): sem os planos e sem as colunas de vidas.
  const antigo = new Banco(join(pasta, "antigo.db"), seed);
  for (const p of planos.filter((x) => x.id.startsWith("amil-pme-"))) antigo.excluirPlano(p.id);
  antigo.db.exec("UPDATE planos SET vidas_minimas = NULL WHERE id LIKE 'unimed-%-pme'; ALTER TABLE planos DROP COLUMN vidas_minimas; ALTER TABLE planos DROP COLUMN tabelas_por_vidas; PRAGMA user_version = 25");
  const backup = antigo.gerarBackup();
  antigo.fechar();
  const banco = new Banco(join(pasta, "atual.db"), seed);
  banco.restaurar(backup);
  assert.equal(banco.listarPlanos().filter((p) => p.id.startsWith("amil-pme-")).length, 24);
  assert.ok(banco.obterPlano("amil-pme-prata-30").carenciaTabela.startsWith("Tipo de Carência"));
  assert.ok(banco.obterPlano("amil-pme-prata-30").extras.includes("📱 Telemedicina"));
  assert.equal(banco.obterPlano("unimed-pleno-on-pme").vidasMinimas, 2);
  banco.fechar();
});

test("proposta com plano que não aceita o tamanho do grupo é recusada, sem salvar link pela metade", async (t) => {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-minimo-"));
  const banco = new Banco(join(pasta, "c.db"), seed);
  const app = criarApp({ banco, pastaPublica: join(raiz, "public"), pastaUploads: join(pasta, "u"), pastaBackups: join(pasta, "b"), env: {}, linkPublico: () => ({ estado: "ativo", url: "http://exemplo" }) });
  const servidor = await new Promise((ok) => { const s = app.listen(0, "127.0.0.1", () => ok(s)); });
  t.after(() => new Promise((fim) => { servidor.closeAllConnections(); servidor.close(() => { banco.fechar(); rmSync(pasta, { recursive: true, force: true }); fim(); }); }));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const pedir = (rota, vidas, planosIds) => fetch(base + rota, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planos: planosIds, vidas, fone: "34999990000", cliente: "Teste" }) });
  const umaVida = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0], duas = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const contar = () => banco.db.prepare("SELECT COUNT(*) AS n FROM propostas").get().n;
  const antes = contar();
  const r = await pedir("/api/propostas", umaVida, ["plam-total-cnpj", "amil-pme-prata-30"]);
  assert.equal(r.status, 400);
  assert.match((await r.json()).erro, /AMIL PRATA 30% é para grupos a partir de 2 vidas/);
  assert.equal(contar(), antes);
  assert.equal((await pedir("/api/propostas/previa", umaVida, ["unimed-pleno-on-pme"])).status, 400);
  assert.equal((await pedir("/api/propostas", duas, ["plam-total-cnpj", "amil-pme-prata-30"])).status, 201);
  assert.equal(contar(), antes + 2);
});

test("plano antigo, sem tabela por vidas, continua com o preço de família a partir de 3 vidas", () => {
  const p = { faixasEnf: [100, ...Array(9).fill(100)], faixasApto: Array(10).fill(null), faixasEnfFamilia: Array(10).fill(80) };
  assert.equal(planPrices(p, [2, 0, 0, 0, 0, 0, 0, 0, 0, 0]).enf, 200);
  assert.equal(planPrices(p, [3, 0, 0, 0, 0, 0, 0, 0, 0, 0]).enf, 240);
  assert.equal(planPrices(p, [3, 0, 0, 0, 0, 0, 0, 0, 0, 0]).tabelaVidas, "");
});

test("banco da versão anterior recebe as colunas de vidas e os planos Amil PME; a API valida as tabelas", async (t) => {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-vidas-"));
  const caminho = join(pasta, "c.db");
  const antigo = new Banco(caminho, seed);
  for (const p of planos.filter((x) => x.id.startsWith("amil-pme-"))) antigo.excluirPlano(p.id);
  antigo.db.exec("ALTER TABLE planos DROP COLUMN vidas_minimas; ALTER TABLE planos DROP COLUMN tabelas_por_vidas; PRAGMA user_version = 25");
  antigo.fechar();
  const banco = new Banco(caminho, seed);
  const prata = banco.obterPlano("amil-pme-prata-40-mei");
  assert.equal(prata.vidasMinimas, 2);
  assert.equal(prata.tabelasPorVidas[1].ate, 99);
  assert.equal(prata.tabelasPorVidas[0].faixasEnf[0], 184.01);
  assert.equal(banco.obterPlano("plam-saude-pf").vidasMinimas, null);
  banco.fechar();
  // Banco que recebeu a Amil PME com os prazos da lei troca pela tabela do plano adesão; a editada à mão fica.
  const provisoria = "Cobertura | Prazo máximo (Lei 9.656/98)\nUrgência e emergência | 24 horas";
  const v26 = new Banco(caminho, seed);
  v26.db.exec(`UPDATE planos SET carencia_tabela = '${provisoria}' WHERE id LIKE 'amil-pme-%'; UPDATE planos SET carencia_tabela = 'Minha | tabela' WHERE id = 'amil-pme-ouro-30'; PRAGMA user_version = 26`);
  v26.fechar();
  banco.abrir();
  assert.ok(banco.obterPlano("amil-pme-prata-40-mei").carenciaTabela.startsWith("Tipo de Carência | Sem plano anterior (PRC 607)"));
  assert.equal(banco.obterPlano("amil-pme-ouro-30").carenciaTabela, "Minha | tabela");
  banco.fechar();
  // Banco da versão 27 recebe os benefícios; benefício editado à mão fica.
  const v27 = new Banco(caminho, seed);
  v27.db.exec("UPDATE planos SET extras = '', mostrar_extras = 0 WHERE id = 'amil-pme-prata-30'; UPDATE planos SET extras = '💳 Reembolso por livre escolha' WHERE id = 'amil-pme-ouro-40'; UPDATE planos SET extras = 'Meu benefício' WHERE id = 'amil-pme-ouro-30'; PRAGMA user_version = 27");
  v27.fechar();
  banco.abrir();
  assert.ok(banco.obterPlano("amil-pme-prata-30").mostrarExtras);
  assert.ok(banco.obterPlano("amil-pme-prata-30").extras.includes("📱 Telemedicina"));
  assert.ok(banco.obterPlano("amil-pme-ouro-40").extras.includes("🌎 Abrangência nacional"));
  assert.equal(banco.obterPlano("amil-pme-ouro-30").extras, "Meu benefício");
  banco.fechar();
  // Banco da versão 29 recebe a área da Amil CNPJ na ordem da tabela; a editada à mão fica.
  const v29 = new Banco(caminho, seed);
  const areaAntiga = "MG: Araguari, Belo Horizonte, Belo Vale, Betim, Bonfim, Brumadinho, Cachoeira de Minas, Caeté, Confins, Congonhas, Conselheiro Lafaiete, Contagem, Cristiano Otoni, Esmeraldas, Espírito Santo do Dourado, Florestal, Ibirité, Igarapé, Indianópolis, Itabirito, Itaverava, Jaboticatubas, Juatuba, Juiz de Fora, Lagoa Santa, Mariana, Mário Campos, Mateus Leme, Matozinhos, Moeda, Monte Alegre de Minas, Montes Claros, Nova Lima, Nova União, Ouro Branco, Ouro Preto, Pedro Leopoldo, Pouso Alegre, Prata, Queluzito, Raposos, Ribeirão das Neves, Rio Acima, Rio Manso, Sabará, Santa Luzia, Santana dos Montes, São Joaquim de Bicas, São José da Lapa, Sarzedo, Taquaraçu de Minas, Tupaciguara, Uberaba, Uberlândia, Vespasiano, Janaúba, Bocaiúva";
  v29.db.exec(`UPDATE planos SET area_comercializacao = '${areaAntiga}' WHERE id LIKE 'amil-pme-%'; UPDATE planos SET area_comercializacao = 'MG: Uberlândia' WHERE id = 'amil-pme-ouro-30'; PRAGMA user_version = 29`);
  v29.fechar();
  banco.abrir();
  assert.equal(banco.obterPlano("amil-pme-prata-40-mei").areaComercializacao, planos.find((p) => p.id === "amil-pme-prata-40-mei").areaComercializacao);
  assert.ok(banco.obterPlano("amil-pme-prata-40-mei").areaComercializacao.includes("Betim, Bocaiúva, Bonfim"));
  assert.equal(banco.obterPlano("amil-pme-ouro-30").areaComercializacao, "MG: Uberlândia");
  assert.ok(banco.obterPlano("amil-prata-mg1-total").areaComercializacao.endsWith("Janaúba, Bocaiúva"));
  const app = criarApp({ banco, pastaPublica: join(raiz, "public"), pastaUploads: join(pasta, "u"), pastaBackups: join(pasta, "b"), env: {} });
  const servidor = await new Promise((ok) => { const s = app.listen(0, "127.0.0.1", () => ok(s)); });
  t.after(() => new Promise((fim) => { servidor.closeAllConnections(); servidor.close(() => { banco.fechar(); rmSync(pasta, { recursive: true, force: true }); fim(); }); }));
  const url = `http://127.0.0.1:${servidor.address().port}/api/planos/amil-pme-prata-40-mei`;
  const salvar = (mudanca) => fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...prata, ...mudanca }) });
  // Salvar o plano sem mexer nas tabelas mantém tudo como estava.
  assert.ok((await salvar({ subtitulo: "Novo" })).ok);
  assert.deepEqual(banco.obterPlano("amil-pme-prata-40-mei").tabelasPorVidas, prata.tabelasPorVidas);
  assert.equal((await salvar({ tabelasPorVidas: [{ aPartirDe: 5, faixasEnf: [1], faixasApto: null }] })).status, 400);
  assert.equal((await salvar({ tabelasPorVidas: [{ aPartirDe: 30, faixasEnf: null, faixasApto: null }, { aPartirDe: 5, faixasEnf: null, faixasApto: null }] })).status, 400);
  assert.equal((await salvar({ vidasMinimas: 2.5 })).status, 400);
  assert.ok((await salvar({ vidasMinimas: 1 })).ok);
  assert.equal(banco.obterPlano("amil-pme-prata-40-mei").vidasMinimas, null);
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
  // Uberlândia está na área de todos os planos, menos da Aurora e dos planos de Uberaba da Hapvida.
  assert.deepEqual(planos.filter((p) => !vendidoEm(p, "MG", "Uberlândia")).map((p) => p.id), ["aurora-saude-pf", "hapvida-nosso-plano-pme-uberaba-total", "hapvida-nosso-plano-pme-uberaba-parcial"]);
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
