import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lerArea, locaisDosPlanos, redeDaCidade, resumoDaRede, vendidoEm } from "../public/js/calculo.js";
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
  // Uberlândia está na área de todos os planos, menos da Aurora.
  assert.deepEqual(planos.filter((p) => !vendidoEm(p, "MG", "Uberlândia")).map((p) => p.id), ["aurora-saude-pf"]);
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
