import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Banco } from "../server/db.js";
import { criarApp } from "../server/app.js";
import { conferirSenha, gerarHash } from "../server/senhas.js";
import { criarEnviadorDeEmail } from "../server/email.js";
import net from "node:net";

const raiz = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const seed = join(raiz, "dados", "planos.json");
const SENHA_ADMIN = "senha-do-admin-1";

async function subir(t, env = { LOGIN_USUARIO: "chefe", LOGIN_SENHA: SENHA_ADMIN }, preparar, linkPublico, enviarEmail = null) {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-usr-"));
  const banco = new Banco(join(pasta, "c.db"), seed);
  preparar?.(banco);
  const sistema = { versao: async () => ({ commit: "abc", data: "2026-01-01" }), atualizar: async () => ({ atualizado: false }) };
  const app = criarApp({ banco, pastaPublica: join(raiz, "public"), pastaUploads: join(pasta, "u"), pastaBackups: join(pasta, "b"), env, exigirLogin: true, sistema, ...(linkPublico ? { linkPublico } : {}), enviarEmail });
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

test("cada usuário troca e remove a própria foto, e o arquivo antigo é apagado", async (t) => {
  const { base, entrar, pedir } = await subir(t);
  const admin = (await entrar("chefe", SENHA_ADMIN)).cookie;
  await pedir(admin, "/api/usuarios", "POST", { login: "corretor1", email: "c@exemplo.com", senha: "senha-do-corretor" });
  const comum = (await entrar("corretor1", "senha-do-corretor")).cookie;
  const enviar = (cookie, corpo, tipo = "image/jpeg") => fetch(base + "/api/eu/foto", { method: "POST", redirect: "manual", headers: { cookie, "Content-Type": tipo }, body: corpo });
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  assert.notEqual((await enviar("", jpg)).status, 201);
  // O conteúdo decide o tipo, não o cabeçalho.
  assert.equal((await enviar(comum, Buffer.from("<svg onload=alert(1)>"))).status, 400);
  assert.equal((await enviar(comum, Buffer.alloc(3 * 1024 * 1024, 0xff))).status, 413);
  const primeira = await enviar(comum, jpg);
  assert.equal(primeira.status, 201);
  const { foto } = await primeira.json();
  assert.match(foto, /^uploads\/foto-[\w-]+\.jpg$/);
  assert.equal((await (await pedir(comum, "/api/eu")).json()).foto, foto);
  assert.equal((await pedir(comum, `/${foto}`)).status, 200);
  assert.notEqual((await pedir("", `/${foto}`)).status, 200);
  const cadastro = await (await pedir(admin, "/api/usuarios")).json();
  const u = cadastro.find((x) => x.login === "corretor1");
  assert.equal(u.foto, foto);
  // Trocar apaga a anterior.
  const { foto: segunda } = await (await enviar(comum, jpg)).json();
  assert.notEqual(segunda, foto);
  assert.equal((await pedir(comum, `/${foto}`)).status, 404);
  // Remover limpa o cadastro e o arquivo.
  assert.equal((await pedir(comum, "/api/eu/foto", "DELETE")).status, 204);
  assert.equal((await (await pedir(comum, "/api/eu")).json()).foto, "");
  assert.equal((await pedir(comum, `/${segunda}`)).status, 404);
  // Excluir o usuário não deixa a foto para trás.
  const { foto: terceira } = await (await enviar(comum, jpg)).json();
  assert.equal((await pedir(admin, `/api/usuarios/${u.id}`, "DELETE")).status, 204);
  assert.equal((await pedir(admin, `/${terceira}`)).status, 404);
});

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
  const criado = await pedir(admin, "/api/usuarios", "POST", { login: "corretor1", email: "corretor1@exemplo.com", senha: "senha-do-corretor", perfil: "usuario" });
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
  await pedir(admin, "/api/usuarios", "POST", { login: "corretor1", email: "corretor1@exemplo.com", senha: "senha-do-corretor" });
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
  assert.equal((await pedir(a, "/api/eu/senha", "PUT", { nova: "nova-senha-longa" })).status, 400);
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
  const u = await (await pedir(admin, "/api/usuarios", "POST", { login: "corretor1", email: "corretor1@exemplo.com", senha: "senha-do-corretor" })).json();
  let comum = (await entrar("corretor1", "senha-do-corretor")).cookie;
  assert.equal((await pedir(admin, "/api/usuarios", "POST", { login: "CORRETOR1", email: "corretor1@exemplo.com", senha: "outra-senha-boa" })).status, 400);
  assert.equal((await pedir(admin, "/api/usuarios", "POST", { login: "a b", email: "ab@exemplo.com", senha: "outra-senha-boa" })).status, 400);
  assert.equal((await pedir(admin, "/api/usuarios", "POST", { login: "novo", email: "novo@exemplo.com", senha: "curta" })).status, 400);

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
    await ctx.pedir(admin, "/api/usuarios", "POST", { login, email: `${login}@exemplo.com`, senha: "senha-do-corretor" });
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
  const doc = (await (await pedir(admin, "/api/documentos", "POST", { nome: "RG", tipo: "PF", cartao: "PLAM SAÚDE" })).json());
  const docId = doc.id ?? banco.listarDocumentos()[0].id;
  const proibidos = [
    ["/api/planos", "POST", plano], ["/api/planos/plam-saude-pf", "PUT", plano], ["/api/planos/plam-saude-pf", "DELETE"],
    ["/api/documentos", "POST", { nome: "CPF" }], [`/api/documentos/${docId}`, "PUT", { nome: "Outro" }], [`/api/documentos/${docId}`, "DELETE"],
    ["/api/ler-tabela", "POST", {}], ["/api/uploads", "POST", {}],
  ];
  for (const [rota, metodo, json] of proibidos) assert.equal((await pedir(um, rota, metodo, json)).status, 403, `${metodo} ${rota}`);
  // Nada mudou, e a consulta segue aberta.
  assert.ok(banco.obterPlano("plam-saude-pf"));
  assert.equal(banco.listarDocumentos().length, 1);
  assert.equal((await pedir(um, "/api/planos")).status, 200);
  assert.deepEqual((await (await pedir(um, "/api/documentos")).json()).find((c) => c.nome === "PLAM SAÚDE").documentos.map((d) => d.nome), ["RG"]);
  // O administrador continua alterando.
  assert.equal((await pedir(admin, "/api/planos", "POST", plano)).status, 201);
  assert.equal((await pedir(admin, `/api/documentos/${docId}?tipo=PF&cartao=${encodeURIComponent("PLAM SAÚDE")}`, "DELETE")).status, 204);
  // A cotação do usuário continua usando os planos.
  assert.equal((await pedir(um, "/api/propostas/previa", "POST", pedido)).status, 200);
});

const EMAIL_LINK = () => ({ estado: "ativo", url: "http://exemplo:9090", local: false });

test("novo usuário precisa de e-mail válido e que ainda não exista", async (t) => {
  const { pedir, entrar } = await subir(t);
  const admin = (await entrar("chefe", SENHA_ADMIN)).cookie;
  const criar = (extra) => pedir(admin, "/api/usuarios", "POST", { login: "novo.um", senha: "senha-boa-1234", ...extra });
  assert.equal((await criar({})).status, 400);
  assert.equal((await criar({ email: "sem-arroba" })).status, 400);
  const ok = await criar({ email: "Novo@Exemplo.com" });
  assert.equal(ok.status, 201);
  const u = await ok.json();
  assert.equal(u.email, "novo@exemplo.com");
  assert.equal((await pedir(admin, "/api/usuarios", "POST", { login: "novo.dois", email: "NOVO@exemplo.com", senha: "senha-boa-1234" })).status, 400);
  // Dois pedidos iguais ao mesmo tempo: um cria, o outro recebe o aviso, sem erro no servidor.
  const juntos = await Promise.all([1, 2].map(() => pedir(admin, "/api/usuarios", "POST", { login: "ao.mesmo.tempo", email: "juntos@exemplo.com", senha: "senha-boa-1234" })));
  assert.deepEqual(juntos.map((r) => r.status).sort(), [201, 400]);
  // O usuário e o administrador alteram o e-mail, sem repetir o de outro.
  const comum = (await entrar("novo.um", "senha-boa-1234")).cookie;
  await pedir(comum, "/api/config", "PUT", { email: "outro@exemplo.com" });
  assert.equal((await (await pedir(comum, "/api/eu")).json()).email, "outro@exemplo.com");
  // Salvar o mesmo e-mail é permitido, e o cadastro de usuários mostra a alteração.
  assert.equal((await pedir(comum, "/api/config", "PUT", { email: "outro@exemplo.com" })).status, 200);
  const cadastro = await (await pedir(admin, "/api/usuarios")).json();
  assert.equal(cadastro.find((x) => x.login === "novo.um").email, "outro@exemplo.com");
  const chefe = await (await pedir(admin, "/api/eu")).json();
  assert.equal((await pedir(admin, `/api/usuarios/${chefe.id}`, "PUT", { email: "outro@exemplo.com", senha: "senha-que-nao-vale" })).status, 400);
  // O erro no e-mail não pode deixar a senha trocada pela metade.
  assert.equal((await entrar("chefe", "senha-que-nao-vale")).status, 401);
  assert.equal((await pedir(admin, `/api/usuarios/${chefe.id}`, "PUT", { email: "chefe@exemplo.com" })).status, 200);
});

async function comRecuperacao(t) {
  const enviados = [];
  const ctx = await subir(t, undefined, undefined, EMAIL_LINK, async (m) => { enviados.push(m); });
  const admin = (await ctx.entrar("chefe", SENHA_ADMIN)).cookie;
  await ctx.pedir(admin, "/api/usuarios", "POST", { login: "corretor1", email: "corretor@exemplo.com", senha: "senha-do-corretor" });
  const formulario = (rota, dados) => fetch(ctx.base + rota, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(dados) });
  return { ...ctx, admin, enviados, formulario };
}
const tokenDe = (m) => m.texto.match(/token=([\w-]+)/)[1];

test("recupera a senha pelo e-mail, e o link só vale uma vez", async (t) => {
  const { base, banco, entrar, enviados, formulario } = await comRecuperacao(t);
  assert.match(await (await fetch(base + "/login")).text(), /Esqueci minha senha/);
  const r = await formulario("/login/recuperar", { email: "CORRETOR@exemplo.com" });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Se este e-mail estiver cadastrado/);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].para, "corretor@exemplo.com");
  assert.ok(enviados[0].texto.includes("http://exemplo:9090/login/redefinir?token="));
  assert.ok(!enviados[0].texto.includes("senha-do-corretor"));
  const token = tokenDe(enviados[0]);
  // O banco guarda só o hash do link.
  assert.equal(JSON.stringify(banco.db.prepare("SELECT * FROM recuperacoes_senha").all()).includes(token), false);
  const pagina = await fetch(`${base}/login/redefinir?token=${token}`);
  assert.equal(pagina.status, 200);
  assert.equal(pagina.headers.get("referrer-policy"), "no-referrer");
  assert.equal((await formulario("/login/redefinir", { token, senha: "curta", repete: "curta" })).status, 400);
  assert.equal((await formulario("/login/redefinir", { token, senha: "nova-senha-longa", repete: "outra-senha-longa" })).status, 400);
  assert.equal((await formulario("/login/redefinir", { token, senha: "nova-senha-longa", repete: "nova-senha-longa" })).status, 200);
  assert.equal((await entrar("corretor1", "senha-do-corretor")).status, 401);
  assert.equal((await entrar("corretor1", "nova-senha-longa")).status, 303);
  assert.equal((await fetch(`${base}/login/redefinir?token=${token}`)).status, 400);
  assert.equal((await formulario("/login/redefinir", { token, senha: "terceira-senha", repete: "terceira-senha" })).status, 400);
});

test("a recuperação não revela quem está cadastrado e não abre para quem foi desativado", async (t) => {
  const { pedir, admin, enviados, formulario } = await comRecuperacao(t);
  const existe = await (await formulario("/login/recuperar", { email: "corretor@exemplo.com" })).text();
  const naoExiste = await (await formulario("/login/recuperar", { email: "ninguem@exemplo.com" })).text();
  assert.equal(existe, naoExiste);
  assert.equal(enviados.length, 1);
  // Pedido repetido não dispara outro e-mail.
  await formulario("/login/recuperar", { email: "corretor@exemplo.com" });
  assert.equal(enviados.length, 1);
  const u = (await (await pedir(admin, "/api/usuarios")).json()).find((x) => x.login === "corretor1");
  const token = tokenDe(enviados[0]);
  await pedir(admin, `/api/usuarios/${u.id}`, "PUT", { ativo: false });
  assert.equal((await formulario("/login/redefinir", { token, senha: "nova-senha-longa", repete: "nova-senha-longa" })).status, 400);
});

test("o link vencido não serve, e sem e-mail configurado a tela avisa", async (t) => {
  const { banco, enviados, formulario } = await comRecuperacao(t);
  await formulario("/login/recuperar", { email: "corretor@exemplo.com" });
  banco.db.exec("UPDATE recuperacoes_senha SET expira_em = 1");
  const token = tokenDe(enviados[0]);
  assert.equal((await formulario("/login/redefinir", { token, senha: "nova-senha-longa", repete: "nova-senha-longa" })).status, 400);
  assert.equal((await formulario("/login/redefinir", { token: "inventado", senha: "nova-senha-longa", repete: "nova-senha-longa" })).status, 400);
  const sem = await subir(t);
  assert.match(await (await fetch(sem.base + "/login/recuperar")).text(), /ainda não foi configurada/);
  // Com link local, o e-mail levaria a um endereço que só abre no servidor.
  const local = await subir(t, undefined, undefined, () => ({ estado: "ativo", url: "http://127.0.0.1:9090", local: true }), async () => {});
  assert.match(await (await fetch(local.base + "/login/recuperar")).text(), /ainda não foi configurada/);
});

test("o envio funciona de verdade por SMTP", async (t) => {
  const recebido = [];
  const smtp = net.createServer((c) => {
    let dados = false;
    c.write("220 teste\r\n");
    c.on("data", (b) => {
      const texto = b.toString();
      if (dados) {
        recebido.push(texto);
        if (texto.includes("\r\n.\r\n")) { dados = false; c.write("250 ok\r\n"); }
        return;
      }
      if (/^DATA/i.test(texto)) { dados = true; c.write("354 envie\r\n"); return; }
      if (/^QUIT/i.test(texto)) { c.end("221 tchau\r\n"); return; }
      c.write("250 ok\r\n");
    });
  });
  await new Promise((ok) => smtp.listen(0, "127.0.0.1", ok));
  t.after(() => new Promise((fim) => smtp.close(fim)));
  assert.equal(criarEnviadorDeEmail({}), null);
  const enviar = criarEnviadorDeEmail({ SMTP_HOST: "127.0.0.1", SMTP_PORTA: String(smtp.address().port), SMTP_REMETENTE: "cotador@exemplo.com" });
  await enviar({ para: "corretor@exemplo.com", assunto: "Assunto de teste", texto: "Corpo de teste" });
  const mensagem = recebido.join("");
  assert.ok(mensagem.includes("corretor@exemplo.com") && mensagem.includes("Assunto de teste") && mensagem.includes("Corpo de teste"));
});

async function comPermissoes(t, permissoes) {
  const ctx = await subir(t, undefined, undefined, EMAIL_LINK);
  const admin = (await ctx.entrar("chefe", SENHA_ADMIN)).cookie;
  await ctx.pedir(admin, "/api/usuarios", "POST", { login: "corretor1", email: "c@exemplo.com", senha: "senha-do-corretor", permissoes });
  return { ...ctx, admin, comum: (await ctx.entrar("corretor1", "senha-do-corretor")).cookie };
}

test("sem escolher, o usuário fica com o acesso padrão, e o administrador com tudo", async (t) => {
  const { pedir, admin, entrar } = await comPermissoes(t);
  assert.deepEqual((await (await pedir(admin, "/api/eu")).json()).permissoes, { cotacao: "editar", planos: "editar", documentos: "editar", historico: "editar", aceites: "editar", contratos: "editar" });
  const comum = (await entrar("corretor1", "senha-do-corretor")).cookie;
  assert.deepEqual((await (await pedir(comum, "/api/eu")).json()).permissoes, { cotacao: "editar", planos: "ver", documentos: "ver", historico: "editar", aceites: "editar", contratos: "editar" });
});

test("sem acesso a uma tela, as rotas dela ficam fechadas", async (t) => {
  const { pedir, comum } = await comPermissoes(t, { cotacao: "editar", planos: "nenhum", documentos: "nenhum", historico: "nenhum", aceites: "nenhum", contratos: "nenhum" });
  for (const rota of ["/api/documentos", "/api/cotacoes", "/api/aceites", "/api/contratos"]) assert.equal((await pedir(comum, rota)).status, 403, rota);
  assert.equal((await pedir(comum, "/api/planos")).status, 200);
  assert.equal((await pedir(comum, "/api/propostas/previa", "POST", pedido)).status, 200);
  // Cotação com edição salva mesmo sem ver a tela de histórico.
  assert.equal((await pedir(comum, "/api/cotacoes", "POST", cotacao())).status, 201);
});

test("sem nenhuma tela, a pessoa só acessa os próprios dados", async (t) => {
  const { pedir, comum } = await comPermissoes(t, { cotacao: "nenhum", planos: "nenhum", documentos: "nenhum", historico: "nenhum", aceites: "nenhum", contratos: "nenhum" });
  assert.equal((await pedir(comum, "/api/planos")).status, 403);
  assert.equal((await pedir(comum, "/api/propostas/previa", "POST", pedido)).status, 403);
  assert.equal((await pedir(comum, "/api/eu")).status, 200);
  assert.equal((await pedir(comum, "/api/config")).status, 200);
});

test("com visualização, consulta e não altera", async (t) => {
  const { banco, pedir, admin, comum } = await comPermissoes(t, { cotacao: "ver", planos: "ver", documentos: "ver", historico: "ver", aceites: "ver", contratos: "ver" });
  const eu = await (await pedir(comum, "/api/eu")).json();
  for (const rota of ["/api/planos", "/api/documentos", "/api/cotacoes", "/api/aceites", "/api/contratos"]) assert.equal((await pedir(comum, rota)).status, 200, rota);
  assert.equal((await pedir(comum, "/api/propostas/previa", "POST", pedido)).status, 200);
  const c = banco.salvarCotacao({ ...cotacao(), usuarioId: eu.id }).cotacao;
  const proibidos = [
    ["/api/cotacoes", "POST", cotacao()], [`/api/cotacoes/${c.id}`, "PUT", cotacao()], [`/api/cotacoes/${c.id}`, "PATCH", { status: "Vendida" }], [`/api/cotacoes/${c.id}`, "DELETE"],
    ["/api/propostas", "POST", { ...pedido, fone: "34999990000" }], ["/api/propostas/comparativo", "POST", { ...pedido, planos: ["plam-saude-pf", "plamedh-pf"] }],
    ["/api/planos", "POST", { nome: "X", categoria: "PF" }], ["/api/documentos", "POST", { nome: "Y" }], ["/api/aceites/qualquer/documentos", "POST", {}], ["/api/aceites/qualquer", "DELETE"],
    ["/api/contratos", "POST", contrato()], ["/api/contratos/qualquer", "PUT", contrato()], ["/api/contratos/qualquer/contato", "PATCH", { feito: true }], ["/api/contratos/qualquer", "DELETE"],
  ];
  for (const [rota, metodo, json] of proibidos) assert.equal((await pedir(comum, rota, metodo, json)).status, 403, `${metodo} ${rota}`);
  // A permissão muda na hora, sem precisar entrar de novo.
  const editar = { cotacao: "editar", planos: "editar", documentos: "editar", historico: "editar", aceites: "editar", contratos: "editar" };
  assert.equal((await pedir(admin, `/api/usuarios/${eu.id}`, "PUT", { permissoes: editar })).status, 200);
  assert.equal((await pedir(comum, "/api/planos", "POST", { nome: "X", categoria: "PF" })).status, 201);
  assert.equal((await pedir(admin, `/api/usuarios/${eu.id}`, "PUT", { permissoes: { ...editar, planos: "nada" } })).status, 400);
});

const contrato = (extra = {}) => ({ nome: "Maria da Silva", fone: "(34) 99999-1111", plano: "AMIL OURO", valor: 450.9, ativacao: "2026-11-20", ...extra });

test("contratos vendidos: cada usuário vê e altera só os próprios, inclusive o administrador", async (t) => {
  const { pedir, admin, comum } = await comPermissoes(t);
  const doCorretor = await (await pedir(comum, "/api/contratos", "POST", contrato())).json();
  assert.equal(doCorretor.fone, "34999991111");
  assert.equal(doCorretor.valor, 450.9);
  assert.equal(doCorretor.contatoEm, null);
  assert.ok(!("usuarioId" in doCorretor));
  const doAdmin = await (await pedir(admin, "/api/contratos", "POST", contrato({ nome: "João" }))).json();
  assert.deepEqual((await (await pedir(comum, "/api/contratos")).json()).map((c) => c.nome), ["Maria da Silva"]);
  assert.deepEqual((await (await pedir(admin, "/api/contratos")).json()).map((c) => c.nome), ["João"]);
  // O contrato de outro login não é encontrado, nem para o administrador.
  for (const [rota, metodo, json] of [[`/api/contratos/${doCorretor.id}`, "PUT", contrato()], [`/api/contratos/${doCorretor.id}/contato`, "PATCH", { feito: true }], [`/api/contratos/${doCorretor.id}`, "DELETE"]]) {
    assert.equal((await pedir(admin, rota, metodo, json)).status, 404, `${metodo} ${rota}`);
  }
  assert.equal((await pedir(comum, `/api/contratos/${doAdmin.id}`, "DELETE")).status, 404);
  // Contato feito; mudar a data de ativação volta o contato para pendente.
  const feito = await (await pedir(comum, `/api/contratos/${doCorretor.id}/contato`, "PATCH", { feito: true })).json();
  assert.ok(feito.contatoEm);
  const mesmaData = await (await pedir(comum, `/api/contratos/${doCorretor.id}`, "PUT", contrato({ valor: 500 }))).json();
  assert.ok(mesmaData.contatoEm);
  assert.equal(mesmaData.valor, 500);
  const outraData = await (await pedir(comum, `/api/contratos/${doCorretor.id}`, "PUT", contrato({ ativacao: "2026-12-01" }))).json();
  assert.equal(outraData.contatoEm, null);
  assert.equal((await pedir(comum, `/api/contratos/${doCorretor.id}`, "DELETE")).status, 204);
  assert.deepEqual(await (await pedir(comum, "/api/contratos")).json(), []);
});

test("contratos vendidos: dados obrigatórios conferidos no servidor", async (t) => {
  const { pedir, comum } = await comPermissoes(t);
  for (const errado of [{ nome: "" }, { fone: "3499" }, { plano: " " }, { valor: 0 }, { valor: "450" }, { ativacao: "" }, { ativacao: "2026-02-30" }, { ativacao: "20/11/2026" }]) {
    assert.equal((await pedir(comum, "/api/contratos", "POST", contrato(errado))).status, 400, JSON.stringify(errado));
  }
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
  assert.match(html, /id="novo" data-edita="planos" hidden/);
  assert.match(html, /<form id="doc-form"[^>]*data-edita="documentos" hidden/);
  // Os itens do administrador começam fechados, e o caminho até eles só aparece para ele.
  for (const [id, item] of [["cfg-atualizar", "atualizar"], ["b-file", "backup"], ["usr-form", "usuarios"]]) {
    const antes = html.slice(0, html.indexOf(`id="${id}"`));
    assert.match(antes.slice(antes.lastIndexOf('class="panel')), new RegExp(`^class="panel cfg-painel[^"]*" data-cfg="${item}" hidden`), id);
    assert.match(html, new RegExp(`data-abre="${item}" data-admin hidden`), item);
  }
});
