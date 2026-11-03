// Confere se o que está instalado corresponde ao package-lock.json. Sai com código 1 se precisar instalar.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const lerJson = (caminho) => JSON.parse(readFileSync(caminho, "utf8"));

function faltaAlgo() {
  const { dependencies = {} } = lerJson(join(raiz, "package.json"));
  const lock = lerJson(join(raiz, "package-lock.json")).packages;
  for (const nome of Object.keys(dependencies)) {
    const instalado = join(raiz, "node_modules", nome, "package.json");
    if (!existsSync(instalado)) return true;
    if (lerJson(instalado).version !== lock[`node_modules/${nome}`]?.version) return true;
  }
  return !existsSync(join(raiz, "public", "vendor", "pdfjs", "pdf.min.mjs"));
}

try {
  process.exit(faltaAlgo() ? 1 : 0);
} catch {
  process.exit(1);
}
