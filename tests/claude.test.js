import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import { ErroLeitura, extrairJson, lerTabela, montarPrompt, normalizarLeitura } from "../server/claude.js";

const valores = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

test("prompt cita o plano e exige copiar fielmente", () => {
  const p = montarPrompt("PLAM SAÚDE", "Total Adesão");
  assert.ok(p.includes('plano "PLAM SAÚDE" (Total Adesão)'));
  assert.match(p, /Copie fielmente todas as linhas/);
  assert.ok(!montarPrompt("X", "").includes("()"));
});

test("extrai JSON mesmo com cercas de código", () => {
  assert.deepEqual(extrairJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => extrairJson("não sei"), ErroLeitura);
});

test("normaliza números, faixas, cores e retângulos", () => {
  const r = normalizarLeitura({
    colunas: [
      { titulo: "Vazia", valores: [null, "-", 0] },
      { titulo: "Enf", valores: ["R$ 1.168,14", 200, -5, null] },
      { titulo: "Apto", valores },
    ],
    colunaEnfermaria: 1, colunaApartamento: 2,
    taxaAssociativa: "7,00", cidade: " Uberlândia ", rede: ["A", "", 3], extras: "x",
    corPrimaria: "#007e70", corEscura: "azul",
    tabelaCoparticipacao: { pagina: 2, retangulos: [{ x: -1, y: 0.5, w: 3, h: 0.9 }, { x: 0, y: 0, w: 0.01, h: 0.5 }] },
    tabelaCarencia: { pagina: 9, retangulos: [{ x: 0, y: 0, w: 1, h: 1 }] },
  }, 2);
  assert.equal(r.colunas.length, 2);
  assert.deepEqual(r.colunas[0].valores.slice(0, 4), [1168.14, 200, null, null]);
  assert.equal(r.colunas[0].valores.length, 10);
  // A coluna vazia saiu, então os índices acompanham.
  assert.equal(r.colunaEnfermaria, 0);
  assert.equal(r.colunaApartamento, 1);
  assert.equal(r.taxaAssociativa, 7);
  assert.equal(r.cidade, "Uberlândia");
  assert.deepEqual(r.rede, ["A", "3"]);
  assert.deepEqual(r.extras, []);
  assert.equal(r.corPrimaria, "#007e70");
  assert.equal(r.corEscura, "");
  assert.deepEqual(r.tabelaCoparticipacao, { pagina: 2, retangulos: [{ x: 0, y: 0.5, w: 1, h: 0.5 }] });
  assert.equal(r.tabelaCarencia, null);
  assert.equal(normalizarLeitura({ colunas: [], colunaEnfermaria: 0 }, 1).colunaEnfermaria, -1);
});

test("valida a lista de imagens antes de chamar a API", async () => {
  const opcoes = { apiKey: "x" };
  await assert.rejects(lerTabela({ imagens: [] }, opcoes), { codigo: "sem_imagens" });
  await assert.rejects(lerTabela({ imagens: Array(21).fill("AAAA") }, opcoes), { codigo: "muitas_imagens" });
  await assert.rejects(lerTabela({ imagens: ["não é base64!"] }, opcoes), { codigo: "imagem_rejeitada" });
});

// Servidor local que responde como a API, para testar o SDK de verdade sem usar a internet.
function apiFalsa(t, responder) {
  return new Promise((resolve) => {
    const pedidos = [];
    const srv = createServer((req, res) => {
      let corpo = "";
      req.on("data", (d) => (corpo += d));
      req.on("end", () => {
        pedidos.push({ url: req.url, headers: req.headers, corpo: JSON.parse(corpo) });
        responder(res);
      });
    });
    srv.listen(0, "127.0.0.1", () => {
      t.after(() => new Promise((fim) => { srv.closeAllConnections(); srv.close(fim); }));
      resolve({ pedidos, cliente: new Anthropic({ apiKey: "chave-de-teste", baseURL: `http://127.0.0.1:${srv.address().port}`, maxRetries: 0 }) });
    });
  });
}

function responderStream(res, texto, stopReason = "end_turn") {
  const ev = (nome, dados) => res.write(`event: ${nome}\ndata: ${JSON.stringify({ type: nome, ...dados })}\n\n`);
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
  ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
  ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: texto } });
  ev("content_block_stop", { index: 0 });
  ev("message_delta", { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } });
  ev("message_stop", {});
  res.end();
}

test("lê a tabela pelo SDK, com imagens antes do texto", async (t) => {
  const json = JSON.stringify({ colunas: [{ titulo: "Enf", valores }], colunaEnfermaria: 0, colunaApartamento: -1, cidade: "Uberlândia" });
  const { pedidos, cliente } = await apiFalsa(t, (res) => responderStream(res, json));
  const r = await lerTabela({ nome: "PLAM", subtitulo: "", imagens: ["data:image/jpeg;base64,AAAA", "BBBB"] }, { cliente, modelo: "claude-sonnet-5-5" });
  assert.equal(r.colunaEnfermaria, 0);
  assert.equal(r.colunaApartamento, -1);
  assert.equal(r.cidade, "Uberlândia");

  const { corpo, headers, url } = pedidos[0];
  assert.match(url, /\/v1\/messages/);
  assert.equal(corpo.model, "claude-sonnet-5-5");
  assert.equal(corpo.stream, true);
  assert.equal(corpo.fallbacks, "default");
  assert.equal(headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  const c = corpo.messages[0].content;
  assert.deepEqual(c.map((b) => b.type), ["image", "image", "text"]);
  assert.deepEqual(c[0].source, { type: "base64", media_type: "image/jpeg", data: "AAAA" });
});

test("modelo sem desvio automático não envia fallbacks", async (t) => {
  const { pedidos, cliente } = await apiFalsa(t, (res) => responderStream(res, "{}"));
  await lerTabela({ imagens: ["AAAA"] }, { cliente, modelo: "claude-haiku-5-5" });
  assert.equal(pedidos[0].corpo.fallbacks, undefined);
  assert.equal(pedidos[0].headers["anthropic-beta"], undefined);
});

test("recusa e resposta cortada viram mensagens claras", async (t) => {
  const recusa = await apiFalsa(t, (res) => responderStream(res, "", "refusal"));
  await assert.rejects(lerTabela({ imagens: ["AAAA"] }, { cliente: recusa.cliente }), { codigo: "recusado" });
  const longa = await apiFalsa(t, (res) => responderStream(res, "{", "max_tokens"));
  await assert.rejects(lerTabela({ imagens: ["AAAA"] }, { cliente: longa.cliente }), { codigo: "muito_longo" });
});

test("erros da API viram mensagens em português", async (t) => {
  const erro = (status) => (res) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "x", message: "falhou" } }));
  };
  for (const [status, codigo] of [[401, "chave_invalida"], [404, "modelo_invalido"], [429, "limite_uso"], [400, "imagem_rejeitada"], [500, "erro_api"]]) {
    const { cliente } = await apiFalsa(t, erro(status));
    await assert.rejects(lerTabela({ imagens: ["AAAA"] }, { cliente }), { codigo }, `status ${status}`);
  }
});
