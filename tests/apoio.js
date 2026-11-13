// Apoio dos testes: monta as vidas das 10 faixas a partir das idades.
import { faixaDe } from "../public/js/calculo.js";

// "35, 32, 7" vira as contagens das 10 faixas.
export function idadesParaVidas(texto) {
  const vidas = Array(10).fill(0);
  const idades = (String(texto).match(/\d+/g) || []).map(Number).filter((a) => a <= 120);
  for (const a of idades) vidas[faixaDe(a)]++;
  return vidas;
}
