import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { montarPdf } from "../public/js/pdf-imagem.js";

test("o PDF tem uma página na proporção da imagem e a imagem inteira", async () => {
  const jpeg = new Uint8Array(readFileSync(new URL("../public/img/plamedh-copart-2026.jpg", import.meta.url)));
  const pdf = montarPdf(jpeg, 1440, 900);
  const inicio = Buffer.from(pdf).indexOf(Buffer.from(jpeg));
  assert.ok(inicio > 0);
  const tarefa = getDocument({ data: pdf.slice(), verbosity: 0 });
  const doc = await tarefa.promise;
  assert.equal(doc.numPages, 1);
  const [, , largura, altura] = (await doc.getPage(1)).view;
  assert.equal(largura, 842);
  assert.equal(altura, 526.25);
  await tarefa.destroy();
});
