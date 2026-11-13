// Envio de documentos pelo cliente que aceitou a proposta: entra com o telefone, envia aos poucos e conclui.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Banco } from "../server/db.js";
import { criarApp } from "../server/app.js";
import { criarAppPublica } from "../server/publico.js";
import { mensagemDocumentos, mensagemPropostaEnviada } from "../public/js/mensagem.js";

const raiz = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const vidas = [1, 0, 0, 1, 1, 0, 0, 0, 0, 0];
const opts = { copart: true, rede: true, acom: true };
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);

function subir(t) {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-docs-"));
  const banco = new Banco(join(pasta, "cotador.db"), join(raiz, "dados", "planos.json"));
  const pastaPublica = join(raiz, "public"), pastaUploads = join(pasta, "uploads");
  const linkPublico = () => ({ estado: "ativo", url: "https://teste.exemplo.com" });
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

// Cria o link de uma proposta e, se pedido, já aceita. Devolve o endereço público e o token.
async function proposta({ admin, publico }, { fone = "(34) 99999-0000", aceitar = true } = {}) {
  const r = await fetch(admin + "/api/propostas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planos: ["plam-saude-pf"], vidas, over: {}, cliente: "Maria Silva", fone, opts }) });
  const caminho = new URL((await r.json()).links[0].url).pathname;
  const url = publico + caminho;
  if (aceitar) await fetch(url + "/aceite", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ acomodacao: "Enfermaria", confirmo: "1" }) });
  return { url, token: caminho.split("/").pop() };
}

const entrar = async (url, fone) => {
  const r = await fetch(url + "/documentos/entrar", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ fone }) });
  return { status: r.status, cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "", texto: r.status === 303 ? "" : await r.text(), cabecalho: r.headers.get("set-cookie") ?? "" };
};
const enviar = (url, cookie, documento, corpo, nome = "arquivo.pdf") => fetch(url + "/documentos/arquivos", {
  method: "POST", headers: { cookie, "Content-Type": "application/octet-stream", "X-Documento": encodeURIComponent(documento), "X-Nome-Arquivo": encodeURIComponent(nome) }, body: corpo,
});
const estado = async (url, cookie) => (await fetch(url + "/documentos/estado", { headers: { cookie } })).json();

test("proposta aceita leva ao envio; sem aceite ou sem telefone conferido, nada abre", async (t) => {
  const s = await subir(t);
  const semAceite = await proposta(s, { aceitar: false });
  const r = await fetch(semAceite.url + "/documentos", { redirect: "manual" });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), new URL(semAceite.url).pathname);
  assert.equal((await entrar(semAceite.url, "34999990000")).status, 404);

  const { url } = await proposta(s);
  const entrada = await (await fetch(url + "/documentos")).text();
  assert.match(entrada, /informe o seu telefone/);
  assert.match(entrada, /mesmo número de WhatsApp/);
  // A lista de documentos e os arquivos só aparecem depois do telefone.
  assert.ok(!entrada.includes("documentos-pagina.js"));
  for (const [rota, metodo] of [["/documentos/estado", "GET"], ["/documentos/arquivos", "POST"], ["/documentos/arquivos/x", "DELETE"], ["/documentos/concluir", "POST"]]) {
    const semAcesso = await fetch(url + rota, { method: metodo });
    assert.equal(semAcesso.status, 401, `${metodo} ${rota}`);
    assert.equal((await semAcesso.json()).codigo, "sem_acesso");
  }
  assert.equal((await fetch(s.publico + "/p/token-que-nao-existe-123456/documentos")).status, 404);
});

test("o telefone do cliente é o login: número errado não entra, e muitas tentativas bloqueiam", async (t) => {
  const s = await subir(t);
  const { url, token } = await proposta(s);
  assert.equal((await entrar(url, "123")).status, 400);
  const errado = await entrar(url, "(34) 98888-1111");
  assert.equal(errado.status, 401);
  assert.match(errado.texto, /não confere/);
  assert.equal(errado.cookie, "");

  // Vale com máscara, com 55 na frente e sem o nono dígito.
  for (const jeito of ["(34) 99999-0000", "5534999990000", "3499990000"]) {
    const ok = await entrar(url, jeito);
    assert.equal(ok.status, 303, jeito);
    assert.match(ok.cabecalho, new RegExp(`Path=/p/${token}/documentos; HttpOnly; SameSite=Lax; Max-Age=2592000`));
  }
  // Entrar de novo, em outro aparelho, mantém o acesso do primeiro: o cliente continua de onde parou.
  const a = (await entrar(url, "34999990000")).cookie, b = (await entrar(url, "34999990000")).cookie;
  assert.equal(a, b);
  assert.match(await (await fetch(url + "/documentos", { headers: { cookie: a } })).text(), /documentos-pagina\.js/);
  // O acesso de uma proposta não abre a de outro cliente.
  const outra = await proposta(s, { fone: "(34) 97777-0000" });
  assert.equal((await fetch(outra.url + "/documentos/estado", { headers: { cookie: a } })).status, 401);

  for (let i = 0; i < 5; i++) await entrar(url, "(34) 98888-1111");
  const bloqueado = await entrar(url, "34999990000");
  assert.equal(bloqueado.status, 429);
  assert.match(bloqueado.texto, /Muitas tentativas/);
});

test("proposta sem número: o primeiro telefone informado vira o login", async (t) => {
  const s = await subir(t);
  const { url, token } = await proposta(s, { fone: "" });
  assert.match(await (await fetch(url + "/documentos")).text(), /Ele será o seu acesso/);
  const cookie = (await entrar(url, "(34) 96666-0000")).cookie;
  assert.equal(s.banco.obterProposta(token).docsFone, "34966660000");
  // Na conclusão, o telefone gravado é o do acesso.
  await fetch(url + "/documentos/concluir", { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ nome: "Joana", email: "joana@exemplo.com" }) });
  assert.equal((await (await fetch(s.admin + "/api/aceites")).json())[0].contatoCliente.fone, "34966660000");
  assert.equal((await entrar(url, "(34) 95555-0000")).status, 401);
  assert.equal((await entrar(url, "34966660000")).status, 303);
});

test("o cliente envia aos poucos, para, volta e conclui; o corretor recebe os arquivos", async (t) => {
  const s = await subir(t);
  for (const nome of ["RG e CPF", "Comprovante de residência"]) s.banco.adicionarDocumentoAoCartao("PF", "PLAM SAÚDE", nome);
  const { url, token } = await proposta(s);
  const docs = s.banco.documentosDoPlano("plam-saude-pf");
  assert.deepEqual(docs, ["RG e CPF", "Comprovante de residência"]);
  const cookie = (await entrar(url, "34999990000")).cookie;

  let e = await estado(url, cookie);
  assert.deepEqual(e.documentos.map((d) => d.nome), docs);
  assert.ok(e.documentos.every((d) => d.arquivos.length === 0));
  assert.equal(e.concluidoEm, null);

  // Só foto ou PDF, e só para documento da lista (ou "Outros documentos").
  assert.equal((await enviar(url, cookie, docs[0], Buffer.from("texto qualquer"))).status, 400);
  assert.equal((await enviar(url, cookie, "Documento inventado", PDF)).status, 400);
  assert.equal((await enviar(url, cookie, docs[0], Buffer.alloc(0))).status, 400);

  const enviado = await enviar(url, cookie, docs[0], PDF, "C:\\fotos\\rg frente.pdf");
  assert.equal(enviado.status, 201);
  e = await enviado.json();
  assert.equal(e.documentos[0].arquivos.length, 1);
  assert.equal(e.documentos[0].arquivos[0].nome, "rg frente.pdf");
  assert.equal(JSON.stringify(e).includes("dados"), false);
  await enviar(url, cookie, docs[0], JPG, "rg verso.jpg");
  await enviar(url, cookie, "Outros documentos", JPG, "extra.jpg");

  // Parou e voltou em outro aparelho, com o telefone: tudo continua lá.
  const depois = (await entrar(url, "(34) 99999-0000")).cookie;
  e = await estado(url, depois);
  assert.deepEqual(e.documentos[0].arquivos.map((a) => a.nome), ["rg frente.pdf", "rg verso.jpg"]);
  assert.deepEqual(e.outros.arquivos.map((a) => a.nome), ["extra.jpg"]);

  // Remover um arquivo; o conteúdo nunca sai pela porta pública.
  const verso = e.documentos[0].arquivos[1].id;
  assert.equal((await fetch(`${url}/documentos/arquivos/${verso}`, { headers: { cookie } })).status, 404);
  e = await (await fetch(`${url}/documentos/arquivos/${verso}`, { method: "DELETE", headers: { cookie } })).json();
  assert.equal(e.documentos[0].arquivos.length, 1);
  assert.equal((await fetch(`${url}/documentos/arquivos/${verso}`, { method: "DELETE", headers: { cookie } })).status, 404);

  // Concluir pede o nome e o e-mail; o telefone é o do acesso.
  const concluir = (corpo) => fetch(url + "/documentos/concluir", { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  assert.equal(e.contato.nome, "Maria Silva");
  assert.equal(e.contato.fone, "34999990000");
  assert.equal(e.contato.email, "");
  for (const [corpo, campo] of [[{}, "nome"], [{ nome: "M", email: "maria@exemplo.com" }, "nome"], [{ nome: "Maria Silva" }, "email"], [{ nome: "Maria Silva", email: "maria@" }, "email"], [{ nome: "Maria Silva", email: "maria @exemplo.com" }, "email"]]) {
    const r = await concluir(corpo);
    assert.equal(r.status, 400, JSON.stringify(corpo));
    assert.equal((await r.json()).campo, campo);
  }
  assert.equal(s.banco.obterProposta(token).docsConcluidoEm, null);
  e = await (await concluir({ nome: "  Maria   da Silva ", email: " Maria@Exemplo.com " })).json();
  assert.ok(e.concluidoEm);
  assert.deepEqual(e.contato, { nome: "Maria da Silva", fone: "34999990000", email: "maria@exemplo.com" });
  assert.match(await (await fetch(url)).text(), /Ver documentos enviados/);

  // Tela Aceites: o que chegou, a conclusão e o link de envio.
  const [aceite] = await (await fetch(s.admin + "/api/aceites")).json();
  assert.equal(aceite.docsConcluidoEm, e.concluidoEm);
  assert.equal(aceite.linkDocumentos, `https://teste.exemplo.com/p/${token}/documentos`);
  assert.deepEqual(aceite.arquivos.map((a) => [a.documento, a.nome, a.tipo]), [[docs[0], "rg frente.pdf", "application/pdf"], ["Outros documentos", "extra.jpg", "image/jpeg"]]);
  assert.equal(JSON.stringify(aceite).includes("docsChave"), false);
  assert.deepEqual(aceite.contatoCliente, { nome: "Maria da Silva", fone: "34999990000", email: "maria@exemplo.com" });
  const arquivo = await fetch(`${s.admin}/api/aceites/${token}/arquivos/${aceite.arquivos[0].id}`);
  assert.equal(arquivo.status, 200);
  assert.equal(arquivo.headers.get("content-type"), "application/pdf");
  assert.deepEqual(Buffer.from(await arquivo.arrayBuffer()), PDF);
  assert.equal((await fetch(`${s.admin}/api/aceites/${token}/arquivos/nao-existe`)).status, 404);
  // O corretor também exclui um arquivo enviado pelo cliente.
  assert.equal((await fetch(`${s.admin}/api/aceites/${token}/arquivos/${aceite.arquivos[1].id}`, { method: "DELETE" })).status, 204);
  assert.equal((await fetch(`${s.admin}/api/aceites/${token}/arquivos/${aceite.arquivos[1].id}`, { method: "DELETE" })).status, 404);
  assert.equal(s.banco.arquivosDaProposta(token).length, 1);

  // Reabrir tira o aviso de concluído, e o contato continua para a próxima conclusão.
  e = await (await concluir({ concluido: false })).json();
  assert.equal(e.concluidoEm, null);
  assert.equal(e.contato.email, "maria@exemplo.com");

  // Sair encerra o acesso neste aparelho.
  const saida = await fetch(url + "/documentos/sair", { method: "POST", redirect: "manual", headers: { cookie } });
  assert.match(saida.headers.get("set-cookie"), /cotador_docs=; .*Max-Age=0/);

  // Excluir o aceite apaga também os arquivos do cliente.
  assert.equal((await fetch(`${s.admin}/api/aceites/${token}`, { method: "DELETE" })).status, 204);
  assert.equal(s.banco.db.prepare("SELECT COUNT(*) AS n FROM propostas_arquivos").get().n, 0);
  assert.equal((await fetch(url + "/documentos/estado", { headers: { cookie } })).status, 401);
});

test("arquivo acima de 20 MB é recusado com aviso legível", async (t) => {
  const s = await subir(t);
  const { url } = await proposta(s);
  const cookie = (await entrar(url, "34999990000")).cookie;
  const docs = ["Outros documentos"];
  const grande = Buffer.concat([PDF, Buffer.alloc(20 * 1024 * 1024)]);
  const r = await enviar(url, cookie, docs[0], grande);
  assert.equal(r.status, 413);
  assert.match((await r.json()).erro, /20 MB/);
});

test("banco da versão anterior ganha o envio de documentos sem perder os aceites", async (t) => {
  const s = await subir(t);
  const { token } = await proposta(s);
  s.banco.db.exec("PRAGMA user_version = 44");
  s.banco.fechar();
  s.banco.abrir();
  s.banco.db.exec("ALTER TABLE propostas DROP COLUMN docs_nome; ALTER TABLE propostas DROP COLUMN docs_email; PRAGMA user_version = 45");
  s.banco.fechar();
  s.banco.abrir();
  const p = s.banco.obterProposta(token);
  assert.ok(p.aceitoEm);
  assert.equal(p.docsEmail, "");
  assert.equal(p.docsFone, "");
  assert.equal(p.docsConcluidoEm, null);
  assert.deepEqual(s.banco.arquivosDaProposta(token), []);
});

test("aviso de proposta enviada: texto pronto e registro de quando o corretor enviou", async (t) => {
  const texto = mensagemPropostaEnviada();
  assert.match(texto, /^Foi enviado para seu e-mail a proposta/);
  assert.match(texto, /declaração de saúde/);
  assert.match(texto, /\n\*Suspeitas, investigações de diagnóstico, eventos esporádicos, Cirurgias antigas o ideal é colocar como NÃO\*\n/);
  assert.match(texto, /você pode me chamar que te auxilio\.$/);

  const s = await subir(t);
  const { url, token } = await proposta(s);
  assert.equal((await (await fetch(s.admin + "/api/aceites")).json())[0].propostaEnviadaEm, null);
  // Antes de o cliente concluir o envio dos documentos, o aviso é recusado.
  const cedo = await fetch(`${s.admin}/api/aceites/${token}/proposta-enviada`, { method: "POST" });
  assert.equal(cedo.status, 400);
  assert.match((await cedo.json()).erro, /ainda não concluiu/);
  const cookie = (await entrar(url, "34999990000")).cookie;
  await enviar(url, cookie, "Outros documentos", PDF, "rg.pdf");
  await fetch(url + "/documentos/concluir", { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ nome: "Maria Silva", email: "maria@exemplo.com" }) });
  // O aviso leva o aceite para Contratos Vendidos: sem a data de ativação, é recusado.
  const avisar = (corpo) => fetch(`${s.admin}/api/aceites/${token}/proposta-enviada`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  assert.equal((await avisar({})).status, 400);
  assert.equal(s.banco.obterProposta(token).propostaEnviadaEm, null);
  const r = await avisar({ ativacao: "2026-12-01" });
  assert.equal(r.status, 200);
  const { propostaEnviadaEm, contratoCriado, contratoId } = await r.json();
  assert.ok(propostaEnviadaEm);
  assert.equal(contratoCriado, true);
  const [contrato] = await (await fetch(s.admin + "/api/contratos")).json();
  assert.equal(contrato.id, contratoId);
  assert.deepEqual([contrato.nome, contrato.fone, contrato.email, contrato.plano, contrato.valor, contrato.ativacao], ["Maria Silva", "34999990000", "maria@exemplo.com", "PLAM SAÚDE", s.banco.obterProposta(token).valor, "2026-12-01"]);
  assert.equal((await (await fetch(s.admin + "/api/aceites")).json())[0].emContratos, true);
  // Os documentos que o cliente enviou vão junto para o contrato.
  assert.deepEqual(contrato.arquivos.map((x) => x.nome), ["rg.pdf"]);
  assert.deepEqual(Buffer.from(await (await fetch(`${s.admin}/api/contratos/${contrato.id}/arquivos/${contrato.arquivos[0].id}`)).arrayBuffer()), PDF);
  // Avisar de novo não cria outro contrato.
  assert.equal((await (await avisar({})).json()).contratoCriado, false);
  assert.equal((await (await fetch(s.admin + "/api/contratos")).json()).length, 1);
  // O segundo aviso atualiza a data do aviso.
  assert.ok((await (await fetch(s.admin + "/api/aceites")).json())[0].propostaEnviadaEm >= propostaEnviadaEm);
  assert.equal((await fetch(`${s.admin}/api/aceites/nao-existe-1234567890/proposta-enviada`, { method: "POST" })).status, 404);
  const semAceite = await proposta(s, { aceitar: false, fone: "(34) 97777-0000" });
  assert.equal((await fetch(`${s.admin}/api/aceites/${semAceite.token}/proposta-enviada`, { method: "POST" })).status, 404);
});

test("a mensagem do WhatsApp leva o link de envio quando ele existe", () => {
  const base = { cliente: "Maria", plano: "PLAM SAÚDE", acomodacao: "Enfermaria", valor: 100, documentos: ["RG"], corretor: {} };
  assert.ok(!mensagemDocumentos(base).includes("link"));
  const comLink = mensagemDocumentos({ ...base, link: "https://exemplo.com/p/abc/documentos" });
  assert.match(comLink, /informando o seu telefone/);
  assert.ok(comLink.includes("https://exemplo.com/p/abc/documentos"));
});

test("contrato vendido guarda o e-mail do cliente, que é opcional", async (t) => {
  const s = await subir(t);
  const salvar = (corpo, rota = "/api/contratos", metodo = "POST") => fetch(s.admin + rota, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome: "Maria", fone: "34999990000", plano: "PLAM SAÚDE", valor: 300, ativacao: "2026-12-01", ...corpo }) });
  const sem = await (await salvar({})).json();
  assert.equal(sem.email, "");
  assert.equal((await salvar({ email: "maria@" })).status, 400);
  const com = await (await salvar({ email: " Maria@Exemplo.com " })).json();
  assert.equal(com.email, "maria@exemplo.com");
  const editado = await (await salvar({ email: "nova@exemplo.com" }, `/api/contratos/${sem.id}`, "PUT")).json();
  assert.equal(editado.email, "nova@exemplo.com");
  const lista = await (await fetch(s.admin + "/api/contratos")).json();
  assert.deepEqual(lista.map((c) => c.email).sort(), ["maria@exemplo.com", "nova@exemplo.com"]);
});

test("aceite avisado antes desta função vai para Contratos Vendidos sem novo aviso", async (t) => {
  const s = await subir(t);
  const { url, token } = await proposta(s);
  const cookie = (await entrar(url, "34999990000")).cookie;
  await fetch(url + "/documentos/concluir", { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ nome: "Maria Silva", email: "maria@exemplo.com" }) });
  s.banco.marcarPropostaEnviada(token);
  const antes = s.banco.obterProposta(token).propostaEnviadaEm;
  const r = await (await fetch(`${s.admin}/api/aceites/${token}/proposta-enviada`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ativacao: "2026-12-10", apenasContrato: true }) })).json();
  assert.equal(r.contratoCriado, true);
  assert.equal(r.propostaEnviadaEm, antes);
  assert.equal((await (await fetch(s.admin + "/api/contratos")).json())[0].ativacao, "2026-12-10");
});
