import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Banco } from "../server/db.js";
import { criarApp } from "../server/app.js";
import { criarAppPublica, enderecoDosLinks } from "../server/publico.js";
import { contraste, fmtDias, linhaCoparticipacao, montarSnapshot, nivelPrazo, paletaProposta, paraProposta, prazo, renderizarProposta } from "../server/proposta-html.js";
import { hex2rgb } from "../public/js/cores.js";
import { planPrices } from "../public/js/calculo.js";

const raiz = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const seed = join(raiz, "dados", "planos.json");
const planos = JSON.parse(readFileSync(seed, "utf8"));
const plano = (id) => ({ mostrarExtras: false, ...planos.find((p) => p.id === id) });
const vidas = [1, 0, 0, 1, 1, 0, 0, 0, 0, 0];
const opts = { copart: true, rede: true, acom: true };
const corretor = { nome: "Diego", fone: "(34) 9", empresa: "Nexyum" };

function subir(t, linkPublico) {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-publico-"));
  const banco = new Banco(join(pasta, "cotador.db"), seed);
  const pastaPublica = join(raiz, "public"), pastaUploads = join(pasta, "uploads");
  const admin = criarApp({ banco, pastaPublica, pastaUploads, pastaBackups: join(pasta, "backups"), env: {}, linkPublico });
  const publico = criarAppPublica({ banco, pastaPublica, pastaUploads });
  return new Promise((resolve) => {
    const s1 = admin.listen(0, "127.0.0.1", () => {
      const s2 = publico.listen(0, "127.0.0.1", () => {
        t.after(() => new Promise((fim) => {
          s1.closeAllConnections(); s2.closeAllConnections();
          s1.close(() => s2.close(() => { banco.fechar(); rmSync(pasta, { recursive: true, force: true }); fim(); }));
        }));
        resolve({ banco, admin: `http://127.0.0.1:${s1.address().port}`, publico: `http://127.0.0.1:${s2.address().port}` });
      });
    });
  });
}

const pedir = (base, corpo) => fetch(base + "/api/propostas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
const ativo = () => ({ estado: "ativo", url: "https://teste.trycloudflare.com" });

test("página traz valores, tabelas e rede, sem a observação do plano", () => {
  const p = plano("plam-saude-pf");
  const html = renderizarProposta(montarSnapshot(p, { vidas, over: {}, cliente: "Maria", opts }, corretor));
  for (const trecho of ["PLAM SAÚDE", "Proposta para", "Maria", "3 vidas · 0 a 18, 29 a 33 e 34 a 38 anos", "R$ 769,76", "R$ 1.198,87", "R$ 7,00 de taxa associativa", "Consulta médica", "Carências", "Hospital Santa Marta", "Nexyum", "noindex"]) {
    assert.ok(html.includes(trecho), trecho);
  }
  // O telefone do consultor abre a conversa no WhatsApp, não a ligação.
  assert.ok(!html.includes('href="tel:'));
  assert.match(html, /<a href="https:\/\/web\.whatsapp\.com\/send\?phone=55349[^"]*" target="_blank" rel="noopener"[^>]*>/);
  const celular = renderizarProposta(montarSnapshot(p, { vidas, over: {}, cliente: "Maria", opts }, corretor), { agente: "Mozilla/5.0 (iPhone)" });
  assert.match(celular, /href="https:\/\/(api\.whatsapp\.com\/send\/?\?phone=55349|wa\.me\/55349)/);
  // Com telefone novo em Meus dados, a página mostra e chama o número atual.
  const atual = renderizarProposta(montarSnapshot(p, { vidas, over: {}, cliente: "Maria", opts }, corretor), { foneCorretor: "(34) 90000-7777" });
  assert.ok(atual.includes("phone=5534900007777") && atual.includes("(34) 90000-7777"));
  if (p.descricao) assert.ok(!html.includes(p.descricao));
});

test("benefícios só aparecem com mostrarExtras e opções são respeitadas", () => {
  const amil = renderizarProposta(montarSnapshot(plano("amil-ouro-total"), { vidas, over: {}, cliente: "", opts }, corretor));
  assert.ok(amil.includes("Incluso no plano"));
  assert.ok(amil.includes('id="situacao"'));
  assert.ok(!/[\u{1F300}-\u{1FAFF}✈]/u.test(amil), "benefícios sem emoji");
  const pl = plano("plam-saude-pf");
  const plam = renderizarProposta(montarSnapshot(pl, { vidas, over: {}, cliente: "", opts: { copart: false, rede: false, acom: false } }, corretor));
  assert.ok(!plam.includes("Incluso no plano"));
  assert.ok(!plam.includes(pl.copartTexto));
  assert.ok(!plam.includes("Rede Credenciada"));
  assert.ok(!plam.includes("acomodação compartilhada"));
  assert.ok(!plam.includes('id="situacao"'), "uma só situação não precisa de seletor");
});

test("a página segue a cor do plano", () => {
  const pagina = (id) => renderizarProposta(montarSnapshot(plano(id), { vidas, over: {}, cliente: "", opts }, corretor));
  const plam = pagina("plam-saude-pf");
  assert.ok(plam.includes("--navy:#00564d"));
  assert.ok(plam.includes("--accent:#007e70"));
  assert.ok(pagina("unimed-pleno-on-pf").includes("--navy:#00643a"));
  assert.ok(pagina("amil-ouro-total").includes("--navy:#004773"));
  assert.ok(pagina("plamedh-pf").includes("--navy:#0f5fb3"));
  // Nada do azul fixo do modelo pode sobrar em um plano verde.
  for (const fixo of ["#00466e", "#0067b3", "#dbe5ef", "#f2f6fa", "#9fd3ff", "#d6e9f7", "#e3f2ff", "#c9d6e3"]) assert.ok(!plam.includes(fixo), fixo);
});

test("as cores derivadas têm contraste de 4.5:1 em todos os planos", () => {
  const cores = [...planos.map((p) => p), { corPrimaria: "#ffff00", corEscura: "#ffee00" }, { corPrimaria: "" , corEscura: "" }];
  for (const p of cores) {
    const c = paletaProposta(p), rgb = (h) => hex2rgb(h), branco = [255, 255, 255], ink = rgb("#10243a"), muted = rgb("#4a5d70");
    const pares = [
      ["branco sobre preço em destaque", branco, c.accent], ["título", rgb(c.navy), branco], ["destaque sobre branco", rgb(c.accent), branco],
      ["rótulo do preço", rgb(c.sobreAccent), c.accent], ["corretora", rgb(c.sobreNavy), c.navy], ["rótulo do consultor", rgb(c.rotuloNavy), c.navy],
      ["texto na barra", ink, c.side], ["texto fraco na barra", muted, c.side], ["título na barra", rgb(c.accentNaBarra), c.side], ["linha zebrada", muted, c.zebra], ["percentual na linha zebrada", rgb(c.accent), c.zebra],
    ];
    for (const [nome, a, b] of pares) {
      const fundo = typeof b === "string" ? rgb(b) : b;
      assert.ok(contraste(a, fundo) >= 4.5, `${p.id ?? p.corPrimaria}: ${nome} = ${contraste(a, fundo).toFixed(2)}`);
    }
  }
});

test("mostra vidas e valor por pessoa de cada faixa etária, com o total da cotação", () => {
  const html = renderizarProposta(montarSnapshot(plano("plam-saude-pf"), { vidas: [1, 0, 0, 2, 0, 0, 0, 0, 0, 0], over: {}, cliente: "", opts }, corretor));
  assert.ok(html.includes("Valor por faixa etária"));
  const linha = (faixa, n, ...v) => new RegExp(String.raw`<td>${faixa} anos</td><td class="r">${n}</td>${v.map((x) => `<td[^>]*>R\\$\\s${x}</td>`).join("")}`);
  assert.match(html, linha("0 a 18", 1, "173,03", "271,74"));
  assert.match(html, linha("29 a 33", 2, "280,72", "431,23"));
  assert.match(html, /<td>Total<\/td><td class="r">3<\/td><td class="r">R\$\s734,47<\/td><td class="r">R\$\s1\.134,20<\/td>/);
  assert.ok(!/subtotal/i.test(html));
  assert.ok(!html.includes('class="faixas compacta"'));
  assert.ok(html.includes("/img/logo-plam.png"));
  const muitas = renderizarProposta(montarSnapshot(plano("plam-saude-pf"), { vidas: [1, 1, 1, 1, 0, 0, 0, 0, 0, 0], over: {}, cliente: "", opts }, corretor));
  assert.ok(muitas.includes('class="faixas compacta"'));
});

test("faixas escondem a acomodação sem valor e somem sem idades", () => {
  const html = renderizarProposta(montarSnapshot(plano("amil-platinum-r1-total"), { vidas, over: {}, cliente: "", opts }, corretor));
  assert.ok(!html.includes("Enfermaria por pessoa"));
  assert.ok(html.includes("Apartamento por pessoa"));
  const semIdades = renderizarProposta(montarSnapshot(plano("plam-saude-pf"), { vidas: Array(10).fill(0), over: {}, cliente: "", opts }, corretor));
  assert.ok(!semIdades.includes("Valor por faixa etária"));
});

test("adaptador lê os formatos reais de coparticipação", () => {
  assert.deepEqual(linhaCoparticipacao(["Consulta", "30%", "30,00"]), { nome: "Consulta", tipo: "pct", pct: "30", teto: 30 });
  assert.deepEqual(linhaCoparticipacao(["Internação", "–", "220,00"]), { nome: "Internação", tipo: "fixo", valor: 220 });
  assert.deepEqual(linhaCoparticipacao(["Consulta", "R$ 30,00"]), { nome: "Consulta", tipo: "fixo", valor: 30, detalhe: "" });
  assert.deepEqual(linhaCoparticipacao(["Consulta", "Isento"]), { nome: "Consulta", tipo: "isento" });
  assert.deepEqual(linhaCoparticipacao(["Exame", "40% (por procedimento)"]), { nome: "Exame", tipo: "pct", pct: "40", teto: null, detalhe: "por procedimento" });
  assert.deepEqual(linhaCoparticipacao(["Exame", "40% limitado a R$ 100,00 (por procedimento)"]), { nome: "Exame", tipo: "pct", pct: "40", teto: 100, detalhe: "por procedimento" });
  assert.deepEqual(linhaCoparticipacao(["Cirurgia", "R$ 1.000,00 (por procedimento)"]), { nome: "Cirurgia", tipo: "fixo", valor: 1000, detalhe: "por procedimento" });
  assert.deepEqual(linhaCoparticipacao(["Internação", "R$ 100,00 por evento"]), { nome: "Internação", tipo: "fixo", valor: 100, detalhe: "por evento" });
  assert.deepEqual(linhaCoparticipacao(["Outro", "conforme contrato"]), { nome: "Outro", tipo: "texto", texto: "conforme contrato" });
  assert.deepEqual(linhaCoparticipacao(["Outro", "a", "b", "c"]), { nome: "Outro", tipo: "texto", texto: "a · b · c" });
});

test("nenhuma linha real de coparticipação perde informação", () => {
  for (const p of planos) {
    for (const l of p.copartTabela.split("\n").slice(1)) {
      const c = linhaCoparticipacao(l.split("|").map((x) => x.trim()));
      assert.notEqual(c.tipo, "texto", `${p.id}: ${l}`);
    }
  }
});

test("prazos seguem as regras de texto e cor", () => {
  assert.deepEqual([0, 1, 30, 180, 720, 300].map(fmtDias), ["0 dia", "1 dia", "30 dias", "180 dias", "24 meses", "300 dias"]);
  assert.deepEqual([0, 1, 30, 31, 179, 180, null].map(nivelPrazo), ["ok", "low", "low", "mid", "mid", "high", "neutro"]);
  assert.deepEqual(prazo("24 horas"), { texto: "24 horas", dias: 1 });
  assert.deepEqual(prazo("24 meses"), { texto: "24 meses", dias: 720 });
  assert.deepEqual(prazo("720 dias"), { texto: "24 meses", dias: 720 });
  assert.deepEqual(prazo("sem carência"), { texto: "sem carência", dias: null });
});

test("seletor traz as situações reais e uma lista por situação", () => {
  const s = montarSnapshot(plano("amil-ouro-total"), { vidas, over: {}, cliente: "", opts }, corretor);
  const P = paraProposta(s);
  assert.equal(P.situacoes.length, 3);
  assert.equal(P.situacoes[0], "Sem plano anterior · PRC 607");
  assert.equal(P.carencias.length, 21);
  assert.equal(P.carencias[1].prazos[0].texto, "1 dia");
  assert.equal(P.carencias[1].prazos[2].texto, "0 dia");
  const html = renderizarProposta(s);
  // Enfermaria e apartamento na mesma cor: nenhum preço em destaque.
  assert.ok(!html.includes("featured"));
  assert.equal(html.match(/<div class="price">/g).length, 2);
  assert.equal(html.match(/data-situacao=/g).length, 3);
  assert.equal(html.match(/class="car-list" data-situacao="\d"( hidden)?/g).filter((x) => !x.includes("hidden")).length, 1);
});

test("observação só aparece quando marcada, no link e na imagem", () => {
  const p = { ...plano("plam-saude-pf"), descricao: "Observação de teste" };
  assert.ok(!renderizarProposta(montarSnapshot(p, { vidas, over: {}, cliente: "", opts }, corretor)).includes("Observação de teste"));
  const s = montarSnapshot({ ...p, mostrarObservacao: true }, { vidas, over: {}, cliente: "", opts }, corretor);
  assert.ok(renderizarProposta(s).includes("Observação de teste"));
  const html = renderizarProposta(s);
  assert.ok(html.indexOf("Observação de teste") < html.indexOf("</aside>"), "fica na barra lateral");
  assert.ok(renderizarProposta(s, {}, { paraImagem: true }).includes("Observação de teste"));
});

test("marcar observação fica salvo no plano", async (t) => {
  const { admin } = await subir(t, ativo);
  const p = (await (await fetch(admin + "/api/planos")).json())[0];
  assert.equal(p.mostrarObservacao, false);
  const r = await fetch(admin + "/api/planos/" + p.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...p, mostrarObservacao: true }) });
  assert.equal((await r.json()).mostrarObservacao, true);
});

test("PLAMEDH BASIC usa 3 faixas e soma as idades no grupo", () => {
  const p = plano("plamedh-basic-pme");
  const v = planPrices(p, [1, 1, 0, 2, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(v.linhas.map((l) => [l.faixa, l.n]), [["0 a 18", 1], ["19 a 58", 3], ["59 ou mais", 1]]);
  assert.equal(v.enf, 1645.25);
  assert.equal(v.apto, null);
  const html = renderizarProposta(montarSnapshot(p, { vidas: [1, 1, 0, 2, 0, 0, 0, 0, 0, 1], over: {}, cliente: "", opts }, corretor));
  assert.ok(html.includes("19 a 58 anos") && html.includes(">3</td>") && html.includes("R$ 275,85") && html.includes("R$ 1.645,25"));
  assert.ok(html.includes("/img/logo-plamedh.png"));
  assert.ok(!html.includes(">Apartamento<"));
  // Os outros planos seguem com as 10 faixas.
  assert.equal(planPrices(plano("plam-saude-pf"), [0, 1, 1, 0, 0, 0, 0, 0, 0, 0]).linhas.length, 2);
});

test("PLAM TOTAL CNPJ traz os valores da tabela nas 10 faixas", () => {
  const p = plano("plam-total-cnpj");
  assert.equal(p.categoria, "CNPJ");
  const v = planPrices(p, [1, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  assert.equal(v.enf, 916.78);
  assert.equal(v.apto, 1220.06);
  assert.equal(v.linhas.length, 2);
});

test("banco na versão anterior recebe só o PLAM TOTAL", (t) => {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-total-"));
  t.after(() => rmSync(pasta, { recursive: true, force: true }));
  const arq = join(pasta, "c.db");
  let b = new Banco(arq, seed);
  b.excluirPlano("plam-total-cnpj");
  b.excluirPlano("plamedh-basic-pme");
  b.db.exec("PRAGMA user_version = 6");
  b.fechar();
  b = new Banco(arq, seed);
  assert.ok(b.obterPlano("plam-total-cnpj"));
  assert.equal(b.obterPlano("plamedh-basic-pme"), null);
  b.fechar();
});

test("planos CNPJ ficam com fidelidade ao atualizar, e a marcação pode ser retirada depois", (t) => {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-fid-"));
  t.after(() => rmSync(pasta, { recursive: true, force: true }));
  const arq = join(pasta, "c.db");
  let b = new Banco(arq, seed);
  const id = "plam-total-cnpj";
  b.gravarPlano(id, { ...b.obterPlano(id), fidelidade: false });
  b.db.exec("PRAGMA user_version = 7");
  b.fechar();
  b = new Banco(arq, seed);
  assert.ok(b.listarPlanos().filter((p) => p.categoria === "CNPJ").every((p) => p.fidelidade));
  assert.ok(b.listarPlanos().filter((p) => p.categoria === "PF").every((p) => !p.fidelidade));
  b.gravarPlano(id, { ...b.obterPlano(id), fidelidade: false });
  b.fechar();
  b = new Banco(arq, seed);
  assert.equal(b.obterPlano(id).fidelidade, false);
  b.fechar();
});

test("SulAmérica muda de tabela a partir de 3 vidas", () => {
  const p = plano("sulamerica-direto-nacional");
  const duas = planPrices(p, [1, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
  assert.equal(duas.enf, 610.04);
  assert.equal(duas.apto, 671);
  const tres = planPrices(p, [2, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
  assert.equal(tres.enf, 691.55);
  assert.equal(tres.apto, 760.67);
  const so = planPrices(plano("sulamerica-executivo-pleno"), [0, 0, 0, 0, 0, 0, 0, 0, 0, 3]);
  assert.equal(so.enf, null);
  assert.equal(so.apto, 11240.76);
  // Plano sem a segunda tabela não muda.
  assert.equal(planPrices(plano("plam-saude-pf"), [3, 0, 0, 0, 0, 0, 0, 0, 0, 0]).enf, 519.09);
  const pagina = renderizarProposta(montarSnapshot(p, { vidas, over: {}, cliente: "", opts }, corretor));
  assert.ok(pagina.includes('id="situacao"') && pagina.includes("Prazo contratual") && pagina.includes("52,32"));
});

test("banco antigo recebe o plano novo uma vez; se excluído, não volta", (t) => {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-novo-"));
  t.after(() => rmSync(pasta, { recursive: true, force: true }));
  const arq = join(pasta, "c.db");
  let b = new Banco(arq, seed);
  b.excluirPlano("plamedh-basic-pme");
  b.db.exec("PRAGMA user_version = 5");
  b.fechar();
  b = new Banco(arq, seed);
  assert.ok(b.obterPlano("plamedh-basic-pme"));
  b.excluirPlano("plamedh-basic-pme");
  b.fechar();
  b = new Banco(arq, seed);
  assert.equal(b.obterPlano("plamedh-basic-pme"), null);
  b.fechar();
});

test("coparticipação e carências não mostram a quantidade de itens", () => {
  const s = montarSnapshot(plano("plam-saude-pf"), { vidas, over: {}, cliente: "", opts }, corretor);
  for (const html of [renderizarProposta(s), renderizarProposta(s, {}, { paraImagem: true })]) {
    assert.ok(html.includes("<h2>Coparticipação</h2>") && html.includes("<h2>Carências</h2>"));
    assert.doesNotMatch(html, /· \d+ ite(m|ns)/);
  }
});

test("seções sem itens não aparecem e valores sob consulta", () => {
  const vazio = { ...plano("plam-saude-pf"), copartTabela: "", carenciaTabela: "", imgCopart: "", imgCarencia: "", faixasEnf: null, faixasApto: null, enfermaria: null, apartamento: null };
  const html = renderizarProposta(montarSnapshot(vazio, { vidas: Array(10).fill(0), over: {}, cliente: "", opts }, corretor), { token: "x".repeat(22) });
  assert.ok(!html.includes(">Coparticipação"));
  assert.ok(!html.includes(">Carências"));
  assert.ok(html.includes("Sob consulta"));
  assert.ok(!html.includes("Aceitar proposta"));
});

test("sem tabela em texto usa a imagem reserva", () => {
  const p = { ...plano("plam-saude-pf"), copartTabela: "", carenciaTabela: "" };
  const html = renderizarProposta(montarSnapshot(p, { vidas, over: {}, cliente: "", opts }, corretor));
  assert.ok(html.includes(`src="/${p.imgCopart}"`));
  assert.ok(html.includes(`src="/${p.imgCarencia}"`));
});

test("todos os planos reais geram a página", () => {
  for (const p of planos) {
    const html = renderizarProposta(montarSnapshot(plano(p.id), { vidas, over: {}, cliente: "Maria", opts }, corretor), { token: "x".repeat(22) });
    assert.ok(html.includes(p.nome), p.id);
    assert.ok(!html.includes("undefined"), p.id);
  }
});

test("acomodação sem valor em alguma faixa não aparece", () => {
  const html = renderizarProposta(montarSnapshot(plano("amil-platinum-r1-total"), { vidas, over: {}, cliente: "", opts }, corretor));
  assert.ok(!html.includes('class="label">Enfermaria'));
  assert.ok(html.includes('class="label">Apartamento'));
});

test("texto digitado é escapado", () => {
  const html = renderizarProposta(montarSnapshot(plano("plam-saude-pf"), { vidas, over: {}, cliente: "<script>alert(1)</script>", opts }, corretor));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("onclick"));
});

test("versão para imagem é a página do link, sem script nem formulário", () => {
  const s = montarSnapshot(plano("amil-ouro-total"), { vidas, over: {}, cliente: "Maria", opts }, corretor);
  const html = renderizarProposta(s, {}, { paraImagem: true });
  assert.ok(!html.includes("<script") && !html.includes("<form"));
  assert.ok(html.includes("Aceitar proposta") && html.includes('id="situacao"'));
  const semAceite = (h) => h.replace(/<details class="aceitar">.*?<\/details>/s, "").replace(/<script.*<\/script>/, "");
  assert.equal(semAceite(html), semAceite(renderizarProposta(s, { token: "x".repeat(22) })));
});

test("prévia da imagem funciona sem link ativo e não salva proposta", async (t) => {
  const { admin, banco } = await subir(t, () => ({ estado: "parado", url: "" }));
  const r = await fetch(admin + "/api/propostas/previa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planos: ["plam-saude-pf"], vidas, over: {}, cliente: "Maria", opts }) });
  assert.equal(r.status, 200);
  const { paginas } = await r.json();
  assert.equal(paginas[0].id, "plam-saude-pf");
  assert.ok(paginas[0].html.includes("R$ 769,76"));
  assert.equal(banco.listarAceites().length, 0);
  assert.equal((await (await pedir(admin, { planos: ["plam-saude-pf"], vidas, over: {}, cliente: "Maria", opts })).status), 503);
});

test("cria link por plano, reaproveita o mesmo e o cliente abre a página", async (t) => {
  const { admin, publico } = await subir(t, ativo);
  const corpo = { planos: ["plam-saude-pf", "amil-ouro-total"], vidas, over: {}, cliente: "Maria", opts };
  const r = await pedir(admin, corpo);
  assert.equal(r.status, 201);
  const { links } = await r.json();
  assert.equal(links.length, 2);
  assert.notEqual(links[0].url, links[1].url);
  assert.match(links[0].url, /^https:\/\/teste\.trycloudflare\.com\/p\/[\w-]{20,}$/);
  assert.equal((await (await pedir(admin, corpo)).json()).links[0].url, links[0].url);

  const pagina = await fetch(publico + new URL(links[0].url).pathname);
  assert.equal(pagina.status, 200);
  assert.match(pagina.headers.get("x-robots-tag"), /noindex/);
  assert.ok((await pagina.text()).includes("R$ 769,76"));
});

test("página guarda os valores da época mesmo se o plano mudar", async (t) => {
  const { admin, publico, banco } = await subir(t, ativo);
  const { links } = await (await pedir(admin, { planos: ["plam-saude-pf"], vidas, over: {}, cliente: "", opts })).json();
  const p = banco.obterPlano("plam-saude-pf");
  banco.gravarPlano(p.id, { ...p, faixasEnf: Array(10).fill(1) });
  assert.ok((await (await fetch(publico + new URL(links[0].url).pathname)).text()).includes("R$ 769,76"));
});

test("servidor público não dá acesso à API, ao histórico nem aos arquivos do app", async (t) => {
  const { admin, publico } = await subir(t, ativo);
  await fetch(admin + "/api/cotacoes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fone: "34999990000", cliente: "Maria", tipo: "PF", vidas, planos: [{ id: "x", nome: "x" }], mensagem: "segredo" }) });
  for (const caminho of ["/", "/index.html", "/js/app.js", "/api/status", "/api/cotacoes", "/api/planos", "/api/backup", "/api/config", "/p/curto", "/p/tokenquenaoexistedeverdade123", "/dados/cotador.db", "/uploads/../cotador.db", "/img/../js/app.js"]) {
    const r = await fetch(publico + caminho);
    assert.equal(r.status, 404, caminho);
    assert.ok(!(await r.text()).includes("segredo"), caminho);
  }
  const envio = await fetch(publico + "/api/restaurar", { method: "POST", body: "x" });
  assert.equal(envio.status, 404);
  assert.equal((await fetch(publico + "/fonts/manrope-latin-wght-normal.woff2")).status, 200);
  const script = await fetch(publico + "/proposta-pagina.js");
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type"), /javascript/);
  assert.match(script.headers.get("content-security-policy"), /script-src 'self'/);
  assert.match((await fetch(publico + "/filtro-select.js")).headers.get("content-type"), /javascript/);
});

async function criarLink(admin, publico, extra = {}) {
  const { links } = await (await pedir(admin, { planos: ["plam-saude-pf"], vidas, over: {}, cliente: "Maria", fone: "(34) 99999-0000", opts, ...extra })).json();
  return publico + new URL(links[0].url).pathname;
}
const aceitar = (url, campos) => fetch(url + "/aceite", {
  method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(campos),
});
const listar = async (admin) => (await fetch(admin + "/api/aceites")).json();

test("abrir o link não aceita; aceite exige acomodação válida e confirmação", async (t) => {
  const { admin, publico } = await subir(t, ativo);
  const url = await criarLink(admin, publico);
  const pagina = await (await fetch(url)).text();
  assert.ok(pagina.includes("Aceitar proposta"));
  assert.ok(pagina.includes('value="Enfermaria"') && pagina.includes('value="Apartamento"'));
  assert.equal((await listar(admin)).length, 0);

  await aceitar(url, { acomodacao: "Apartamento" });
  await aceitar(url, { acomodacao: "Suíte", confirmo: "1" });
  assert.equal((await listar(admin)).length, 0);

  const r = await aceitar(url, { acomodacao: "Apartamento", confirmo: "1" });
  assert.equal(r.status, 303);
  const [a] = await listar(admin);
  assert.equal(a.fone, "34999990000");
  assert.equal(a.cliente, "Maria");
  assert.equal(a.plano, "PLAM SAÚDE");
  assert.equal(a.acomodacao, "Apartamento");
  assert.equal(a.valor, 1198.87);
  assert.equal(a.docsEnviadosEm, null);
});

test("só o primeiro aceite vale e a página avisa que a lista de documentos virá depois", async (t) => {
  const { admin, publico, banco } = await subir(t, ativo);
  banco.gravarConfig({ fone: "(34) 90000-2222" });
  banco.criarDocumento("RG e CPF", "PF");
  banco.criarDocumento("Comprovante <de> residência", "PF");
  banco.criarDocumento("Cartão CNPJ", "CNPJ");
  const url = await criarLink(admin, publico);
  await aceitar(url, { acomodacao: "Enfermaria", confirmo: "1" });
  await aceitar(url, { acomodacao: "Apartamento", confirmo: "1" });
  const lista = await listar(admin);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].acomodacao, "Enfermaria");
  const pagina = await (await fetch(url)).text();
  assert.ok(pagina.includes("Proposta aceita"));
  assert.ok(pagina.includes("Você receberá a lista de documentos necessários para contratação."));
  // O corretor escolhe os documentos de cada cliente: a página não lista os do plano.
  assert.ok(!pagina.includes("RG e CPF") && !pagina.includes("residência") && !pagina.includes("Cartão CNPJ"));
  assert.ok(pagina.includes("Falar com o corretor no WhatsApp"));
  assert.ok(!pagina.includes('action="/p/'));
  assert.ok(pagina.includes("phone=5534900002222"));
});

test("cadastra documentos por cartão de plano, que valem para todas as opções do cartão", async (t) => {
  const { admin, publico, banco } = await subir(t, ativo);
  const api = (caminho, metodo, corpo) => fetch(admin + caminho, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo && JSON.stringify(corpo) });
  const plam = { tipo: "PF", cartao: "PLAM SAÚDE" }, ouro = { tipo: "PF", cartao: "AMIL OURO" };
  assert.equal((await api("/api/documentos", "POST", { ...plam, nome: "  " })).status, 400);
  // Sem plano, ou com plano que não existe, não cadastra.
  assert.equal((await api("/api/documentos", "POST", { nome: "RG" })).status, 400);
  assert.equal((await api("/api/documentos", "POST", { tipo: "PF", cartao: "NÃO EXISTE", nome: "RG" })).status, 400);
  assert.equal((await api("/api/documentos", "POST", { tipo: "MEI", cartao: "PLAM SAÚDE", nome: "RG" })).status, 400);

  const r = await api("/api/documentos", "POST", { ...plam, nome: "RG" });
  assert.equal(r.status, 201);
  const rg = await r.json();
  assert.equal(rg.tipo, "PF");
  assert.equal((await api("/api/documentos", "POST", { ...plam, nome: "rg" })).status, 400);
  const cpf = await (await api("/api/documentos", "POST", { ...plam, nome: "CPF" })).json();
  // O mesmo documento pode estar em outro cartão; cada cartão tem a sua lista.
  assert.equal((await api("/api/documentos", "POST", { ...ouro, nome: "RG" })).status, 201);
  assert.deepEqual(banco.documentosDoPlano("plam-saude-pf"), ["RG", "CPF"]);
  assert.deepEqual(banco.documentosDoPlano("amil-ouro-total"), ["RG"]);
  assert.deepEqual(banco.documentosDoPlano("amil-ouro-parcial"), ["RG"]);
  assert.deepEqual(banco.documentosDoPlano("plam-total-cnpj"), []);
  // Opção nova de um cartão já pede os documentos dele.
  const novo = await (await api("/api/planos", "POST", { nome: "AMIL OURO MEI", categoria: "PF" })).json();
  assert.deepEqual(banco.documentosDoPlano(novo.id), ["RG"]);

  const lista = await (await api("/api/documentos", "GET")).json();
  const cartaoOuro = lista.find((c) => c.tipo === "PF" && c.nome === "AMIL OURO");
  assert.deepEqual(cartaoOuro.documentos.map((d) => d.nome), ["RG"]);
  assert.ok(cartaoOuro.planos.length >= 3);

  // Renomear num cartão não muda o documento dos outros.
  assert.equal((await (await api(`/api/documentos/${rg.id}`, "PUT", { ...ouro, nome: "RG ou CNH" })).json()).nome, "RG ou CNH");
  assert.deepEqual(banco.documentosDoPlano("amil-ouro-total"), ["RG ou CNH"]);
  assert.deepEqual(banco.documentosDoPlano("plam-saude-pf"), ["RG", "CPF"]);
  assert.equal((await (await api(`/api/documentos/${cpf.id}`, "PUT", { ...plam, nome: "CPF novo" })).json()).nome, "CPF novo");
  assert.equal((await api(`/api/documentos/${cpf.id}`, "PUT", { ...plam, nome: "RG" })).status, 400);
  assert.equal((await api(`/api/documentos/${cpf.id}`, "PUT", { ...plam, nome: "cpf NOVO" })).status, 200);

  // A lista do aceite acompanha as mudanças feitas depois do aceite.
  const url = await criarLink(admin, publico);
  await aceitar(url, { acomodacao: "Enfermaria", confirmo: "1" });
  assert.deepEqual((await listar(admin))[0].documentos, ["RG", "cpf NOVO"]);

  const tirar = (id, c) => api(`/api/documentos/${id}?${new URLSearchParams(c)}`, "DELETE");
  assert.equal((await tirar(cpf.id, plam)).status, 204);
  assert.equal((await tirar(cpf.id, plam)).status, 404);
  assert.deepEqual((await listar(admin))[0].documentos, ["RG"]);
  // Tirar de um cartão não tira dos outros; o documento que não sobra em nenhum plano some.
  assert.equal((await tirar(rg.id, plam)).status, 204);
  assert.deepEqual(banco.documentosDoPlano("amil-ouro-total"), ["RG ou CNH"]);
  assert.ok(!banco.listarDocumentos().some((d) => d.nome === "RG" && d.tipo === "PF"));
  assert.equal((await fetch(publico + "/api/documentos")).status, 404);
});

// Lista que as versões 39 e 40 põem em todo plano CNPJ fora da Unimed PME.
const DOCUMENTOS_CNPJ = [
  "CARTÃO CNPJ",
  "CONTRATO SOCIAL DA EMPRESA OU CCMEI",
  "DOCUMENTAÇÃO DOS RESPONSÁVEIS DA EMPRESA (CPF E RG OU CNH)",
  "COMPROVANTE DE ENDEREÇO DOS RESPONSÁVEIS",
  "E-MAIL E TELEFONES DE CONTATO DA EMPRESA",
  "CPF E RG OU CNH DO TITULAR E DEPENDENTES",
  "E-MAIL E TELEFONES DE CONTATO DO TITULAR E DEPENDENTES",
];

test("a versão 40 troca a lista empresarial pelos nomes novos e não mexe na Unimed PME", async (t) => {
  const { banco } = await subir(t, ativo);
  // Banco que já tinha recebido a lista da versão 39, com uma mudança feita à mão na Unimed.
  banco.adicionarDocumentoAoCartao("CNPJ", "UNIMED", "Documento extra da Unimed");
  banco.adicionarDocumentoAoCartao("CNPJ", "PLAM TOTAL", "CÓPIA DO CPF E RG OU CNH DO TITULAR E DOS DEPENDENTES");
  banco.db.exec("PRAGMA user_version = 39");
  banco.fechar();
  banco.abrir();
  assert.deepEqual(banco.documentosDoPlano("plam-total-cnpj"), DOCUMENTOS_CNPJ);
  assert.deepEqual(banco.documentosDoPlano("amil-pme-ouro-30-mei"), DOCUMENTOS_CNPJ);
  assert.ok(banco.documentosDoPlano("unimed-pleno-on-pme").includes("Documento extra da Unimed"));
  assert.ok(!banco.listarDocumentos().some((d) => d.nome.startsWith("CÓPIA DO CPF")));
});

test("listas antigas de PF e CNPJ viram documentos dos planos do tipo", async (t) => {
  const { banco } = await subir(t, ativo);
  banco.db.exec("DROP TABLE documentos; DROP TABLE documentos_planos; PRAGMA user_version = 3;");
  banco.db.exec("INSERT INTO config (chave, valor) VALUES ('docsPf', 'RG\n\n CPF '), ('docsCnpj', 'RG\nContrato social')");
  banco.db.prepare("UPDATE planos SET categoria = 'CNPJ' WHERE id = 'amil-ouro-total'").run();
  banco.fechar();
  banco.abrir();
  // A lista de pessoa física vira documentos dos planos PF; os de CNPJ depois dão lugar à lista empresarial (versão 39).
  assert.deepEqual(banco.listarDocumentos().filter((d) => d.tipo === "PF").map((d) => d.nome), ["RG", "CPF"]);
  assert.deepEqual(banco.documentosDoPlano("plam-saude-pf"), ["RG", "CPF"]);
  assert.deepEqual(banco.documentosDoPlano("amil-ouro-total"), DOCUMENTOS_CNPJ);
  assert.deepEqual(Object.keys(banco.lerConfig()).sort(), ["empresa", "fone", "nome"]);
});

test("documento pode valer só numa opção do plano, como o CCMEI nos planos MEI", async (t) => {
  const { admin, banco } = await subir(t, ativo);
  const api = (rota, metodo, json) => fetch(admin + rota, { method: metodo, headers: { "Content-Type": "application/json" }, body: json ? JSON.stringify(json) : undefined });
  const ouro = { tipo: "CNPJ", cartao: "AMIL OURO" };
  assert.equal((await api("/api/documentos", "POST", { ...ouro, nome: "Cartão CNPJ" })).status, 201);
  const mei = ["amil-pme-ouro-30-mei", "amil-pme-ouro-40-mei", "amil-pme-ouro-parcial-mei"];
  for (const plano of mei) assert.equal((await api("/api/documentos", "POST", { ...ouro, plano, nome: "CCMEI" })).status, 201);
  // Já cadastrado na opção: recusa; opção de outro plano: recusa.
  assert.equal((await api("/api/documentos", "POST", { ...ouro, plano: mei[0], nome: "ccmei" })).status, 400);
  assert.equal((await api("/api/documentos", "POST", { ...ouro, plano: "plam-total-cnpj", nome: "RG" })).status, 400);
  assert.deepEqual(banco.documentosDoPlano("amil-pme-ouro-30-mei"), ["Cartão CNPJ", "CCMEI"]);
  assert.deepEqual(banco.documentosDoPlano("amil-pme-ouro-30"), ["Cartão CNPJ"]);
  const cartao = (await (await api("/api/documentos")).json()).find((c) => c.tipo === "CNPJ" && c.nome === "AMIL OURO");
  assert.equal(cartao.planos.length, 6);
  assert.deepEqual(cartao.documentos.find((d) => d.nome === "CCMEI").planos, mei);
  // Excluir numa opção tira só dela.
  const ccmei = cartao.documentos.find((d) => d.nome === "CCMEI");
  assert.equal((await api(`/api/documentos/${ccmei.id}?${new URLSearchParams({ ...ouro, plano: mei[2] })}`, "DELETE")).status, 204);
  assert.deepEqual(banco.documentosDoPlano("amil-pme-ouro-parcial-mei"), ["Cartão CNPJ"]);
  assert.deepEqual(banco.documentosDoPlano("amil-pme-ouro-40-mei"), ["Cartão CNPJ", "CCMEI"]);
  // Renomear numa opção muda só nela.
  assert.equal((await (await api(`/api/documentos/${ccmei.id}`, "PUT", { ...ouro, plano: mei[1], nome: "CCMEI atualizado" })).json()).nome, "CCMEI atualizado");
  assert.deepEqual(banco.documentosDoPlano("amil-pme-ouro-40-mei"), ["Cartão CNPJ", "CCMEI atualizado"]);
  assert.deepEqual(banco.documentosDoPlano("amil-pme-ouro-30-mei"), ["Cartão CNPJ", "CCMEI"]);
  // Cadastrar em todas as opções completa as que ainda não tinham.
  assert.equal((await api("/api/documentos", "POST", { ...ouro, nome: "CCMEI" })).status, 201);
  assert.deepEqual(banco.documentosDoPlano("amil-pme-ouro-30"), ["Cartão CNPJ", "CCMEI"]);
});

test("documento é de pessoa física ou de CNPJ, conforme o plano", async (t) => {
  const { admin, banco } = await subir(t, ativo);
  const api = (rota, metodo, json) => fetch(admin + rota, { method: metodo, headers: { "Content-Type": "application/json" }, body: json ? JSON.stringify(json) : undefined });
  const contrato = await (await api("/api/documentos", "POST", { tipo: "CNPJ", cartao: "PLAM TOTAL", nome: "Contrato social" })).json();
  assert.equal(contrato.tipo, "CNPJ");
  // O cartão é do tipo informado: PLAM TOTAL não é de pessoa física.
  assert.equal((await api("/api/documentos", "POST", { tipo: "PF", cartao: "PLAM TOTAL", nome: "RG" })).status, 400);
  assert.equal((await api("/api/documentos", "POST", { tipo: "PF", cartao: "PLAM SAÚDE", nome: "RG" })).status, 201);
  assert.equal((await api("/api/documentos", "POST", { tipo: "CNPJ", cartao: "PLAM TOTAL", nome: "rg" })).status, 201);
  assert.deepEqual(banco.documentosDoPlano("plam-saude-pf"), ["RG"]);
  assert.deepEqual(banco.documentosDoPlano("plam-total-cnpj"), ["Contrato social", "rg"]);
  // Os planos da Unimed CNPJ ficam num cartão só.
  assert.equal((await api("/api/documentos", "POST", { tipo: "CNPJ", cartao: "UNIMED", nome: "Cartão CNPJ" })).status, 201);
  assert.deepEqual(banco.documentosDoPlano("unimed-pleno-on-pme"), ["Cartão CNPJ"]);
  assert.deepEqual(banco.documentosDoPlano("unimed-pontual-on-pme"), ["Cartão CNPJ"]);
});

test("documentos que valiam para todo o tipo ficam em todos os planos dele ao atualizar", async (t) => {
  const { banco } = await subir(t, ativo);
  banco.db.exec("DELETE FROM documentos_planos; DELETE FROM documentos;");
  banco.criarDocumento("RG", "PF");
  banco.criarDocumento("Contrato social", "CNPJ");
  banco.db.exec("PRAGMA user_version = 37");
  banco.fechar();
  banco.abrir();
  assert.deepEqual(banco.documentosDoPlano("plam-saude-pf"), ["RG"]);
  assert.deepEqual(banco.documentosDoPlano("amil-ouro-total"), ["RG"]);
  // Os planos CNPJ recebem logo depois a lista empresarial (versão 39); a Unimed PME, a lista dela.
  assert.ok(banco.cartoesDeDocumentos().filter((c) => c.tipo === "CNPJ" && c.nome !== "UNIMED").every((c) => c.documentos.map((d) => d.nome).join() === DOCUMENTOS_CNPJ.join()));
});

test("ao atualizar, a Unimed PME recebe a lista da Unimed e os outros planos CNPJ a lista empresarial", async (t) => {
  const { banco } = await subir(t, ativo);
  banco.db.exec("DELETE FROM documentos_planos; DELETE FROM documentos;");
  banco.adicionarDocumentoAoCartao("CNPJ", "UNIMED", "Documento antigo");
  banco.adicionarDocumentoAoCartao("CNPJ", "UNIMED", "Cartão CNPJ");
  banco.adicionarDocumentoAoCartao("CNPJ", "PLAM TOTAL", "Cartão CNPJ");
  banco.db.exec("PRAGMA user_version = 38");
  banco.fechar();
  banco.abrir();
  const lista = [
    "Cartão CNPJ",
    "Contrato Social registrado no órgão competente ou requerimento de empresário, registrado na junta comercial",
    "Última alteração contratual (se houver)",
    "Cópia do RG/CNH do responsável pela assinatura do contrato",
    "Inscrição Municipal ou Alvará de Funcionamento",
    "DCTFweb com demonstrativo CLT e recibo de transmissão",
    "Relatório S2200 e E-social completo",
    "RG/CNH dos titulares",
    "Comprovante de endereço atualizado (sócio ou administrador)",
    "Cartão Nacional do SUS dos titulares",
    "RG/CNH dos dependentes (cônjuge e filhos/enteados)",
    "Cartão Nacional do SUS dos dependentes",
    "Certidão de Casamento ou União Estável",
    "Certidão de Escolaridade (filhos/enteados de 19 a 23 anos e 11 meses)",
  ];
  for (const id of ["unimed-pleno-on-pme", "unimed-udiplan-on-pme", "unimed-pontual-on-pme", "unimed-uniplan-on-pme"]) {
    assert.deepEqual(banco.documentosDoPlano(id), lista, id);
  }
  // Os outros planos CNPJ ficam com a lista empresarial; o documento que não sobra em nenhum plano some.
  assert.deepEqual(banco.documentosDoPlano("plam-total-cnpj"), DOCUMENTOS_CNPJ);
  assert.deepEqual(banco.documentosDoPlano("amil-pme-ouro-30-mei"), DOCUMENTOS_CNPJ);
  assert.ok(!banco.listarDocumentos().some((d) => d.nome === "Documento antigo"));
});

test("documento ativo nos dois tipos vira dois ao atualizar", async (t) => {
  const { banco } = await subir(t, ativo);
  // A versão 21 separou os documentos por tipo: o banco volta para a 20.
  const versao = 21;
  // Volta à tabela antiga, sem tipo, com um documento em todos os planos e outro só em CNPJ.
  banco.db.exec(`DROP TABLE documentos; DELETE FROM documentos_planos;
    CREATE TABLE documentos (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL UNIQUE COLLATE NOCASE);
    INSERT INTO documentos (id, nome) VALUES (1, 'Comprovante'), (2, 'Contrato social'), (3, 'Sem plano');
    INSERT INTO documentos_planos (documento_id, plano_id) SELECT 1, id FROM planos;
    INSERT INTO documentos_planos (documento_id, plano_id) SELECT 2, id FROM planos WHERE categoria = 'CNPJ';
    PRAGMA user_version = ${versao - 1};`);
  banco.fechar();
  banco.abrir();
  // Os de pessoa física continuam; os de CNPJ dão lugar à lista empresarial (versão 39).
  assert.deepEqual(banco.listarDocumentos().filter((d) => d.tipo === "PF").map((d) => d.nome), ["Comprovante", "Sem plano"]);
  assert.deepEqual(banco.documentosDoPlano("plam-saude-pf"), ["Comprovante", "Sem plano"]);
  assert.deepEqual(banco.documentosDoPlano("plam-total-cnpj"), DOCUMENTOS_CNPJ);
});

test("link antigo, sem o id do plano, encontra os documentos pelo nome", async (t) => {
  const { banco } = await subir(t, ativo);
  banco.adicionarDocumentoAoCartao("PF", "PLAM SAÚDE", "RG");
  assert.deepEqual(banco.documentosDaProposta({ plano: { nome: "PLAM SAÚDE" } }), ["RG"]);
  assert.deepEqual(banco.documentosDaProposta({ plano: { nome: "Plano apagado" } }), []);
});

test("enviar documentos abre o WhatsApp do telefone atual de Meus dados", async (t) => {
  const { admin, publico, banco } = await subir(t, ativo);
  const salvarFone = (fone) => fetch(admin + "/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome: "Corretor", fone, empresa: "" }) });
  const destino = async (url) => (await (await fetch(url)).text()).match(/send\/?\?phone=(\d+)/)?.[1];
  await salvarFone("(34) 90000-1111");
  const url = await criarLink(admin, publico);
  const doc = await (await fetch(admin + "/api/documentos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome: "RG", tipo: "PF", cartao: "PLAM SAÚDE" }) })).json();
  assert.ok(doc);
  await aceitar(url, { acomodacao: "Enfermaria", confirmo: "1" });
  assert.equal(await destino(url), "5534900001111");

  await salvarFone("(34) 90000-2222");
  assert.equal(await destino(url), "5534900002222");

  // Sem telefone em Meus dados, usa o que ficou guardado na proposta.
  await salvarFone("");
  assert.equal(await destino(url), "5534900001111");
  assert.ok(banco.listarAceites().length === 1);
});

test("clientes diferentes com os mesmos dados têm links e aceites separados", async (t) => {
  const { admin, publico } = await subir(t, ativo);
  const a = await criarLink(admin, publico, { fone: "34999990000" });
  const b = await criarLink(admin, publico, { fone: "34988887777" });
  assert.notEqual(a, b);
  await aceitar(b, { acomodacao: "Enfermaria", confirmo: "1" });
  assert.deepEqual((await listar(admin)).map((x) => x.fone), ["34988887777"]);
  assert.ok((await (await fetch(a)).text()).includes("Aceitar proposta"));
});

test("marca documentos enviados só em aceite existente", async (t) => {
  const { admin, publico } = await subir(t, ativo);
  const url = await criarLink(admin, publico);
  const token = url.split("/").pop();
  const marcar = (tk) => fetch(`${admin}/api/aceites/${tk}/documentos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal((await marcar(token)).status, 404);
  await aceitar(url, { acomodacao: "Enfermaria", confirmo: "1" });
  assert.equal((await marcar(token)).status, 200);
  assert.ok((await listar(admin))[0].docsEnviadosEm);
});

test("exclui só proposta aceita, e o link dela deixa de abrir", async (t) => {
  const { admin, publico } = await subir(t, ativo);
  const url = await criarLink(admin, publico);
  const token = url.split("/").pop();
  const excluir = (tk) => fetch(`${admin}/api/aceites/${tk}`, { method: "DELETE" });
  // Proposta ainda não aceita não sai por aqui.
  assert.equal((await excluir(token)).status, 404);
  assert.equal((await fetch(url)).status, 200);
  await aceitar(url, { acomodacao: "Enfermaria", confirmo: "1" });
  assert.equal((await listar(admin)).length, 1);
  assert.equal((await excluir(token)).status, 204);
  assert.equal((await listar(admin)).length, 0);
  assert.equal((await fetch(url)).status, 404);
  assert.equal((await excluir(token)).status, 404);
  assert.equal((await fetch(publico + `/api/aceites/${token}`, { method: "DELETE" })).status, 404);
});

test("servidor público não expõe a lista de aceites", async (t) => {
  const { publico } = await subir(t, ativo);
  assert.equal((await fetch(publico + "/api/aceites")).status, 404);
  assert.equal((await aceitar(publico + "/p/tokenquenaoexistedeverdade123", { acomodacao: "Enfermaria", confirmo: "1" })).status, 404);
});

test("sem PUBLIC_URL o link é local; com domínio usa o domínio", () => {
  assert.deepEqual(enderecoDosLinks("", 3211), { url: "http://127.0.0.1:3211", local: true });
  assert.deepEqual(enderecoDosLinks(undefined, 3211), { url: "http://127.0.0.1:3211", local: true });
  assert.deepEqual(enderecoDosLinks(" https://propostas.exemplo.com.br/ ", 3211), { url: "https://propostas.exemplo.com.br", local: false });
  assert.equal(enderecoDosLinks("nao e endereco", 3211).local, true);
});

test("com os links indisponíveis avisa e valida o pedido", async (t) => {
  const { admin } = await subir(t, () => ({ estado: "conectando", url: null }));
  const r = await pedir(admin, { planos: ["plam-saude-pf"], vidas, opts });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).codigo, "sem_link");
  assert.equal((await pedir(admin, { planos: [], vidas })).status, 400);
  assert.equal((await pedir(admin, { planos: ["x"], vidas: [1] })).status, 400);
});
