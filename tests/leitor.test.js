import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Banco } from "../server/db.js";
import { criarApp } from "../server/app.js";

const raiz = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SENHA = "senha-do-chefe-123";

test("o leitor roda no navegador, com o leitor de texto servido pelo próprio cotador", async (t) => {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-leitor-"));
  const banco = new Banco(join(pasta, "c.db"), join(raiz, "dados", "planos.json"));
  const app = criarApp({ banco, pastaPublica: join(raiz, "public"), pastaUploads: join(pasta, "u"), pastaBackups: join(pasta, "b"), env: { LOGIN_USUARIO: "chefe", LOGIN_SENHA: SENHA }, exigirLogin: true });
  const servidor = await new Promise((ok) => { const s = app.listen(0, "127.0.0.1", () => ok(s)); });
  t.after(() => new Promise((fim) => { servidor.closeAllConnections(); servidor.close(() => { banco.fechar(); rmSync(pasta, { recursive: true, force: true }); fim(); }); }));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const cookie = (await fetch(base + "/login", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ usuario: "chefe", senha: SENHA }) })).headers.get("set-cookie").split(";")[0];
  // Nenhuma rota manda o documento para fora: a leitura não passa pelo servidor.
  assert.equal((await fetch(base + "/api/ler-documento", { method: "POST", headers: { cookie } })).status, 404);
  const codigo = readFileSync(join(raiz, "public", "js", "leitor.js"), "utf8");
  assert.ok(!/fetch\(|api\(/.test(codigo), "o leitor não chama o servidor nem outros sites");
  assert.ok(codigo.includes('"/vendor/tesseract/"'));
  for (const arquivo of ["tesseract.esm.min.js", "worker.min.js", "tesseract-core-simd-lstm.wasm.js", "lang/por.traineddata.gz"]) {
    const r = await fetch(`${base}/vendor/tesseract/${arquivo}`, { headers: { cookie } });
    assert.equal(r.status, 200, arquivo);
  }
});

test("o acesso à tela do leitor segue a permissão do usuário", async (t) => {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-leitor-"));
  const banco = new Banco(join(pasta, "c.db"), join(raiz, "dados", "planos.json"));
  const app = criarApp({ banco, pastaPublica: join(raiz, "public"), pastaUploads: join(pasta, "u"), pastaBackups: join(pasta, "b"), env: { LOGIN_USUARIO: "chefe", LOGIN_SENHA: SENHA }, exigirLogin: true });
  const servidor = await new Promise((ok) => { const s = app.listen(0, "127.0.0.1", () => ok(s)); });
  t.after(() => new Promise((fim) => { servidor.closeAllConnections(); servidor.close(() => { banco.fechar(); rmSync(pasta, { recursive: true, force: true }); fim(); }); }));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const entrar = async (usuario, senha) => (await fetch(base + "/login", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ usuario, senha }) })).headers.get("set-cookie")?.split(";")[0];
  const pedir = (cookie, rota, metodo = "GET", json) => fetch(base + rota, { method: metodo, headers: { cookie, ...(json ? { "Content-Type": "application/json" } : {}) }, body: json ? JSON.stringify(json) : undefined });
  const admin = await entrar("chefe", SENHA);
  await pedir(admin, "/api/usuarios", "POST", { login: "corretor1", email: "c1@exemplo.com", senha: "senha-do-corretor" });
  await pedir(admin, "/api/usuarios", "POST", { login: "corretor2", email: "c2@exemplo.com", senha: "senha-do-corretor", permissoes: { leitor: "nenhum" } });
  const eu = async (login) => (await (await pedir(await entrar(login, "senha-do-corretor"), "/api/eu")).json()).permissoes.leitor;
  assert.equal(await eu("corretor1"), "editar");
  assert.equal(await eu("corretor2"), "nenhum");
  assert.equal((await (await pedir(admin, "/api/eu")).json()).permissoes.leitor, "editar");
});
