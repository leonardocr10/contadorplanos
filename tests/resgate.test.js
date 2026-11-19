import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Banco } from "../server/db.js";
import { criarApp } from "../server/app.js";
import { LIMITE_POR_DIA, MAX_TENTATIVAS, criarEvolution, criarResgate, horaDeEnviar, instanciaDe, montarMensagem } from "../server/resgate.js";
import { MENSAGEM_RESGATE_PADRAO } from "../public/js/mensagem.js";

const raiz = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const seed = join(raiz, "dados", "planos.json");
const DIA = 24 * 60 * 60_000;
// Segunda-feira, 16/11/2026, 14h em Brasília (17h UTC).
const SEGUNDA_14H = new Date("2026-11-16T17:00:00Z");

function abrirBanco(t) {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-resgate-"));
  const banco = new Banco(join(pasta, "c.db"), seed);
  t.after(() => { banco.fechar(); rmSync(pasta, { recursive: true, force: true }); });
  return banco;
}

const cotacao = (fone, cliente, extra = {}) => ({
  fone, cliente, tipo: "PF", idades: "35", vidas: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0], over: {}, planos: [{ id: "amil-prata", nome: "AMIL PRATA", enf: 300, apto: 400 }], mensagem: `Cotação de ${cliente}`, ...extra,
});
// Grava a cotação com a data de "dias" atrás.
function cotou(banco, usuarioId, fone, cliente, dias, extra = {}) {
  const { cotacao: c } = banco.salvarCotacao({ ...cotacao(fone, cliente, { mensagem: `${cliente} ${dias}`, ...extra }), usuarioId });
  banco.db.prepare("UPDATE cotacoes SET criado_em = ? WHERE id = ?").run(new Date(SEGUNDA_14H.getTime() - dias * DIA).toISOString(), c.id);
  return c;
}
const AGORA = SEGUNDA_14H.toISOString();

// Evolution de mentira: guarda o que foi enviado e responde como o serviço de verdade.
function evolutionFalsa({ estado = "open", semWhatsApp = [], falhar = false } = {}) {
  const enviadas = [];
  return {
    enviadas,
    estado: async () => ({ estado: typeof estado === "function" ? estado() : estado, numero: "5534999990000" }),
    conectar: async (instancia) => ({ qr: `data:image/png;base64,QR-${instancia}`, codigo: "" }),
    desconectar: async () => {},
    enviarTexto: async (instancia, numero, texto) => {
      if (falhar) return { ok: false, erro: "O serviço de WhatsApp não enviou (erro 500)." };
      if (semWhatsApp.includes(numero)) return { ok: false, semWhatsApp: true, erro: "Este número não tem WhatsApp." };
      enviadas.push({ instancia, numero, texto });
      return { ok: true };
    },
  };
}

test("a mensagem usa o primeiro nome do cliente, o plano e o corretor", () => {
  const texto = montarMensagem("", { cliente: "MARIANA ALVES", plano: "AMIL PRATA", corretor: "Ana Souza" });
  assert.ok(texto.startsWith("Olá, Mariana! Tudo bem? 😊"));
  assert.equal(texto, "Olá, Mariana! Tudo bem? 😊\n\nAqui é Ana Souza.\n\nHá alguns meses fizemos uma cotação do plano de saúde para você.\n\nAinda tem interesse em um plano de saúde?\n\nPosso refazer a cotação com os valores de hoje, sem compromisso.");
  // Quem usar {plano} no próprio texto recebe o plano cotado.
  assert.equal(montarMensagem("Cotação do {plano}", { plano: "AMIL PRATA" }), "Cotação do AMIL PRATA");
  // Sem nome, o cumprimento fica sem a vírgula solta.
  assert.ok(montarMensagem(MENSAGEM_RESGATE_PADRAO, { plano: "X" }).startsWith("Olá! Tudo bem?"));
  assert.equal(montarMensagem("Oi {nome}, da {empresa}: {plano}", { cliente: "joão", empresa: "Corretora Alfa" }), "Oi João, da Corretora Alfa: de saúde");
});

test("o envio só acontece em dia útil, das 9h às 18h de Brasília", () => {
  assert.equal(horaDeEnviar(new Date("2026-11-16T12:00:00Z")), true); // segunda, 9h
  assert.equal(horaDeEnviar(new Date("2026-11-16T11:59:00Z")), false); // segunda, 8h59
  assert.equal(horaDeEnviar(new Date("2026-11-16T20:59:00Z")), true); // segunda, 17h59
  assert.equal(horaDeEnviar(new Date("2026-11-16T21:00:00Z")), false); // segunda, 18h
  assert.equal(horaDeEnviar(new Date("2026-11-21T15:00:00Z")), false); // sábado
  assert.equal(horaDeEnviar(new Date("2026-11-22T15:00:00Z")), false); // domingo
});

test("entra no resgate quem cotou há mais de 90 dias e não fechou, uma vez só", (t) => {
  const banco = abrirBanco(t);
  const u = banco.criarUsuario({ login: "ana", senhaHash: "x" });
  cotou(banco, u.id, "34999990001", "Antigo", 120);
  cotou(banco, u.id, "34999990002", "Recente", 30);
  cotou(banco, u.id, "34999990003", "Cotou de novo", 150);
  cotou(banco, u.id, "34999990003", "Cotou de novo", 10, { planos: [{ id: "b", nome: "B", enf: 1, apto: 2 }] });
  cotou(banco, u.id, "34999990004", "Vendido", 200, { status: "Vendida" });
  cotou(banco, u.id, "34999990007", "Negativa", 200, { status: "Negativa" });
  cotou(banco, u.id, "34999990005", "Com contrato", 200);
  const contrato = banco.criarContrato({ nome: "Com contrato", fone: "34999990005", plano: "AMIL PRATA", valor: 300, ativacao: "2026-08-01" });
  banco.db.prepare("UPDATE contratos SET usuario_id = ? WHERE id = ?").run(u.id, contrato.id);
  cotou(banco, "", "34999990006", "Sem dono", 200);
  // O mesmo telefone em outro login é outro resgate, com o WhatsApp de quem cotou.
  const outro = banco.criarUsuario({ login: "joao", senhaHash: "x" });
  cotou(banco, outro.id, "34999990001", "Antigo", 100);

  assert.equal(banco.coletarResgates(AGORA), 2);
  const lista = banco.listarResgates(u.id);
  assert.deepEqual(lista.map((r) => [r.cliente, r.plano, r.status]), [["Antigo", "AMIL PRATA", "pendente"]]);
  assert.equal(banco.listarResgates(outro.id).length, 1);
  // Coletar de novo não repete.
  assert.equal(banco.coletarResgates(AGORA), 0);

  // Quem estava na fila e foi marcado como Negativa sai da fila.
  const c8 = cotou(banco, u.id, "34999990008", "Desistiu", 120);
  banco.coletarResgates(AGORA);
  assert.ok(banco.listarResgates(u.id).some((r) => r.cliente === "Desistiu"));
  banco.mudarStatus(c8.id, "Negativa");
  banco.coletarResgates(AGORA);
  assert.ok(!banco.listarResgates(u.id).some((r) => r.cliente === "Desistiu"));

  // Quem estava na fila e cotou de novo sai da fila.
  cotou(banco, outro.id, "34999990001", "Antigo", 1, { planos: [{ id: "c", nome: "C", enf: 1, apto: 2 }] });
  banco.coletarResgates(AGORA);
  assert.equal(banco.listarResgates(outro.id).length, 0);

  // Depois de enviado, o cliente não recebe outra vez, mesmo que fique mais 90 dias sem cotar.
  banco.marcarResgate(lista[0].id, { status: "enviado", enviadoEm: SEGUNDA_14H.toISOString() });
  cotou(banco, u.id, "34999990001", "Antigo", 95, { planos: [{ id: "d", nome: "D", enf: 1, apto: 2 }] });
  banco.coletarResgates(AGORA);
  assert.deepEqual(banco.listarResgates(u.id).map((r) => r.status), ["enviado"]);

  // Cotação excluída no Histórico: o cliente sai do resgate, esteja na fila, cancelado ou com erro.
  const fila = cotou(banco, u.id, "34999990009", "Excluído na fila", 120);
  const cancelado = cotou(banco, u.id, "34999990010", "Excluído cancelado", 120);
  banco.coletarResgates(AGORA);
  banco.marcarResgate(banco.listarResgates(u.id).find((r) => r.cliente === "Excluído cancelado").id, { status: "cancelado" });
  banco.excluirCotacao(fila.id);
  banco.excluirCotacao(cancelado.id);
  banco.coletarResgates(AGORA);
  assert.deepEqual(banco.listarResgates(u.id).map((r) => r.cliente), ["Antigo"]);
  // O que já foi enviado continua registrado, mesmo sem a cotação.
  for (const c of banco.db.prepare("SELECT id FROM cotacoes WHERE usuario_id = ? AND fone = ?").all(u.id, "34999990001")) banco.excluirCotacao(c.id);
  banco.coletarResgates(AGORA);
  assert.deepEqual(banco.listarResgates(u.id).map((r) => [r.cliente, r.status]), [["Antigo", "enviado"]]);
});

test("cada corretor escolhe os dias sem cotar; mudar os dias refaz a fila", (t) => {
  const banco = abrirBanco(t);
  const ana = banco.criarUsuario({ login: "ana", senhaHash: "x" });
  const joao = banco.criarUsuario({ login: "joao", senhaHash: "x" });
  cotou(banco, ana.id, "34999990001", "Cliente 40 dias", 40);
  cotou(banco, ana.id, "34999990002", "Cliente 100 dias", 100);
  cotou(banco, joao.id, "34999990003", "Cliente 40 dias", 40);
  assert.equal(banco.lerConfigResgate(ana.id).dias, 90);
  banco.gravarConfigResgate(ana.id, { dias: 30 });
  // Os outros campos ficam como estavam.
  assert.deepEqual(banco.lerConfigResgate(ana.id), { ativo: true, mensagem: "", dias: 30, limite: 30, intervaloMin: 2, intervaloMax: 5 });
  banco.coletarResgates(AGORA);
  assert.deepEqual(banco.listarResgates(ana.id).map((r) => r.cliente), ["Cliente 40 dias", "Cliente 100 dias"]);
  // O João continua nos 90 dias.
  assert.equal(banco.listarResgates(joao.id).length, 0);
  // Ao aumentar os dias, quem ainda não chegou no novo limite sai da fila (o que já foi enviado fica).
  banco.gravarConfigResgate(ana.id, { dias: 60 });
  banco.coletarResgates(AGORA);
  assert.deepEqual(banco.listarResgates(ana.id).map((r) => r.cliente), ["Cliente 100 dias"]);
  // Com 0 dias, quem acabou de cotar entra na hora (serve para testar o envio).
  cotou(banco, ana.id, "34999990004", "Cliente de hoje", 0.01);
  banco.gravarConfigResgate(ana.id, { dias: 0 });
  banco.coletarResgates(AGORA);
  assert.ok(banco.listarResgates(ana.id).some((r) => r.cliente === "Cliente de hoje"));
});

test("a rodada envia uma mensagem por vendedor conectado, no horário, com intervalo e limite por dia", async (t) => {
  const banco = abrirBanco(t);
  const ana = banco.criarUsuario({ login: "ana", senhaHash: "x", nome: "Ana Souza" });
  const joao = banco.criarUsuario({ login: "joao", senhaHash: "x" });
  const carla = banco.criarUsuario({ login: "carla", senhaHash: "x" });
  cotou(banco, ana.id, "34999990001", "Mariana Alves", 200);
  cotou(banco, ana.id, "34999990002", "Carlos Pereira", 100);
  cotou(banco, joao.id, "34999990003", "Juliana Costa", 100);
  cotou(banco, carla.id, "34999990004", "Paulo Lima", 100);
  banco.gravarConfigResgate(carla.id, { ativo: false });
  let agora = SEGUNDA_14H;
  const evolution = evolutionFalsa({ estado: () => "open" });
  // João não conectou o WhatsApp.
  evolution.estado = async (instancia) => ({ estado: instancia === instanciaDe(joao.id) ? "close" : "open", numero: "" });
  const resgate = criarResgate({ banco, evolution, relogio: () => agora, sorteio: () => 0 });

  await resgate.rodada();
  // Só a Ana envia, e começa por quem espera há mais tempo.
  assert.deepEqual(evolution.enviadas.map((e) => [e.instancia, e.numero]), [[instanciaDe(ana.id), "5534999990001"]]);
  assert.ok(evolution.enviadas[0].texto.startsWith("Olá, Mariana!"));
  const mariana = banco.listarResgates(ana.id).find((r) => r.cliente === "Mariana Alves");
  assert.equal(mariana.status, "enviado");
  assert.equal(mariana.enviadoEm, SEGUNDA_14H.toISOString());
  assert.equal(mariana.mensagem, evolution.enviadas[0].texto);

  // Um minuto depois ainda é cedo; passado o intervalo, sai a próxima.
  agora = new Date(SEGUNDA_14H.getTime() + 60_000);
  await resgate.rodada();
  assert.equal(evolution.enviadas.length, 1);
  agora = new Date(SEGUNDA_14H.getTime() + 3 * 60_000);
  await resgate.rodada();
  assert.equal(evolution.enviadas.length, 2);

  // Fora do horário nada sai.
  cotou(banco, ana.id, "34999990009", "Fora do horário", 100);
  agora = new Date("2026-11-21T15:00:00Z");
  await resgate.rodada();
  assert.equal(evolution.enviadas.length, 2);

  // O limite do dia vale para os envios das últimas 24 horas.
  agora = new Date(SEGUNDA_14H.getTime() + DIA - 60 * 60_000);
  banco.db.prepare("UPDATE resgates SET enviado_em = ? WHERE status = 'enviado'").run(new Date(agora.getTime() - 60_000).toISOString());
  for (let i = 0; i < LIMITE_POR_DIA - 2; i++) {
    banco.db.prepare("INSERT INTO resgates (id, usuario_id, fone, cotacao_em, status, criado_em, enviado_em) VALUES (?, ?, ?, ?, 'enviado', ?, ?)")
      .run(`r-lim-${i}`, ana.id, `3400000${String(i).padStart(4, "0")}`, "2026-01-01", "2026-01-01", agora.toISOString());
  }
  await resgate.rodada();
  assert.equal(evolution.enviadas.length, 2);
  assert.equal(banco.listarResgates(carla.id)[0].status, "pendente");
});

test("cada vendedor escolhe quantas mensagens por dia e o intervalo entre elas", async (t) => {
  const banco = abrirBanco(t);
  const ana = banco.criarUsuario({ login: "ana", senhaHash: "x" });
  for (let i = 1; i <= 5; i++) cotou(banco, ana.id, `3499999000${i}`, `Cliente ${i}`, 100 + i);
  banco.gravarConfigResgate(ana.id, { limite: 2, intervaloMin: 10, intervaloMax: 20 });
  let agora = SEGUNDA_14H;
  const evolution = evolutionFalsa();
  // Sorteio no meio: a espera fica em 15 minutos.
  const resgate = criarResgate({ banco, evolution, relogio: () => agora, sorteio: () => 0.5 });
  const em = async (minutos) => { agora = new Date(SEGUNDA_14H.getTime() + minutos * 60_000); await resgate.rodada(); return evolution.enviadas.length; };

  assert.equal(await em(0), 1);
  assert.equal(await em(14), 1);
  assert.equal(await em(15), 2);
  // Chegou ao limite de 2 no dia: mesmo depois do intervalo, nada sai.
  assert.equal(await em(40), 2);
  // Subindo o limite e encurtando o intervalo, vale já na próxima volta.
  banco.gravarConfigResgate(ana.id, { limite: 5, intervaloMin: 1, intervaloMax: 1 });
  assert.equal(await em(41), 3);
  assert.equal(await em(41.5), 3);
  assert.equal(await em(42), 4);
});

test("número sem WhatsApp para na hora; outras falhas tentam de novo até o limite", async (t) => {
  const banco = abrirBanco(t);
  const ana = banco.criarUsuario({ login: "ana", senhaHash: "x" });
  cotou(banco, ana.id, "34999990001", "Sem Zap", 200);
  let agora = SEGUNDA_14H;
  const resgate = criarResgate({ banco, evolution: evolutionFalsa({ semWhatsApp: ["5534999990001"] }), relogio: () => agora, sorteio: () => 0 });
  await resgate.rodada();
  const [r] = banco.listarResgates(ana.id);
  assert.equal(r.status, "erro");
  assert.equal(r.erro, "Este número não tem WhatsApp.");

  const banco2 = abrirBanco(t);
  const bia = banco2.criarUsuario({ login: "bia", senhaHash: "x" });
  cotou(banco2, bia.id, "34999990002", "Instável", 200);
  const resgate2 = criarResgate({ banco: banco2, evolution: evolutionFalsa({ falhar: true }), relogio: () => agora, sorteio: () => 0 });
  resgate2.coletar();
  for (let i = 0; i < MAX_TENTATIVAS; i++) {
    assert.equal(banco2.listarResgates(bia.id)[0].status, "pendente");
    await resgate2.rodada();
    agora = new Date(agora.getTime() + 10 * 60_000);
  }
  const falhou = banco2.listarResgates(bia.id)[0];
  assert.equal(falhou.status, "erro");
  assert.equal(falhou.tentativas, MAX_TENTATIVAS);
});

test("a Evolution recebe a chave no cabeçalho e o número com o código do país", async () => {
  assert.equal(criarEvolution({}), null);
  const pedidos = [];
  const respostas = {
    "GET /instance/connectionState/cotador-u1": [200, { instance: { instanceName: "cotador-u1", state: "open" } }],
    "GET /instance/fetchInstances?instanceName=cotador-u1": [200, [{ ownerJid: "5534999990000@s.whatsapp.net" }]],
    "GET /instance/connectionState/cotador-u2": [404, { message: "não existe" }],
    "GET /instance/connect/cotador-u2": [404, {}],
    "POST /instance/create": [201, { qrcode: { base64: "data:image/png;base64,AAA", pairingCode: "XYZ" } }],
    "POST /message/sendText/cotador-u1": [400, { response: { message: [{ exists: false, number: "5534999990001" }] } }],
  };
  const buscar = async (url, opcoes) => {
    const rota = `${opcoes.method} ${url.replace("http://evo:8080", "")}`;
    pedidos.push({ rota, chave: opcoes.headers.apikey, corpo: opcoes.body && JSON.parse(opcoes.body) });
    const [status, corpo] = respostas[rota] ?? [500, {}];
    return new Response(JSON.stringify(corpo), { status });
  };
  const evo = criarEvolution({ EVOLUTION_URL: "http://evo:8080/", EVOLUTION_API_KEY: "chave-de-teste" }, buscar);
  assert.deepEqual(await evo.estado("cotador-u1"), { estado: "open", numero: "5534999990000" });
  assert.deepEqual(await evo.estado("cotador-u2"), { estado: "inexistente", numero: "" });
  assert.deepEqual(await evo.conectar("cotador-u2"), { qr: "data:image/png;base64,AAA", codigo: "XYZ" });
  assert.deepEqual(pedidos.at(-1).corpo, { instanceName: "cotador-u2", integration: "WHATSAPP-BAILEYS", qrcode: true });
  const r = await evo.enviarTexto("cotador-u1", "5534999990001", "Oi");
  assert.deepEqual(r, { ok: false, semWhatsApp: true, erro: "Este número não tem WhatsApp." });
  assert.deepEqual(pedidos.at(-1).corpo, { number: "5534999990001", text: "Oi" });
  assert.ok(pedidos.every((p) => p.chave === "chave-de-teste"));
});

test("pela API, cada login vê só o próprio resgate, ajusta a mensagem e conecta o próprio WhatsApp", async (t) => {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-resgate-api-"));
  const banco = new Banco(join(pasta, "c.db"), seed);
  const evolution = evolutionFalsa({ estado: "close" });
  const resgate = criarResgate({ banco, evolution, relogio: () => new Date() });
  const sistema = { versao: async () => ({}), atualizar: async () => ({}) };
  const env = { LOGIN_USUARIO: "chefe", LOGIN_SENHA: "senha-do-admin-1" };
  const app = criarApp({ banco, pastaPublica: join(raiz, "public"), pastaUploads: join(pasta, "u"), pastaBackups: join(pasta, "b"), env, exigirLogin: true, sistema, resgate, enviarEmail: null });
  const servidor = await new Promise((ok) => { const s = app.listen(0, "127.0.0.1", () => ok(s)); });
  t.after(() => new Promise((fim) => { servidor.closeAllConnections(); servidor.close(() => { banco.fechar(); rmSync(pasta, { recursive: true, force: true }); fim(); }); }));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const entrar = async (usuario, senha) => (await fetch(base + "/login", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ usuario, senha }) })).headers.get("set-cookie").split(";")[0];
  const pedir = async (cookie, rota, metodo = "GET", json) => {
    const r = await fetch(base + rota, { method: metodo, redirect: "manual", headers: { cookie, ...(json ? { "Content-Type": "application/json" } : {}) }, body: json ? JSON.stringify(json) : undefined });
    return { status: r.status, corpo: await r.json().catch(() => null) };
  };
  const admin = await entrar("chefe", "senha-do-admin-1");
  await pedir(admin, "/api/usuarios", "POST", { login: "corretor1", email: "c@exemplo.com", senha: "senha-do-corretor" });
  const corretor = await entrar("corretor1", "senha-do-corretor");
  const idDe = async (cookie) => (await pedir(cookie, "/api/eu")).corpo.id;
  const idCorretor = await idDe(corretor);
  const antiga = new Date(Date.now() - 100 * DIA).toISOString();
  const { cotacao: c } = banco.salvarCotacao({ ...cotacao("34999990001", "Mariana Alves"), usuarioId: idCorretor });
  banco.db.prepare("UPDATE cotacoes SET criado_em = ? WHERE id = ?").run(antiga, c.id);

  const meu = await pedir(corretor, "/api/resgate");
  assert.equal(meu.status, 200);
  assert.equal(meu.corpo.configurado, true);
  assert.equal(meu.corpo.ativo, true);
  assert.equal(meu.corpo.mensagem, "");
  assert.equal(meu.corpo.dias, 90);
  assert.deepEqual([meu.corpo.regras.diasMin, meu.corpo.regras.diasMax], [0, 730]);
  assert.deepEqual([meu.corpo.limite, meu.corpo.intervaloMin, meu.corpo.intervaloMax], [30, 2, 5]);
  assert.deepEqual([meu.corpo.regras.limiteMin, meu.corpo.regras.limiteMax, meu.corpo.regras.intervaloMin, meu.corpo.regras.intervaloMax], [1, 200, 1, 120]);
  assert.equal(meu.corpo.mensagemPadrao, MENSAGEM_RESGATE_PADRAO);
  assert.deepEqual(meu.corpo.itens.map((r) => [r.cliente, r.status]), [["Mariana Alves", "pendente"]]);
  assert.equal(meu.corpo.itens[0].usuarioId, undefined);
  // O administrador não vê o resgate dos outros, nem mexe nele.
  assert.deepEqual((await pedir(admin, "/api/resgate")).corpo.itens, []);
  const id = meu.corpo.itens[0].id;
  assert.equal((await pedir(admin, `/api/resgate/${id}`, "PATCH", { acao: "cancelar" })).status, 404);

  assert.equal((await pedir(corretor, `/api/resgate/${id}`, "PATCH", { acao: "reenviar" })).status, 400);
  assert.equal((await pedir(corretor, `/api/resgate/${id}`, "PATCH", { acao: "cancelar" })).corpo.status, "cancelado");
  assert.equal((await pedir(corretor, `/api/resgate/${id}`, "PATCH", { acao: "reenviar" })).corpo.status, "pendente");

  const cfg = await pedir(corretor, "/api/resgate/config", "PUT", { ativo: false, mensagem: "Oi {nome}!" });
  assert.deepEqual(cfg.corpo, { ativo: false, mensagem: "Oi {nome}!", dias: 90, limite: 30, intervaloMin: 2, intervaloMax: 5 });
  for (const dias of [-1, 731, 2.5, "30"]) assert.equal((await pedir(corretor, "/api/resgate/config", "PUT", { dias })).status, 400);
  // Com 200 dias, a Mariana (100 dias sem cotar) sai da fila na hora; voltando a 90, ela volta.
  assert.equal((await pedir(corretor, "/api/resgate/config", "PUT", { dias: 200 })).corpo.dias, 200);
  assert.deepEqual(banco.listarResgates(idCorretor), []);
  await pedir(corretor, "/api/resgate/config", "PUT", { dias: 90 });
  assert.equal(banco.listarResgates(idCorretor).length, 1);
  assert.equal((await pedir(corretor, "/api/resgate/config", "PUT", { ativo: "sim" })).status, 400);
  assert.equal((await pedir(corretor, "/api/resgate/config", "PUT", { mensagem: "x".repeat(1001) })).status, 400);
  // Mensagens por dia e intervalo, em minutos: inteiros dentro da faixa, com o mínimo até o máximo.
  for (const limite of [0, 201, 1.5, "30"]) assert.equal((await pedir(corretor, "/api/resgate/config", "PUT", { limite })).status, 400);
  for (const intervaloMin of [0, 121, 2.5]) assert.equal((await pedir(corretor, "/api/resgate/config", "PUT", { intervaloMin })).status, 400);
  assert.equal((await pedir(corretor, "/api/resgate/config", "PUT", { intervaloMin: 6 })).status, 400);
  assert.equal((await pedir(corretor, "/api/resgate/config", "PUT", { intervaloMin: 10, intervaloMax: 8 })).status, 400);
  const ritmo = (await pedir(corretor, "/api/resgate/config", "PUT", { limite: 50, intervaloMin: 4, intervaloMax: 10 })).corpo;
  assert.deepEqual([ritmo.limite, ritmo.intervaloMin, ritmo.intervaloMax, ritmo.dias], [50, 4, 10, 90]);
  assert.deepEqual((await pedir(corretor, "/api/resgate")).corpo.limite, 50);

  assert.deepEqual((await pedir(corretor, "/api/resgate/whatsapp")).corpo, { configurado: true, estado: "close", numero: "5534999990000" });
  assert.equal((await pedir(corretor, "/api/resgate/whatsapp/conectar", "POST")).corpo.qr, `data:image/png;base64,QR-${instanciaDe(idCorretor)}`);
  assert.equal((await pedir(corretor, "/api/resgate/whatsapp/desconectar", "POST")).status, 200);
  assert.equal((await pedir("", "/api/resgate")).status === 200, false);
});

test("sem a Evolution configurada, a lista é montada mas o WhatsApp avisa que falta configurar", async (t) => {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-resgate-sem-"));
  const banco = new Banco(join(pasta, "c.db"), seed);
  const app = criarApp({ banco, pastaPublica: join(raiz, "public"), pastaUploads: join(pasta, "u"), pastaBackups: join(pasta, "b"), env: {}, enviarEmail: null });
  const servidor = await new Promise((ok) => { const s = app.listen(0, "127.0.0.1", () => ok(s)); });
  t.after(() => new Promise((fim) => { servidor.closeAllConnections(); servidor.close(() => { banco.fechar(); rmSync(pasta, { recursive: true, force: true }); fim(); }); }));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const r = await (await fetch(base + "/api/resgate")).json();
  assert.equal(r.configurado, false);
  assert.deepEqual(await (await fetch(base + "/api/resgate/whatsapp")).json(), { configurado: false, estado: "inexistente", numero: "" });
  const conectar = await fetch(base + "/api/resgate/whatsapp/conectar", { method: "POST" });
  assert.equal(conectar.status, 400);
});
