import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Banco } from "../server/db.js";
import { criarApp } from "../server/app.js";
import { criarAppPublica, enderecoDosLinks } from "../server/publico.js";
import { montarSnapshot, renderizarProposta } from "../server/proposta-html.js";

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
  for (const trecho of ["PLAM SAÚDE", "Proposta para Maria", "R$ 769,76", "R$ 1.198,87", "R$ 7,00 de taxa associativa", "Consulta médica", "Carências", "Hospital Santa Marta", "Nexyum", "noindex"]) {
    assert.ok(html.includes(trecho), trecho);
  }
  if (p.descricao) assert.ok(!html.includes(p.descricao));
});

test("benefícios só aparecem com mostrarExtras e opções são respeitadas", () => {
  const amil = renderizarProposta(montarSnapshot(plano("amil-ouro-total"), { vidas, over: {}, cliente: "", opts }, corretor));
  assert.ok(amil.includes("Benefícios do plano"));
  assert.ok(amil.includes('class="tab larga"'));
  const plam = renderizarProposta(montarSnapshot(plano("plam-saude-pf"), { vidas, over: {}, cliente: "", opts: { copart: false, rede: false, acom: false } }, corretor));
  assert.ok(!plam.includes("Benefícios do plano"));
  assert.ok(!plam.includes("Como funciona a coparticipação"));
  assert.ok(!plam.includes("Rede credenciada"));
  assert.ok(!plam.includes("acomodação compartilhada"));
});

test("acomodação sem valor em alguma faixa não aparece", () => {
  const html = renderizarProposta(montarSnapshot(plano("amil-platinum-r1-total"), { vidas, over: {}, cliente: "", opts }, corretor));
  assert.ok(!html.includes(">Enfermaria<"));
  assert.ok(html.includes(">Apartamento<"));
});

test("texto digitado é escapado", () => {
  const html = renderizarProposta(montarSnapshot(plano("plam-saude-pf"), { vidas, over: {}, cliente: "<script>alert(1)</script>", opts }, corretor));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
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
  assert.equal((await fetch(publico + "/fonts/figtree-latin-wght-normal.woff2")).status, 200);
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
  banco.gravarConfig({ docsPf: "RG e CPF\nComprovante <de> residência", docsCnpj: "Cartão CNPJ", fone: "(34) 90000-2222" });
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
