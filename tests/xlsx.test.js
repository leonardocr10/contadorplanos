// Planilha do Excel gerada sem bibliotecas: um zip válido com as partes mínimas e os valores nas células.
import test from "node:test";
import assert from "node:assert/strict";
import { gerarXlsx } from "../public/js/xlsx.js";

const texto = (bytes) => new TextDecoder().decode(bytes);

test("gera um .xlsx com cabeçalho, textos escapados, datas, percentuais e moeda", () => {
  const bytes = gerarXlsx({
    aba: "Comissões: novembro/2026 [teste]",
    colunas: [{ titulo: "Cliente", tipo: "texto" }, { titulo: "Previsto para", tipo: "data" }, { titulo: "Percentual", tipo: "percentual" }, { titulo: "Valor", tipo: "moeda" }],
    linhas: [["Maria & <João>", "2026-11-25", 50, 194.5], ["Ivo", "", null, 389]],
  });
  // Zip: começa no cabeçalho local e termina no fim do diretório central, com as 6 partes.
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const fim = bytes.length - 22;
  assert.deepEqual([...bytes.slice(fim, fim + 4)], [0x50, 0x4b, 0x05, 0x06]);
  assert.equal(bytes[fim + 10], 6);
  const t = texto(bytes);
  for (const parte of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml", "xl/styles.xml"]) assert.ok(t.includes(parte), parte);
  assert.match(t, /<sheet name="Comissões  novembro 2026  teste"/);
  assert.match(t, /Maria &amp; &lt;João&gt;/);
  // 25/11/2026 é o dia 46351 do Excel; 50% vira 0,5; moeda e data com os estilos próprios.
  assert.match(t, /<c r="B2" s="4"><v>46351<\/v><\/c>/);
  assert.match(t, /<c r="C2" s="3"><v>0.5<\/v><\/c>/);
  assert.match(t, /<c r="D3" s="2"><v>389<\/v><\/c>/);
  // Célula vazia não entra.
  assert.ok(!t.includes('r="B3"') && !t.includes('r="C3"'));
});
