import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const raiz = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const pastaJs = join(raiz, "public", "js");

// Todos os módulos que a tela importa, a partir de app.js.
function modulosDaTela() {
  const vistos = new Set();
  const visitar = (nome) => {
    if (vistos.has(nome)) return;
    vistos.add(nome);
    const codigo = readFileSync(join(pastaJs, nome), "utf8");
    for (const [, dep] of codigo.matchAll(/^import [^;]*? from "\.\/([\w-]+\.js)";/gm)) visitar(dep);
  };
  visitar("app.js");
  vistos.delete("app.js");
  return [...vistos].sort();
}

test("todo módulo da tela é pré-carregado, para abrir sem esperar um import depois do outro", () => {
  const html = readFileSync(join(raiz, "public", "index.html"), "utf8");
  const preCarregados = [...html.matchAll(/<link rel="modulepreload" href="js\/([\w-]+\.js)">/g)].map((m) => m[1]).sort();
  assert.ok(modulosDaTela().length > 5);
  assert.deepEqual(preCarregados, modulosDaTela());
});
