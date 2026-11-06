// Copia o pdf.js e o leitor de texto (Tesseract) de node_modules para public/vendor,
// de onde o navegador os carrega sem depender de outros sites.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const modulos = join(raiz, "node_modules");
const vendor = join(raiz, "public", "vendor");

function copiarPdfJs() {
  const origem = join(modulos, "pdfjs-dist");
  const destino = join(vendor, "pdfjs");
  if (!existsSync(origem)) return console.log("pdfjs-dist ainda não está instalado; nada a copiar.");
  rmSync(destino, { recursive: true, force: true });
  mkdirSync(destino, { recursive: true });
  for (const arquivo of ["pdf.min.mjs", "pdf.worker.min.mjs"]) cpSync(join(origem, "build", arquivo), join(destino, arquivo));
  for (const pasta of ["cmaps", "standard_fonts", "wasm"]) {
    if (existsSync(join(origem, pasta))) cpSync(join(origem, pasta), join(destino, pasta), { recursive: true });
  }
  console.log("pdf.js copiado para public/vendor/pdfjs");
}

// Só as versões LSTM do núcleo: o leitor usa apenas esse modo, e o navegador escolhe a que ele suporta.
function copiarTesseract() {
  const js = join(modulos, "tesseract.js", "dist"), nucleo = join(modulos, "tesseract.js-core"), idioma = join(modulos, "@tesseract.js-data", "por", "4.0.0_best_int");
  if (![js, nucleo, idioma].every(existsSync)) return console.log("tesseract.js ainda não está instalado; nada a copiar.");
  const destino = join(vendor, "tesseract");
  rmSync(destino, { recursive: true, force: true });
  mkdirSync(join(destino, "lang"), { recursive: true });
  for (const arquivo of ["tesseract.esm.min.js", "worker.min.js"]) cpSync(join(js, arquivo), join(destino, arquivo));
  for (const variante of ["", "-simd", "-relaxedsimd"]) cpSync(join(nucleo, `tesseract-core${variante}-lstm.wasm.js`), join(destino, `tesseract-core${variante}-lstm.wasm.js`));
  cpSync(join(idioma, "por.traineddata.gz"), join(destino, "lang", "por.traineddata.gz"));
  console.log("Tesseract copiado para public/vendor/tesseract");
}

copiarPdfJs();
copiarTesseract();
