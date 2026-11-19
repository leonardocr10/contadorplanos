// Instalador da Evolution API sem Docker: ajuste do .env, sem rodar a instalação.
import test from "node:test";
import assert from "node:assert/strict";
import { ajustarEnv, lerEnv, senhaDaConexao, valoresDoEnv } from "../scripts/instalar-evolution.js";

const EXEMPLO = [
  "SERVER_NAME=evolution",
  "SERVER_PORT=8080",
  "SERVER_URL=http://localhost:8080",
  "DATABASE_PROVIDER=postgresql",
  "DATABASE_CONNECTION_URI='postgresql://user:pass@postgres:5432/evolution_db?schema=evolution_api'",
  "CACHE_REDIS_ENABLED=true",
  "CACHE_LOCAL_ENABLED=false",
  "AUTHENTICATION_API_KEY=429683C4C977415CAAFCCE10F7D57E11",
  "",
].join("\r\n");

test("o .env da Evolution recebe a chave nova, o banco local e o cache em memória", () => {
  const valores = valoresDoEnv(EXEMPLO, { senhaBanco: "abc123" });
  // A chave de exemplo nunca fica valendo.
  assert.notEqual(valores.AUTHENTICATION_API_KEY, "429683C4C977415CAAFCCE10F7D57E11");
  assert.match(valores.AUTHENTICATION_API_KEY, /^[0-9a-f]{40}$/);
  const novo = ajustarEnv(EXEMPLO, valores);
  assert.equal(lerEnv(novo, "SERVER_NAME"), "evolution");
  assert.equal(lerEnv(novo, "SERVER_URL"), "http://127.0.0.1:8080");
  assert.equal(lerEnv(novo, "CACHE_REDIS_ENABLED"), "false");
  assert.equal(lerEnv(novo, "CACHE_LOCAL_ENABLED"), "true");
  // Linha que não existia entra no fim.
  assert.equal(lerEnv(novo, "TELEMETRY_ENABLED"), "false");
  assert.equal(lerEnv(novo, "DATABASE_CONNECTION_URI"), "postgresql://evolution:abc123@localhost:5432/evolution?schema=evolution_api");
  assert.equal(senhaDaConexao(lerEnv(novo, "DATABASE_CONNECTION_URI")), "abc123");
  assert.equal(novo.split("\n").filter((l) => l.startsWith("SERVER_PORT=")).length, 1);
});

test("rodar de novo mantém a chave e a senha do banco já gravadas", () => {
  const primeiro = ajustarEnv(EXEMPLO, valoresDoEnv(EXEMPLO, { senhaBanco: "senha1" }));
  const chave = lerEnv(primeiro, "AUTHENTICATION_API_KEY");
  const senha = senhaDaConexao(lerEnv(primeiro, "DATABASE_CONNECTION_URI"));
  const segundo = ajustarEnv(primeiro, valoresDoEnv(primeiro, { senhaBanco: senha }));
  assert.equal(lerEnv(segundo, "AUTHENTICATION_API_KEY"), chave);
  assert.equal(segundo, primeiro);
  assert.equal(senhaDaConexao("postgresql://user:pass@postgres:5432/x"), "");
});
