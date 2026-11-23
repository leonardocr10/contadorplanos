// Telefone do cliente: no máximo 11 dígitos (DDD + número).
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_DIGITOS_FONE, foneColado } from "../public/js/fone.js";

test("o telefone do cliente tem no máximo 11 dígitos", () => {
  assert.equal(MAX_DIGITOS_FONE, 11);
});

test("número colado perde o +55 do país e o que passar de 11 dígitos", () => {
  assert.equal(foneColado("+55 (34) 99999-0000"), "34999990000");
  assert.equal(foneColado("(34) 99999-00001234"), "34999990000");
  assert.equal(foneColado("(34) 3333-4444"), "3433334444");
});

test("enquanto digita, o telefone já fica no formato com parênteses e traço", async () => {
  const { mascaraFone } = await import("../public/js/fone.js");
  const passos = ["", "(3", "(34", "(34) 9", "(34) 9999", "(34) 9999-9", "(34) 9999-9000", "(34) 99999-0000"];
  assert.deepEqual(["", "3", "34", "349", "349999", "3499999", "3499999000", "34999990000"].map(mascaraFone), passos);
  assert.equal(mascaraFone("(34) 99999-000012"), "(34) 99999-0000");
});
