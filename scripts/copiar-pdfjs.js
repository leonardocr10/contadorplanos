// Copia o pdf.js de node_modules para public/vendor, de onde o navegador o carrega sem internet.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const origem = join(raiz, "node_modules", "pdfjs-dist");
const vendor = join(raiz, "public", "vendor");
const destino = join(vendor, "pdfjs");

// Em public/vendor fica só o que o sistema usa: o que sobrou de versões anteriores sai.
if (existsSync(vendor)) {
  for (const item of readdirSync(vendor)) if (item !== "pdfjs") rmSync(join(vendor, item), { recursive: true, force: true });
}

if (!existsSync(origem)) {
  console.log("pdfjs-dist ainda não está instalado; nada a copiar.");
  process.exit(0);
}

rmSync(destino, { recursive: true, force: true });
mkdirSync(destino, { recursive: true });
for (const arquivo of ["pdf.min.mjs", "pdf.worker.min.mjs"]) {
  cpSync(join(origem, "build", arquivo), join(destino, arquivo));
}
for (const pasta of ["cmaps", "standard_fonts", "wasm"]) {
  if (existsSync(join(origem, pasta))) cpSync(join(origem, pasta), join(destino, pasta), { recursive: true });
}
console.log("pdf.js copiado para public/vendor/pdfjs");
