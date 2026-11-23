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
