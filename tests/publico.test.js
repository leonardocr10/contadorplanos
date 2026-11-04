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
  for (const trecho of ["PLAM SAÚDE", "Proposta para", "Maria", "3 vidas · 0 a 18, 29 a 33 e 34 a 38 anos", "R$ 769,76", "R$ 1.198,87", "R$ 7,00 de taxa associativa", "Consulta médica", "Carências", "Hospital Santa Marta", "Nexyum", "tel:349", "noindex"]) {
    assert.ok(html.includes(trecho), trecho);
  }
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
  assert.ok(!plam.includes("Rede ·"));
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

test("mostra o subtotal de cada faixa etária", () => {
  const html = renderizarProposta(montarSnapshot(plano("plam-saude-pf"), { vidas: [1, 0, 0, 2, 0, 0, 0, 0, 0, 0], over: {}, cliente: "", opts }, corretor));
  assert.ok(html.includes("Valor por faixa etária"));
  assert.match(html, /<b>0 a 18 anos<\/b>\s*<span>Enf\. R\$ 173,03<\/span>\s*<span>Apto R\$ 271,74<\/span>/);
  assert.match(html, /<b>29 a 33 anos <span class="vezes">× 2<\/span><\/b>\s*<span>Enf\. R\$ 561,44<\/span>\s*<span>Apto R\$ 862,46<\/span>/);
});

test("faixas escondem a acomodação sem valor e somem sem idades", () => {
  const html = renderizarProposta(montarSnapshot(plano("amil-platinum-r1-total"), { vidas, over: {}, cliente: "", opts }, corretor));
  assert.ok(!html.includes("<span>Enf. "));
  assert.ok(html.includes("<span>Apto "));
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
  assert.equal(P.situacoes.length, 5);
  assert.equal(P.situacoes[1], "Sem plano anterior · PRC 607");
  assert.equal(P.carencias.length, 20);
  assert.equal(P.carencias[1].prazos[0].texto, "180 dias");
  assert.equal(P.carencias[1].prazos[1].texto, "1 dia");
  assert.equal(P.precos.at(-1).destaque, true);
  const html = renderizarProposta(s);
  assert.equal(html.match(/data-situacao=/g).length, 5);
  assert.equal(html.match(/class="car-list" data-situacao="\d"( hidden)?/g).filter((x) => !x.includes("hidden")).length, 1);
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

test("versão para imagem tem o botão e o seletor do modelo, sem script nem formulário", () => {
  const s = montarSnapshot(plano("amil-ouro-total"), { vidas, over: {}, cliente: "Maria", opts }, corretor);
  const html = renderizarProposta(s, {}, { paraImagem: true });
  assert.ok(!html.includes("<script") && !html.includes("<form"));
  assert.ok(html.includes("Aceitar proposta") && html.includes('id="situacao"'));
  assert.ok(html.includes('class="faixas-lado"') && !html.includes('<section class="faixas"'));
  assert.ok(html.includes("0 a 18") && html.includes("34 a 38"));
  assert.match(renderizarProposta(s), /<script type="module"/);
  assert.ok(!renderizarProposta(s).includes('class="faixas-lado"'));
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
  await fetch(admin + "/api/cotacoes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fone: "34999990000", tipo: "PF", vidas, planos: [{ id: "x", nome: "x" }], mensagem: "segredo" }) });
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

test("só o primeiro aceite vale e a página passa a mostrar os documentos", async (t) => {
  const { admin, publico, banco } = await subir(t, ativo);
  banco.gravarConfig({ fone: "(34) 90000-2222" });
  banco.criarDocumento("RG e CPF", "plam-saude-pf");
  banco.criarDocumento("Comprovante <de> residência", "plam-saude-pf");
  banco.criarDocumento("Cartão CNPJ", "amil-ouro-total");
  const url = await criarLink(admin, publico);
  await aceitar(url, { acomodacao: "Enfermaria", confirmo: "1" });
  await aceitar(url, { acomodacao: "Apartamento", confirmo: "1" });
  const lista = await listar(admin);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].acomodacao, "Enfermaria");
  const pagina = await (await fetch(url)).text();
  assert.ok(pagina.includes("Proposta aceita"));
  assert.ok(pagina.includes("RG e CPF"));
  assert.ok(pagina.includes("Comprovante &lt;de&gt; residência"));
  assert.ok(!pagina.includes("Cartão CNPJ"));
  assert.ok(!pagina.includes('action="/p/'));
  assert.ok(pagina.includes("phone=5534900002222"));
});

test("cadastra documentos e ativa ou inativa por plano", async (t) => {
  const { admin, publico, banco } = await subir(t, ativo);
  const api = (caminho, metodo, corpo) => fetch(admin + caminho, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo && JSON.stringify(corpo) });
  assert.equal((await api("/api/documentos", "POST", { nome: "  " })).status, 400);
  assert.equal((await api("/api/documentos", "POST", { nome: "RG", planoId: "nao-existe" })).status, 404);

  const r = await api("/api/documentos", "POST", { nome: "RG", planoId: "plam-saude-pf" });
  assert.equal(r.status, 201);
  const rg = await r.json();
  assert.deepEqual(rg.planos, ["plam-saude-pf"]);
  assert.equal((await api("/api/documentos", "POST", { nome: "rg" })).status, 400);

  const cpf = await (await api("/api/documentos", "POST", { nome: "CPF" })).json();
  assert.deepEqual(cpf.planos, []);
  assert.deepEqual(banco.documentosDoPlano("plam-saude-pf"), ["RG"]);

  const ligado = await api(`/api/documentos/${cpf.id}/planos/plam-saude-pf`, "PUT", { ativo: true });
  assert.deepEqual((await ligado.json()).planos, ["plam-saude-pf"]);
  assert.deepEqual(banco.documentosDoPlano("plam-saude-pf"), ["RG", "CPF"]);
  assert.deepEqual(banco.documentosDoPlano("amil-ouro-total"), []);
  await api(`/api/documentos/${rg.id}/planos/plam-saude-pf`, "PUT", { ativo: false });
  assert.deepEqual(banco.documentosDoPlano("plam-saude-pf"), ["CPF"]);
  assert.equal((await api(`/api/documentos/${rg.id}/planos/plam-saude-pf`, "PUT", { ativo: "sim" })).status, 400);
  assert.equal((await api(`/api/documentos/${rg.id}/planos/nao-existe`, "PUT", { ativo: true })).status, 404);

  assert.equal((await (await api(`/api/documentos/${rg.id}/planos`, "PUT", { ativo: true })).json()).planos.length, 13);
  assert.equal((await (await api(`/api/documentos/${rg.id}/planos`, "PUT", { ativo: false })).json()).planos.length, 0);

  assert.equal((await (await api(`/api/documentos/${cpf.id}`, "PUT", { nome: "CPF novo" })).json()).nome, "CPF novo");
  assert.equal((await api(`/api/documentos/${cpf.id}`, "PUT", { nome: "RG" })).status, 400);
  assert.equal((await api(`/api/documentos/${cpf.id}`, "PUT", { nome: "cpf NOVO" })).status, 200);

  // A lista do aceite acompanha o plano e as mudanças feitas depois do aceite.
  const url = await criarLink(admin, publico);
  await aceitar(url, { acomodacao: "Enfermaria", confirmo: "1" });
  assert.deepEqual((await listar(admin))[0].documentos, ["cpf NOVO"]);
  assert.ok((await (await fetch(url)).text()).includes("cpf NOVO"));

  assert.equal((await api(`/api/documentos/${cpf.id}`, "DELETE")).status, 204);
  assert.equal((await api(`/api/documentos/${cpf.id}`, "DELETE")).status, 404);
  assert.deepEqual((await listar(admin))[0].documentos, []);
  assert.equal((await fetch(publico + "/api/documentos")).status, 404);
});

test("excluir plano remove os vínculos dele", async (t) => {
  const { banco } = await subir(t, ativo);
  const d = banco.criarDocumento("RG", "plam-saude-pf");
  banco.excluirPlano("plam-saude-pf");
  assert.deepEqual(banco.obterDocumento(d.id).planos, []);
});

test("listas antigas de PF e CNPJ viram documentos dos planos do tipo", async (t) => {
  const { banco } = await subir(t, ativo);
  banco.db.exec("DROP TABLE documentos; DROP TABLE documentos_planos; PRAGMA user_version = 3;");
  banco.db.exec("INSERT INTO config (chave, valor) VALUES ('docsPf', 'RG\n\n CPF '), ('docsCnpj', 'RG\nContrato social')");
  banco.db.prepare("UPDATE planos SET categoria = 'CNPJ' WHERE id = 'amil-ouro-total'").run();
  banco.fechar();
  banco.abrir();
  assert.deepEqual(banco.listarDocumentos().map((d) => d.nome), ["RG", "CPF", "Contrato social"]);
  assert.deepEqual(banco.documentosDoPlano("plam-saude-pf"), ["RG", "CPF"]);
  assert.deepEqual(banco.documentosDoPlano("amil-ouro-total"), ["RG", "Contrato social"]);
  assert.deepEqual(Object.keys(banco.lerConfig()).sort(), ["empresa", "fone", "nome"]);
});

test("link antigo, sem o id do plano, encontra os documentos pelo nome", async (t) => {
  const { banco } = await subir(t, ativo);
  banco.criarDocumento("RG", "plam-saude-pf");
  assert.deepEqual(banco.documentosDaProposta({ plano: { nome: "PLAM SAÚDE" } }), ["RG"]);
  assert.deepEqual(banco.documentosDaProposta({ plano: { nome: "Plano apagado" } }), []);
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
