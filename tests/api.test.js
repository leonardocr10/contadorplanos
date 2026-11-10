import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Banco } from "../server/db.js";
import { criarApp } from "../server/app.js";

const raiz = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const seed = join(raiz, "dados", "planos.json");
const planosSeed = JSON.parse(readFileSync(seed, "utf8"));
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082", "hex");

function contexto(t, env = {}) {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-teste-"));
  const banco = new Banco(join(pasta, "cotador.db"), seed);
  const app = criarApp({ banco, pastaPublica: join(raiz, "public"), pastaUploads: join(pasta, "uploads"), pastaBackups: join(pasta, "backups"), env });
  return new Promise((resolve) => {
    const servidor = app.listen(0, "127.0.0.1", () => {
      const base = `http://127.0.0.1:${servidor.address().port}`;
      t.after(() => new Promise((fim) => {
        servidor.closeAllConnections();
        servidor.close(() => { banco.fechar(); rmSync(pasta, { recursive: true, force: true }); fim(); });
      }));
      const json = (caminho, metodo, corpo) => fetch(base + caminho, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      resolve({ base, json, pasta, banco });
    });
  });
}

const cotacao = (extra = {}) => ({
  fone: "+55 (34) 99999-0000", cliente: "Maria", tipo: "PF", idades: "35, 32, 7", vidas: [1, 0, 0, 1, 1, 0, 0, 0, 0, 0], over: {},
  planos: [{ id: "plam-saude-pf", nome: "PLAM SAÚDE", enf: 769.76, apto: 1198.87 }], mensagem: "Olá", ...extra,
});

test("seed traz os 50 planos com os mesmos valores", async (t) => {
  const { base } = await contexto(t);
  const planos = await (await fetch(base + "/api/planos")).json();
  assert.equal(planos.length, 56);
  for (const s of planosSeed) {
    const p = planos.find((x) => x.id === s.id);
    assert.deepEqual(p.faixasEnf, s.faixasEnf ?? null, s.id);
    assert.deepEqual(p.faixasApto, s.faixasApto ?? null, s.id);
    assert.equal(p.enfermaria, s.enfermaria ?? null, s.id);
    assert.equal(p.apartamento, s.apartamento ?? null, s.id);
    assert.equal(p.taxa, s.taxa ?? null, s.id);
    assert.equal(p.copartTabela, s.copartTabela ?? "", s.id);
    assert.equal(p.carenciaTabela, s.carenciaTabela ?? "", s.id);
    assert.equal(p.corPrimaria, s.corPrimaria, s.id);
  }
});

test("seed só roda com a tabela vazia", async (t) => {
  const { banco } = await contexto(t);
  banco.excluirPlano("plam-saude-pf");
  banco.semear();
  assert.equal(banco.listarPlanos().length, 55);
});

test("criar, editar e excluir plano, com erro em português", async (t) => {
  const { base, json } = await contexto(t);
  let r = await json("/api/planos", "POST", { categoria: "PF" });
  assert.equal(r.status, 400);
  assert.match((await r.json()).erro, /nome/);

  r = await json("/api/planos", "POST", { nome: "Plano Ção", categoria: "CNPJ", enfermaria: 10.5, fidelidade: true });
  assert.equal(r.status, 201);
  const criado = await r.json();
  assert.equal(criado.id, "plano-cao");
  assert.equal(criado.fidelidade, true);

  r = await json(`/api/planos/${criado.id}`, "PUT", { nome: "Novo", categoria: "CNPJ", faixasEnf: [1, 2] });
  assert.equal(r.status, 400);
  r = await json(`/api/planos/${criado.id}`, "PUT", { nome: "Novo", categoria: "CNPJ", ativo: false });
  assert.equal((await r.json()).ativo, false);

  assert.equal((await fetch(`${base}/api/planos/${criado.id}`, { method: "DELETE" })).status, 204);
  assert.equal((await fetch(`${base}/api/planos/${criado.id}`, { method: "DELETE" })).status, 404);
});

test("histórico guarda só os dígitos e não duplica cotação idêntica", async (t) => {
  const { base, json } = await contexto(t);
  let r = await json("/api/cotacoes", "POST", cotacao());
  assert.equal(r.status, 201);
  const c = await r.json();
  assert.equal(c.fone, "34999990000");

  r = await json("/api/cotacoes", "POST", cotacao());
  assert.equal(r.status, 200);
  assert.equal((await r.json()).id, c.id);

  // Mesma legenda com outras idades é outra cotação.
  r = await json("/api/cotacoes", "POST", cotacao({ idades: "35", vidas: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0], planos: [{ id: "plam-saude-pf", nome: "PLAM SAÚDE", enf: 316.01, apto: 495.9 }] }));
  assert.equal(r.status, 201);

  await json("/api/cotacoes", "POST", cotacao({ fone: "34988887777", cliente: "João" }));
  const busca = async (q) => (await fetch(`${base}/api/cotacoes?${q}`)).json();
  assert.equal((await busca("")).length, 3);
  assert.equal((await busca("fone=(34) 99999-0000")).length, 2);
  assert.equal((await busca("q=jo%C3%A3o")).length, 1);
  assert.equal((await busca("q=8888")).length, 1);
});

test("só salva a cotação com nome, número e plano", async (t) => {
  const { base, json } = await contexto(t);
  for (const faltando of [{ fone: "123" }, { fone: "" }]) {
    const r = await json("/api/cotacoes", "POST", cotacao(faltando));
    assert.equal(r.status, 400);
    assert.match((await r.json()).erro, /WhatsApp/);
  }
  for (const faltando of [{ cliente: "" }, { cliente: "   " }]) {
    const r = await json("/api/cotacoes", "POST", cotacao(faltando));
    assert.equal(r.status, 400);
    assert.match((await r.json()).erro, /nome/);
  }
  assert.equal((await json("/api/cotacoes", "POST", cotacao({ planos: [] }))).status, 400);
  assert.equal((await (await fetch(base + "/api/cotacoes")).json()).length, 0);
});

test("cotação idêntica de outro cliente não é tratada como repetida", async (t) => {
  const { json } = await contexto(t);
  const a = await (await json("/api/cotacoes", "POST", cotacao())).json();
  const b = await json("/api/cotacoes", "POST", cotacao({ fone: "34988887777" }));
  assert.equal(b.status, 201);
  assert.notEqual((await b.json()).id, a.id);
});

test("a cotação em andamento é atualizada sem virar outra", async (t) => {
  const { base, json } = await contexto(t);
  const c = await (await json("/api/cotacoes", "POST", cotacao({ fone: "34988887777" }))).json();
  await json(`/api/cotacoes/${c.id}`, "PATCH", { status: "Vendida" });
  const r = await json(`/api/cotacoes/${c.id}`, "PUT", cotacao({ cliente: "Agora com nome", mensagem: "outra mensagem" }));
  assert.equal(r.status, 200);
  const nova = await r.json();
  assert.equal(nova.id, c.id);
  assert.equal(nova.cliente, "Agora com nome");
  assert.equal(nova.fone, "34999990000");
  assert.equal(nova.mensagem, "outra mensagem");
  // A data e a situação não mudam.
  assert.equal(nova.criadoEm, c.criadoEm);
  assert.equal(nova.status, "Vendida");
  assert.equal((await (await fetch(base + "/api/cotacoes")).json()).length, 1);
  assert.equal((await json("/api/cotacoes/nao-existe", "PUT", cotacao())).status, 404);
});

test("muda a situação e exclui cotação", async (t) => {
  const { base, json } = await contexto(t);
  const c = await (await json("/api/cotacoes", "POST", cotacao())).json();
  assert.equal(c.status, "Enviada");
  assert.equal((await json(`/api/cotacoes/${c.id}`, "PATCH", { status: "Inventada" })).status, 400);
  assert.equal((await (await json(`/api/cotacoes/${c.id}`, "PATCH", { status: "Vendida" })).json()).status, "Vendida");
  assert.equal((await (await fetch(`${base}/api/cotacoes?status=Vendida`)).json()).length, 1);
  assert.equal((await fetch(`${base}/api/cotacoes/${c.id}`, { method: "DELETE" })).status, 204);
});

test("dados do corretor ficam salvos", async (t) => {
  const { base, json } = await contexto(t);
  await json("/api/config", "PUT", { nome: "Diego", fone: "34", empresa: "X" });
  assert.deepEqual(await (await fetch(base + "/api/config")).json(), { nome: "Diego", fone: "34", empresa: "X" });
});

test("upload aceita imagem de verdade e serve o arquivo", async (t) => {
  const { base, pasta } = await contexto(t);
  const envia = (corpo, tipo) => fetch(base + "/api/uploads", { method: "POST", headers: { "Content-Type": tipo }, body: corpo });
  assert.equal((await envia("nao e imagem", "image/png")).status, 400);
  assert.equal((await envia("texto", "text/plain")).status, 400);
  assert.equal((await envia(Buffer.alloc(16 * 1024 * 1024), "image/png")).status, 413);
  const r = await envia(PNG, "image/png");
  assert.equal(r.status, 201);
  const { caminho } = await r.json();
  assert.match(caminho, /^uploads\/.+\.png$/);
  assert.equal(readdirSync(join(pasta, "uploads")).length, 1);
  assert.equal((await fetch(`${base}/${caminho}`)).status, 200);
});

test("backup baixa o banco e restaurar volta ao estado anterior", async (t) => {
  const { base, json, pasta } = await contexto(t);
  await json("/api/cotacoes", "POST", cotacao());
  const r = await fetch(base + "/api/backup");
  assert.match(r.headers.get("content-disposition"), /cotador-\d{4}-\d{2}-\d{2}_\d{4}\.db/);
  const copia = Buffer.from(await r.arrayBuffer());

  await json("/api/cotacoes", "POST", cotacao({ fone: "34988887777" }));
  const restaura = (corpo) => fetch(base + "/api/restaurar", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: corpo });
  assert.equal((await restaura(Buffer.from("isto nao e um banco qualquer"))).status, 400);
  assert.equal((await (await fetch(base + "/api/cotacoes")).json()).length, 2);

  assert.equal((await restaura(copia)).status, 200);
  assert.equal((await (await fetch(base + "/api/cotacoes")).json()).length, 1);
  assert.equal(readdirSync(join(pasta, "backups")).length, 1);
  assert.ok(existsSync(join(pasta, "cotador.db")));
});

test("o backup leva as imagens junto e a restauração devolve", async (t) => {
  const { base, pasta, banco } = await contexto(t);
  const uploads = join(pasta, "uploads");
  const { caminho } = await (await fetch(base + "/api/uploads", { method: "POST", headers: { "Content-Type": "image/png" }, body: PNG })).json();
  const nome = caminho.split("/")[1];
  writeFileSync(join(uploads, "nao-e-imagem.html"), "<script>alert(1)</script>");
  const copia = Buffer.from(await (await fetch(base + "/api/backup")).arrayBuffer());
  const restaura = (corpo) => fetch(base + "/api/restaurar", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: corpo });

  // Em outro servidor, ou depois de perder a pasta: a imagem volta com o backup.
  rmSync(uploads, { recursive: true, force: true });
  assert.equal((await restaura(copia)).status, 200);
  assert.deepEqual(readdirSync(uploads), [nome]);
  assert.deepEqual(readFileSync(join(uploads, nome)), PNG);
  assert.equal((await fetch(`${base}/${caminho}`)).status, 200);
  // As imagens saem do banco em uso depois de restaurar.
  assert.equal(banco.db.prepare("SELECT name FROM sqlite_master WHERE name = 'backup_imagens'").get(), undefined);

  // Backup antigo, sem imagens, continua valendo e não apaga as atuais.
  const antigo = banco.gerarBackup();
  assert.equal((await restaura(antigo)).status, 200);
  assert.deepEqual(readdirSync(uploads), [nome]);

  // Um arquivo adulterado não escreve fora da pasta nem grava outro tipo de arquivo.
  for (const [falso, conteudo] of [["../fora.png", PNG], ["pagina.html", PNG], ["falsa.png", Buffer.from("<script>alert(1)</script>")]]) {
    const arq = join(pasta, "adulterado.db");
    writeFileSync(arq, copia);
    const db = new DatabaseSync(arq);
    db.prepare("INSERT INTO backup_imagens (nome, dados) VALUES (?, ?)").run(falso, conteudo);
    db.close();
    assert.equal((await restaura(readFileSync(arq))).status, 400, falso);
  }
  assert.deepEqual(readdirSync(uploads), [nome]);
  assert.equal(existsSync(join(pasta, "fora.png")), false);
});

test("sem chave a leitura avisa como configurar", async (t) => {
  const { base, json } = await contexto(t, { ANTHROPIC_API_KEY: "" });
  assert.equal((await (await fetch(base + "/api/status")).json()).leituraDisponivel, false);
  const r = await json("/api/ler-tabela", "POST", { imagens: ["AAAA"] });
  assert.equal(r.status, 503);
  const corpo = await r.json();
  assert.equal(corpo.codigo, "sem_chave");
  assert.match(corpo.erro, /ANTHROPIC_API_KEY/);
});

test("recusa acesso com outro Host", async (t) => {
  const { base } = await contexto(t);
  const { request } = await import("node:http");
  const url = new URL(base + "/api/planos");
  const status = await new Promise((res, rej) => {
    request({ host: url.hostname, port: url.port, path: url.pathname, headers: { Host: "site-malicioso.com" } }, (r) => { r.resume(); res(r.statusCode); }).on("error", rej).end();
  });
  assert.equal(status, 403);
});

test("página e pdf.js são servidos localmente", async (t) => {
  const { base } = await contexto(t);
  assert.match(await (await fetch(base + "/")).text(), /Cotador de Planos/);
  const r = await fetch(base + "/js/calculo.js");
  assert.match(r.headers.get("content-type"), /javascript/);
  if (existsSync(join(raiz, "public", "vendor", "pdfjs", "pdf.min.mjs"))) {
    assert.match((await fetch(base + "/vendor/pdfjs/pdf.min.mjs")).headers.get("content-type"), /javascript/);
  }
});

test("situações antigas do histórico são convertidas ao atualizar", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join: juntar } = await import("node:path");
  const pasta = mkdtempSync(juntar(tmpdir(), "cotador-status-"));
  const arq = juntar(pasta, "c.db");
  let b = new Banco(arq);
  const inserir = b.db.prepare("INSERT INTO cotacoes (id, fone, cliente, criado_em, tipo, idades, vidas, overrides, planos, mensagem, status) VALUES (?, '34900000000', '', '2026-01-01', 'PF', '', '[]', '{}', '[]', '', ?)");
  ["Em negociação", "Fechou", "Perdida", "Enviada"].forEach((s, i) => inserir.run("c" + i, s));
  b.db.exec("PRAGMA user_version = 8");
  b.fechar();
  b = new Banco(arq);
  assert.deepEqual(b.db.prepare("SELECT status FROM cotacoes ORDER BY id").all().map((l) => l.status), ["Em Negociação", "Vendida", "Negativa", "Enviada"]);
  b.fechar();
  rmSync(pasta, { recursive: true, force: true });
});
