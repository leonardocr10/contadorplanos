// Planilha do Excel (.xlsx) sem bibliotecas: um zip (sem compressão) com o XML mínimo de uma pasta de trabalho.
// colunas: [{ titulo, tipo: "texto" | "numero" | "moeda" | "percentual" | "data", largura }]
// linhas: listas de valores na ordem das colunas (data em "aaaa-mm-dd"; percentual em pontos, ex.: 50 = 50%).

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = TABELA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Zip "store": cada arquivo vai como está, com o cabeçalho local e o diretório central no fim.
function zip(arquivos) {
  const cod = new TextEncoder(), partes = [], central = [];
  let posicao = 0;
  const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
  const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  for (const [nome, texto] of arquivos) {
    const n = cod.encode(nome), dados = cod.encode(texto), crc = crc32(dados);
    const comum = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(dados.length), ...u32(dados.length), ...u16(n.length), ...u16(0)];
    const local = new Uint8Array([...u32(0x04034b50), ...comum]);
    partes.push(local, n, dados);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...comum, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(posicao)]), n);
    posicao += local.length + n.length + dados.length;
  }
  const tamanhoCentral = central.reduce((a, p) => a + p.length, 0);
  const fim = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(arquivos.length), ...u16(arquivos.length), ...u32(tamanhoCentral), ...u32(posicao), ...u16(0)]);
  const todas = [...partes, ...central, fim];
  const saida = new Uint8Array(todas.reduce((a, p) => a + p.length, 0));
  let i = 0;
  for (const p of todas) { saida.set(p, i); i += p.length; }
  return saida;
}

const xml = (s) => String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const letra = (i) => (i < 26 ? String.fromCharCode(65 + i) : letra(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
// Dias desde 30/12/1899, como o Excel guarda as datas.
const serialDaData = (iso) => {
  const [a, m, d] = String(iso).split("-").map(Number);
  return a && m && d ? Math.round((Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000) : null;
};
// O Excel não aceita : \ / ? * [ ] no nome da aba, nem mais de 31 letras.
const nomeDaAba = (s) => String(s).replace(/[:\\/?*[\]]/g, " ").slice(0, 31).trim() || "Planilha";
// Estilos: 1 cabeçalho em negrito, 2 moeda, 3 percentual, 4 data, 5 número.
const ESTILO = { moeda: 2, percentual: 3, data: 4, numero: 5 };

function celula(valor, tipo, ref) {
  if (valor === null || valor === undefined || valor === "") return "";
  if (tipo === "data") {
    const s = serialDaData(valor);
    if (s !== null) return `<c r="${ref}" s="4"><v>${s}</v></c>`;
  }
  if (tipo in ESTILO && tipo !== "data" && Number.isFinite(Number(valor))) {
    const v = tipo === "percentual" ? Number(valor) / 100 : Number(valor);
    return `<c r="${ref}" s="${ESTILO[tipo]}"><v>${v}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(valor)}</t></is></c>`;
}

export function gerarXlsx({ aba = "Planilha", colunas, linhas }) {
  const cabecalho = `<row r="1">${colunas.map((c, i) => `<c r="${letra(i)}1" t="inlineStr" s="1"><is><t>${xml(c.titulo)}</t></is></c>`).join("")}</row>`;
  const corpo = linhas.map((l, n) => `<row r="${n + 2}">${colunas.map((c, i) => celula(l[i], c.tipo, `${letra(i)}${n + 2}`)).join("")}</row>`).join("");
  const larguras = `<cols>${colunas.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.largura ?? 16}" customWidth="1"/>`).join("")}</cols>`;
  const planilha = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${larguras}<sheetData>${cabecalho}${corpo}</sheetData></worksheet>`;
  const estilos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;R$&quot; #,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="6"><xf/><xf fontId="1" applyFont="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="10" applyNumberFormat="1"/><xf numFmtId="165" applyNumberFormat="1"/><xf numFmtId="2" applyNumberFormat="1"/></cellXfs></styleSheet>`;
  return zip([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(nomeDaAba(aba))}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/worksheets/sheet1.xml", planilha],
    ["xl/styles.xml", estilos],
  ]);
}
