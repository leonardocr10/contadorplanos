import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Banco } from "../server/db.js";
import { criarApp } from "../server/app.js";
import { conferirSenha, gerarHash } from "../server/senhas.js";

const raiz = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const seed = join(raiz, "dados", "planos.json");
const SENHA_ADMIN = "senha-do-admin-1";

async function subir(t, env = { LOGIN_USUARIO: "chefe", LOGIN_SENHA: SENHA_ADMIN }, preparar, linkPublico) {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-usr-"));
  const banco = new Banco(join(pasta, "c.db"), seed);
  preparar?.(banco);
  const sistema = { versao: async () => ({ commit: "abc", data: "2026-01-01" }), atualizar: async () => ({ atualizado: false }) };
  const app = criarApp({ banco, pastaPublica: join(raiz, "public"), pastaUploads: join(pasta, "u"), pastaBackups: join(pasta, "b"), env, exigirLogin: true, sistema, ...(linkPublico ? { linkPublico } : {}) });
  const servidor = await new Promise((ok) => { const s = app.listen(0, "127.0.0.1", () => ok(s)); });
  t.after(() => new Promise((fim) => { servidor.closeAllConnections(); servidor.close(() => { banco.fechar(); rmSync(pasta, { recursive: true, force: true }); fim(); }); }));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const entrar = async (usuario, senha) => {
    const r = await fetch(base + "/login", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ usuario, senha }) });
    return { status: r.status, cookie: r.headers.get("set-cookie")?.split(";")[0] };
  };
  const pedir = (cookie, rota, metodo = "GET", json) => fetch(base + rota, { method: metodo, redirect: "manual", headers: { cookie, ...(json ? { "Content-Type": "application/json" } : {}) }, body: json ? JSON.stringify(json) : undefined });
  return { banco, base, entrar, pedir };
}

const pedido = { planos: ["plam-saude-pf"], vidas: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0], over: {}, cliente: "Maria", opts: {} };

test("a senha guardada não é a senha e só confere com a certa", () => {
  const hash = gerarHash("minha-senha");
  assert.ok(!hash.includes("minha-senha"));
  assert.ok(conferirSenha("minha-senha", hash));
  assert.ok(!conferirSenha("outra", hash));
  assert.ok(!conferirSenha("minha-senha", "lixo"));
  assert.notEqual(gerarHash("minha-senha"), hash);
});

test("o .env cria só o primeiro administrador, com os dados que já existiam", async (t) => {
  const { banco, entrar, pedir } = await subir(t, undefined, (b) => b.gravarConfig({ nome: "Ruggieria", fone: "34988880000", empresa: "Consult" }));
  const { status, cookie } = await entrar("chefe", SENHA_ADMIN);
  assert.equal(status, 303);
  const eu = await (await pedir(cookie, "/api/eu")).json();
  assert.equal(eu.perfil, "admin");
  assert.equal(eu.nome, "Ruggieria");
  assert.equal(eu.empresa, "Consult");
  assert.equal(JSON.stringify(eu).includes("hash"), false);
  // O hash fica no banco, e a senha do .env não aparece em lugar nenhum dele.
  const guardado = banco.lerHashDaSenha(eu.id);
  assert.ok(!guardado.includes(SENHA_ADMIN));
  assert.ok(conferirSenha(SENHA_ADMIN, guardado));
  assert.equal(banco.contarUsuarios(), 1);
});

test("sem usuário nem .env, ninguém entra", async (t) => {
  const { base, entrar } = await subir(t, {});
  assert.equal((await entrar("x", "y")).status, 503);
  assert.match(await (await fetch(base + "/login")).text(), /LOGIN_USUARIO/);
});

test("login e senha errados são recusados, com o mesmo aviso", async (t) => {
  const { entrar } = await subir(t);
  assert.equal((await entrar("chefe", "errada")).status, 401);
  assert.equal((await entrar("ninguem", SENHA_ADMIN)).status, 401);
  // O login não diferencia maiúsculas.
  assert.equal((await entrar("CHEFE", SENHA_ADMIN)).status, 303);
});

test("usuário comum não acessa o que é do administrador", async (t) => {
  const { entrar, pedir } = await subir(t);
  const admin = (await entrar("chefe", SENHA_ADMIN)).cookie;
  const criado = await pedir(admin, "/api/usuarios", "POST", { login: "corretor1", senha: "senha-do-corretor", perfil: "usuario" });
  assert.equal(criado.status, 201);
  assert.equal(JSON.stringify(await criado.json()).includes("hash"), false);
  const comum = (await entrar("corretor1", "senha-do-corretor")).cookie;
  for (const [rota, metodo] of [["/api/usuarios", "GET"], ["/api/usuarios", "POST"], ["/api/backup", "GET"], ["/api/restaurar", "POST"], ["/api/sistema/versao", "GET"], ["/api/sistema/atualizar", "POST"], ["/api/usuarios/x", "DELETE"], ["/api/usuarios/x", "PUT"]]) {
    assert.equal((await pedir(comum, rota, metodo, metodo === "GET" ? undefined : {})).status, 403, `${metodo} ${rota}`);
    assert.notEqual((await pedir(admin, rota, metodo === "POST" && rota === "/api/sistema/atualizar" ? "POST" : "GET")).status, 401);
  }
  assert.equal((await pedir(admin, "/api/backup")).status, 200);
  assert.equal((await pedir(admin, "/api/sistema/versao")).status, 200);
  assert.equal((await pedir(comum, "/api/planos")).status, 200);
});

test("nome, telefone e corretora são de cada login e vão na proposta dele", async (t) => {
  const { entrar, pedir } = await subir(t);
  const admin = (await entrar("chefe", SENHA_ADMIN)).cookie;
  await pedir(admin, "/api/config", "PUT", { nome: "Dono", fone: "3411", empresa: "Matriz" });
  await pedir(admin, "/api/usuarios", "POST", { login: "corretor1", senha: "senha-do-corretor" });
  const comum = (await entrar("corretor1", "senha-do-corretor")).cookie;
  assert.deepEqual(await (await pedir(comum, "/api/config")).json(), { nome: "", fone: "", empresa: "" });
  await pedir(comum, "/api/config", "PUT", { nome: "Corretor Um", fone: "3422", empresa: "Filial" });
  assert.equal((await (await pedir(admin, "/api/config")).json()).nome, "Dono");
  const pagina = async (c) => (await (await pedir(c, "/api/propostas/previa", "POST", pedido)).json()).paginas[0].html;
  const doComum = await pagina(comum), doAdmin = await pagina(admin);
  assert.ok(doComum.includes("Corretor Um") && doComum.includes("Filial") && !doComum.includes("Dono"));
  assert.ok(doAdmin.includes("Dono") && !doAdmin.includes("Corretor Um"));
});

test("troca a própria senha conferindo a atual, e as outras sessões caem", async (t) => {
  const { entrar, pedir } = await subir(t);
  const a = (await entrar("chefe", SENHA_ADMIN)).cookie, outra = (await entrar("chefe", SENHA_ADMIN)).cookie;
  const trocar = (atual, nova) => pedir(a, "/api/eu/senha", "PUT", { atual, nova });
  assert.equal((await trocar("errada", "nova-senha-longa")).status, 400);
  assert.equal((await trocar(SENHA_ADMIN, "curta")).status, 400);
  assert.equal((await trocar(SENHA_ADMIN, "nova-senha-longa")).status, 200);
  assert.equal((await pedir(a, "/api/eu")).status, 200);
  assert.equal((await pedir(outra, "/api/eu")).status, 401);
  assert.equal((await entrar("chefe", SENHA_ADMIN)).status, 401);
  assert.equal((await entrar("chefe", "nova-senha-longa")).status, 303);
});

test("o administrador redefine, desativa e exclui, e o acesso cai na hora", async (t) => {
  const { entrar, pedir } = await subir(t);
  const admin = (await entrar("chefe", SENHA_ADMIN)).cookie;
  const u = await (await pedir(admin, "/api/usuarios", "POST", { login: "corretor1", senha: "senha-do-corretor" })).json();
  let comum = (await entrar("corretor1", "senha-do-corretor")).cookie;
  assert.equal((await pedir(admin, "/api/usuarios", "POST", { login: "CORRETOR1", senha: "outra-senha-boa" })).status, 400);
  assert.equal((await pedir(admin, "/api/usuarios", "POST", { login: "a b", senha: "outra-senha-boa" })).status, 400);
  assert.equal((await pedir(admin, "/api/usuarios", "POST", { login: "novo", senha: "curta" })).status, 400);

  await pedir(admin, `/api/usuarios/${u.id}`, "PUT", { senha: "senha-redefinida" });
  assert.equal((await pedir(comum, "/api/eu")).status, 401);
  assert.equal((await entrar("corretor1", "senha-do-corretor")).status, 401);
  comum = (await entrar("corretor1", "senha-redefinida")).cookie;

  await pedir(admin, `/api/usuarios/${u.id}`, "PUT", { ativo: false });
  assert.equal((await pedir(comum, "/api/eu")).status, 401);
  assert.equal((await entrar("corretor1", "senha-redefinida")).status, 401);

  await pedir(admin, `/api/usuarios/${u.id}`, "PUT", { ativo: true });
  comum = (await entrar("corretor1", "senha-redefinida")).cookie;
  assert.equal((await pedir(admin, `/api/usuarios/${u.id}`, "DELETE")).status, 204);
  assert.equal((await pedir(comum, "/api/eu")).status, 401);
});

test("o sistema nunca fica sem administrador", async (t) => {
  const { entrar, pedir } = await subir(t);
  const admin = (await entrar("chefe", SENHA_ADMIN)).cookie;
  const eu = await (await pedir(admin, "/api/eu")).json();
  assert.equal((await pedir(admin, `/api/usuarios/${eu.id}`, "DELETE")).status, 400);
  assert.equal((await pedir(admin, `/api/usuarios/${eu.id}`, "PUT", { ativo: false })).status, 400);
  assert.equal((await pedir(admin, `/api/usuarios/${eu.id}`, "PUT", { perfil: "usuario" })).status, 400);
});

const cotacao = (extra = {}) => ({ fone: "34999990000", cliente: "Maria", tipo: "PF", idades: "", vidas: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0], over: {}, planos: [{ id: "plam-saude-pf", nome: "PLAM SAÚDE", enf: 1, apto: 2 }], mensagem: "Olá", ...extra });

async function doisCorretores(t, preparar, linkPublico) {
  const ctx = await subir(t, undefined, preparar, linkPublico);
  const admin = (await ctx.entrar("chefe", SENHA_ADMIN)).cookie;
  const criar = async (login) => {
    await ctx.pedir(admin, "/api/usuarios", "POST", { login, senha: "senha-do-corretor" });
    return (await ctx.entrar(login, "senha-do-corretor")).cookie;
  };
  return { ...ctx, admin, um: await criar("corretor1"), dois: await criar("corretor2") };
}

test("cada usuário só vê e altera as próprias cotações, e o administrador vê todas", async (t) => {
  const { pedir, admin, um, dois } = await doisCorretores(t);
  await pedir(admin, "/api/config", "PUT", { nome: "Dono" });
  await pedir(um, "/api/config", "PUT", { nome: "Corretor Um" });
  const c = await (await pedir(um, "/api/cotacoes", "POST", cotacao({ usuarioId: "tentativa-de-outro-dono" }))).json();
  await pedir(dois, "/api/cotacoes", "POST", cotacao());
  const lista = async (cookie) => (await pedir(cookie, "/api/cotacoes")).json();
  assert.deepEqual((await lista(um)).map((x) => x.id), [c.id]);
  assert.equal((await lista(um))[0].responsavel, undefined);
  assert.equal((await lista(dois)).length, 1);
  assert.notEqual((await lista(dois))[0].id, c.id);
  const todas = await lista(admin);
  assert.equal(todas.length, 2);
  assert.equal(todas.find((x) => x.id === c.id).responsavel, "Corretor Um");
  assert.notEqual(c.usuarioId, "tentativa-de-outro-dono");
  // A busca por número também respeita o dono.
  assert.equal((await (await pedir(um, "/api/cotacoes?fone=34999990000")).json()).length, 1);
  // Outro usuário não altera, nem descobre que a cotação existe.
  assert.equal((await pedir(dois, `/api/cotacoes/${c.id}`, "PUT", cotacao({ mensagem: "invadiu" }))).status, 404);
  assert.equal((await pedir(dois, `/api/cotacoes/${c.id}`, "PATCH", { status: "Vendida" })).status, 404);
  assert.equal((await pedir(dois, `/api/cotacoes/${c.id}`, "DELETE")).status, 404);
  assert.equal((await lista(um))[0].mensagem, "Olá");
  assert.equal((await pedir(um, `/api/cotacoes/${c.id}`, "PATCH", { status: "Vendida" })).status, 200);
  assert.equal((await pedir(admin, `/api/cotacoes/${c.id}`, "PATCH", { status: "Negativa" })).status, 200);
  // O administrador altera sem virar o dono.
  assert.equal((await lista(um))[0].status, "Negativa");
  assert.equal((await pedir(um, `/api/cotacoes/${c.id}`, "DELETE")).status, 204);
});

test("cotações de antes dos logins ficam só com o administrador", async (t) => {
  const { pedir, admin, um } = await doisCorretores(t, (b) => { b.salvarCotacao({ ...cotacao(), cliente: "Antiga" }); });
  const todas = await (await pedir(admin, "/api/cotacoes")).json();
  assert.equal(todas.length, 1);
  assert.equal(todas[0].cliente, "Antiga");
  assert.equal(todas[0].responsavel, "");
  assert.equal((await (await pedir(um, "/api/cotacoes")).json()).length, 0);
  assert.equal((await pedir(um, `/api/cotacoes/${todas[0].id}`, "DELETE")).status, 404);
});

test("cada usuário só vê os próprios aceites, assinados pelo corretor da proposta", async (t) => {
  const propostaDe = (banco, usuarioId, cliente) => {
    const token = banco.salvarProposta({ cliente, corretor: { nome: "Na época", fone: "341", empresa: "", usuarioId }, precos: { linhas: [] }, plano: { id: "plam-saude-pf", nome: "PLAM SAÚDE", categoria: "PF" } }, "34999990000");
    banco.aceitarProposta(token, "Enfermaria", 100);
    return token;
  };
  const { banco, pedir, admin, um, dois } = await doisCorretores(t);
  const idDe = async (c) => (await (await pedir(c, "/api/eu")).json()).id;
  await pedir(um, "/api/config", "PUT", { nome: "Corretor Um", fone: "3499" });
  const deUm = propostaDe(banco, await idDe(um), "Cliente do Um");
  const antigo = propostaDe(banco, undefined, "Cliente antigo");
  const clientes = async (c) => (await (await pedir(c, "/api/aceites")).json());
  assert.deepEqual((await clientes(um)).map((a) => a.cliente), ["Cliente do Um"]);
  assert.equal((await clientes(um))[0].corretor.nome, "Corretor Um");
  assert.equal((await clientes(dois)).length, 0);
  const todos = await clientes(admin);
  assert.equal(todos.length, 2);
  assert.equal(todos.find((a) => a.token === deUm).responsavel, "Corretor Um");
  assert.equal(todos.find((a) => a.token === antigo).corretor, null);
  assert.equal((await pedir(dois, `/api/aceites/${deUm}/documentos`, "POST", {})).status, 404);
  assert.equal((await pedir(um, `/api/aceites/${antigo}/documentos`, "POST", {})).status, 404);
  assert.equal((await pedir(um, `/api/aceites/${deUm}/documentos`, "POST", {})).status, 200);
});

test("a proposta guarda o corretor que a criou e entra só nos aceites dele", async (t) => {
  const { banco, pedir, admin, um, dois } = await doisCorretores(t, undefined, () => ({ estado: "ativo", url: "http://exemplo", local: false }));
  const eu = await (await pedir(um, "/api/eu")).json();
  const r = await pedir(um, "/api/propostas", "POST", { ...pedido, fone: "34999990000" });
  assert.equal(r.status, 201);
  const token = (await r.json()).links[0].url.split("/p/")[1];
  assert.equal(banco.obterProposta(token).dados.corretor.usuarioId, eu.id);
  banco.aceitarProposta(token, "Enfermaria", 100);
  const quantos = async (c) => (await (await pedir(c, "/api/aceites")).json()).length;
  assert.equal(await quantos(um), 1);
  assert.equal(await quantos(dois), 0);
  assert.equal(await quantos(admin), 1);
});

test("planos e documentos: todos consultam, só o administrador altera", async (t) => {
  const { banco, pedir, admin, um } = await doisCorretores(t);
  const plano = { nome: "PLANO NOVO", categoria: "PF" };
  const doc = (await (await pedir(admin, "/api/documentos", "POST", { nome: "RG", planoId: "plam-saude-pf" })).json());
  const docId = doc.id ?? banco.listarDocumentos()[0].id;
  const proibidos = [
    ["/api/planos", "POST", plano], ["/api/planos/plam-saude-pf", "PUT", plano], ["/api/planos/plam-saude-pf", "DELETE"],
    ["/api/documentos", "POST", { nome: "CPF" }], [`/api/documentos/${docId}`, "PUT", { nome: "Outro" }], [`/api/documentos/${docId}`, "DELETE"],
    [`/api/documentos/${docId}/planos`, "PUT", { ativo: false }], [`/api/documentos/${docId}/planos/plam-saude-pf`, "PUT", { ativo: false }],
    ["/api/ler-tabela", "POST", {}], ["/api/uploads", "POST", {}],
  ];
  for (const [rota, metodo, json] of proibidos) assert.equal((await pedir(um, rota, metodo, json)).status, 403, `${metodo} ${rota}`);
  // Nada mudou, e a consulta segue aberta.
  assert.ok(banco.obterPlano("plam-saude-pf"));
  assert.equal(banco.listarDocumentos().length, 1);
  assert.equal((await pedir(um, "/api/planos")).status, 200);
  assert.equal((await (await pedir(um, "/api/documentos")).json())[0].nome, "RG");
  // O administrador continua alterando.
  assert.equal((await pedir(admin, "/api/planos", "POST", plano)).status, 201);
  assert.equal((await pedir(admin, `/api/documentos/${docId}`, "DELETE")).status, 204);
  // A cotação do usuário continua usando os planos.
  assert.equal((await pedir(um, "/api/propostas/previa", "POST", pedido)).status, 200);
});

test("LOGIN_REDEFINIR_SENHA recupera o acesso do administrador", async (t) => {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-usr-"));
  t.after(() => rmSync(pasta, { recursive: true, force: true }));
  const banco = new Banco(join(pasta, "c.db"), seed);
  const admin = banco.criarUsuario({ login: "chefe", senhaHash: gerarHash("senha-esquecida"), perfil: "admin" });
  const abrir = (env) => criarApp({ banco, pastaPublica: join(raiz, "public"), pastaUploads: join(pasta, "u"), pastaBackups: join(pasta, "b"), env, exigirLogin: true });
  // Sem o pedido, o .env não muda a senha que já existe.
  abrir({ LOGIN_USUARIO: "chefe", LOGIN_SENHA: "senha-do-env" });
  assert.ok(conferirSenha("senha-esquecida", banco.lerHashDaSenha(admin.id)));
  abrir({ LOGIN_USUARIO: "chefe", LOGIN_SENHA: "senha-do-env", LOGIN_REDEFINIR_SENHA: "1" });
  assert.ok(conferirSenha("senha-do-env", banco.lerHashDaSenha(admin.id)));
  banco.fechar();
});

test("a tela só mostra ao administrador o que é dele", () => {
  const html = readFileSync(join(raiz, "public", "index.html"), "utf8");
  assert.ok(!html.includes('data-view="corretor"'));
  assert.match(html, /id="novo" data-admin hidden/);
  assert.match(html, /<form id="doc-form"[^>]*data-admin hidden/);
  // Os itens do administrador começam fechados, e o caminho até eles só aparece para ele.
  for (const [id, item] of [["cfg-atualizar", "atualizar"], ["b-file", "backup"], ["usr-form", "usuarios"]]) {
    const antes = html.slice(0, html.indexOf(`id="${id}"`));
    assert.match(antes.slice(antes.lastIndexOf('class="panel')), new RegExp(`^class="panel cfg-painel" data-cfg="${item}" hidden`), id);
    assert.match(html, new RegExp(`data-abre="${item}" data-admin hidden`), item);
  }
});
