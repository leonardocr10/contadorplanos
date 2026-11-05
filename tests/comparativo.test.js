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

// Valores em destaque de uma linha de faixa ou do total, por plano.
function destaquesDaLinha(html, titulo) {
  const linha = html.match(new RegExp(`<tr class="faixa[^"]*"><th scope="row">${titulo}</th>(.*?)</tr>`));
  assert.ok(linha, `linha ${titulo} não encontrada`);
  const rotulos = ["Enf.", "Apto"];
  return [...linha[1].matchAll(/<td>(.*?)<\/td>/g)].map((c) => [...c[1].matchAll(/<span( class="menor")?>/g)].flatMap((m, i) => (m[1] ? [rotulos[i]] : [])));
}

test("compara valores e destaca só o menor de cada acomodação", () => {
  const html = comparar("plam-saude-pf", "amil-ouro-total", "unimed-udiplan-on-pf");
  assert.deepEqual(celulas(html, "Total mensal"), ["R$ 346,06 R$ 543,48", "R$ 725,30 R$ 805,10", "R$ 526,36 R$ 679,38"]);
  // Os nomes das acomodações aparecem uma vez em cada plano, no alto da seção.
  assert.equal(html.match(/<span>Enfermaria<\/span><span>Apartamento<\/span>/g).length, 3);
  assert.deepEqual(destaquesDaLinha(html, "Total mensal"), [["Enf.", "Apto"], [], []]);
  assert.deepEqual(celulas(html, "Taxa associativa"), ["R$ 7,00", "—", "R$ 4,00"]);
  for (const logo of ["plam", "amil", "unimed"]) assert.ok(html.includes(`/img/logo-${logo}.png`));
  assert.ok(html.includes("Maria"));
  assert.ok(!html.includes("não consta na tabela"));
});

test("mostra o valor por pessoa de cada faixa etária", () => {
  const varias = { ...pedido, vidas: [2, 0, 1, 0, 0, 0, 0, 0, 0, 0] };
  const html = renderizarComparativo(["plam-saude-pf", "amil-platinum-r1-total"].map((id) => montarSnapshot(plano(id), varias, corretor)));
  const [plam, amil] = celulas(html, "0 a 18 anos · 2 vidas");
  assert.equal(plam, "R$ 173,03 R$ 271,74");
  // Sem enfermaria no plano, a coluna fica vazia em vez de sumir.
  assert.match(amil, /^— R\$/);
  assert.equal(celulas(html, "24 a 28 anos · 1 vida").length, 2);
  // O total é só mais uma linha, logo depois das faixas e sem seção própria.
  assert.ok(html.indexOf("24 a 28 anos · 1 vida") < html.indexOf("Total mensal"));
  assert.ok(!html.includes("Valor total mensal"));
});

test("destaca o menor valor de cada acomodação em cada faixa", () => {
  const html = comparar("plam-saude-pf", "amil-ouro-total", "unimed-udiplan-on-pf");
  assert.deepEqual(destaquesDaLinha(html, "0 a 18 anos · 2 vidas"), [["Enf.", "Apto"], [], []]);
});

test("plano sem a acomodação não concorre ao menor valor da faixa", () => {
  const html = comparar("amil-platinum-r1-total", "unimed-udiplan-on-pf");
  // Só um plano tem enfermaria, então não há o que destacar nela.
  assert.deepEqual(destaquesDaLinha(html, "0 a 18 anos · 2 vidas"), [[], ["Apto"]]);
});

test("plano da Aurora entra no comparativo com logo, exames simples e rede sem a cidade", () => {
  const aurora = {
    ...plano("plamedh-pf"), id: "aurora", nome: "AURORA SAÚDE",
    carenciaTabela: "Coberturas | Carência contratual\nExame Simples | 24 horas\nCobertura Parcial Temporaria | 720 dias",
    rede: "Hospital Santa Lúcia – Uberaba\nHospital Vera Cruz – Patos de Minas",
  };
  const html = renderizarComparativo([aurora, plano("plam-saude-pf")].map((p) => montarSnapshot(p, pedido, corretor)));
  assert.ok(html.includes("/img/logo-aurora.png"));
  assert.equal(celulas(html, "Exames básicos")[0], "24 horas");
  assert.equal(celulas(html, "Preexistência")[0], "24 meses");
  assert.equal(celulas(html, "Hospital Vera Cruz").length, 2);
});

test("compara pessoa física com CNPJ e mostra o tipo de cada coluna", () => {
  const html = comparar("plam-saude-pf", "plam-total-cnpj");
  assert.deepEqual([...html.matchAll(/<span class="tipo">(.*?)<\/span>/g)].map((m) => m[1]), ["Pessoa física", "CNPJ"]);
  assert.equal(celulas(html, "Total mensal").length, 2);
});

test("plano com faixas agrupadas mostra o valor nas faixas detalhadas dos outros", () => {
  const vidas = { ...pedido, vidas: [0, 0, 1, 0, 1, 0, 0, 0, 0, 0] };
  for (const ids of [["plam-total-cnpj", "plamedh-basic-pme"], ["plamedh-basic-pme", "plam-total-cnpj"]]) {
    const html = renderizarComparativo(ids.map((id) => montarSnapshot(plano(id), vidas, corretor)));
    const coluna = ids.indexOf("plamedh-basic-pme");
    // A tabela do Basic junta 19 a 58 anos em um só valor.
    assert.equal(celulas(html, "24 a 28 anos · 1 vida")[coluna], "R$ 275,85 —");
    assert.equal(celulas(html, "34 a 38 anos · 1 vida")[coluna], "R$ 275,85 —");
    assert.ok(html.includes("24 a 28 e 34 a 38 anos"));
  }
});

test("planos do mesmo tipo não repetem o tipo nas colunas", () => {
  assert.ok(!comparar("plam-saude-pf", "plamedh-pf").includes('<span class="tipo">'));
});

test("valores iguais não recebem destaque", () => {
  const html = comparar("plam-saude-pf", "plamedh-pf");
  assert.deepEqual(destaquesDaLinha(html, "Total mensal"), [[], []]);
  assert.deepEqual(destaquesDaLinha(html, "0 a 18 anos · 2 vidas"), [[], []]);
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

test("a janela fica fora das telas, para abrir também na Nova cotação", () => {
  const pagina = readFileSync(join(raiz, "public", "index.html"), "utf8");
  assert.ok(pagina.indexOf('id="modal"') > pagina.lastIndexOf("</section>"));
});

test("o texto de coparticipação segue o modelo e só cita valores da tabela do plano", () => {
  for (const p of planos) {
    assert.ok(p.copartTexto.startsWith("Você paga a mensalidade normalmente e, quando usar, "), p.id);
    assert.ok(p.copartTexto.endsWith("Os valores vêm no boleto do mês seguinte."), p.id);
    for (const [valor] of p.copartTexto.matchAll(/\d[\d.]*,\d\d/g)) assert.ok(p.copartTabela.includes(valor), `${p.id}: ${valor}`);
    for (const [pct] of p.copartTexto.matchAll(/\d+%/g)) assert.ok(p.copartTabela.includes(pct), `${p.id}: ${pct}`);
  }
});

test("ao atualizar, troca o texto da coparticipação sem mexer em tabela editada", (t) => {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-txt-"));
  t.after(() => rmSync(pasta, { recursive: true, force: true }));
  const caminho = join(pasta, "c.db");
  const antigo = new Banco(caminho, seed);
  antigo.db.exec("UPDATE planos SET copart_texto = 'texto antigo'");
  antigo.db.exec("UPDATE planos SET copart_tabela = 'Procedimento | Valor\nConsulta | R$ 99,00' WHERE id = 'plamedh-pf'");
  antigo.db.exec("PRAGMA user_version = 10");
  antigo.fechar();
  const novo = new Banco(caminho, seed);
  assert.equal(novo.obterPlano("plam-saude-pf").copartTexto, plano("plam-saude-pf").copartTexto);
  assert.equal(novo.obterPlano("plamedh-pf").copartTexto, "texto antigo");
  // Roda uma vez só: um texto editado depois da atualização não é sobrescrito.
  novo.db.exec("UPDATE planos SET copart_texto = 'meu texto' WHERE id = 'plam-saude-pf'");
  novo.fechar();
  const depois = new Banco(caminho, seed);
  assert.equal(depois.obterPlano("plam-saude-pf").copartTexto, "meu texto");
  depois.fechar();
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
  assert.equal((await enviar(["plam-saude-pf", "plam-total-cnpj"])).status, 200);
  assert.equal((await enviar(["plam-saude-pf"])).status, 400);
  assert.equal((await enviar(planos.slice(0, 5).map((p) => p.id))).status, 400);
  assert.equal((await enviar(["plam-saude-pf", "nao-existe"])).status, 400);
  assert.equal(banco.listarCotacoes({ fone: "", q: "", status: "" }).length, 0);
});
