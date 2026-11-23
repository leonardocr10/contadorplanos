// Campo de telefone do cliente: no máximo 11 dígitos (DDD + número), já no formato (34) 99999-0000
// enquanto digita. Digitar além disso não entra; colar um número com +55 ou com sobra fica com os 11 dígitos.
import { normFone } from "./calculo.js";

export const MAX_DIGITOS_FONE = 11;
const digitos = (s) => String(s ?? "").replace(/\D/g, "");

// Formato enquanto digita: (3 → (34) 9999 → (34) 9999-000 → (34) 99999-0000.
export function mascaraFone(texto) {
  const d = digitos(texto).slice(0, MAX_DIGITOS_FONE);
  if (!d) return "";
  if (d.length <= 2) return `(${d}`;
  const ddd = `(${d.slice(0, 2)}) `, n = d.slice(2);
  if (n.length <= 4) return ddd + n;
  const corte = n.length === 9 ? 5 : 4;
  return `${ddd}${n.slice(0, corte)}-${n.slice(corte)}`;
}

// O valor que o campo teria com o texto novo no lugar do trecho selecionado.
function valorCom(input, texto) {
  const { value, selectionStart: ini = value.length, selectionEnd: fim = value.length } = input;
  return value.slice(0, ini ?? value.length) + texto + value.slice(fim ?? value.length);
}

// Número colado: tira o +55 do país e fica com os 11 primeiros dígitos.
export function foneColado(texto) {
  return normFone(texto).slice(0, MAX_DIGITOS_FONE);
}

// Do texto digitado, só entra até completar os 11 dígitos; o resto fica de fora.
function cabeNoCampo(input, texto) {
  let livres = MAX_DIGITOS_FONE - digitos(valorCom(input, "")).length;
  let saida = "";
  for (const c of texto) {
    if (/\d/.test(c)) { if (livres <= 0) break; livres--; }
    saida += c;
  }
  return saida;
}

// Posição no texto formatado logo depois do n-ésimo dígito.
function posicaoDoDigito(texto, n) {
  if (n <= 0) return texto.startsWith("(") && texto.length > 1 ? 1 : 0;
  let vistos = 0;
  for (let i = 0; i < texto.length; i++) if (/\d/.test(texto[i]) && ++vistos === n) return i + 1;
  return texto.length;
}

export function travarFone(input) {
  input.setAttribute("inputmode", "tel");
  let anterior = input.value;
  input.addEventListener("beforeinput", (e) => {
    if (e.inputType !== "insertText" && e.inputType !== "insertCompositionText") return;
    if (digitos(valorCom(input, e.data ?? "")).length <= MAX_DIGITOS_FONE) return;
    e.preventDefault();
    const parte = cabeNoCampo(input, e.data ?? "");
    if (!parte) return;
    input.setRangeText(parte, input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length, "end");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  input.addEventListener("paste", (e) => {
    const texto = e.clipboardData?.getData("text") ?? "";
    const junto = valorCom(input, texto);
    if (digitos(junto).length <= MAX_DIGITOS_FONE) return;
    e.preventDefault();
    input.value = foneColado(junto);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // A cada mudança o campo volta ao formato, com o cursor no mesmo dígito.
  input.addEventListener("input", (e) => {
    let valor = input.value;
    let cursor = input.selectionStart ?? valor.length;
    if (digitos(valor).length > MAX_DIGITOS_FONE) { valor = foneColado(valor); cursor = valor.length; }
    let antes = digitos(valor.slice(0, cursor)).length;
    // Apagar um parêntese, espaço ou traço apaga o dígito vizinho; senão o formato voltaria e o apagar não andaria.
    if (digitos(valor) === digitos(anterior) && valor.length < anterior.length) {
      const d = digitos(valor);
      if (e.inputType === "deleteContentBackward" && antes > 0) { valor = d.slice(0, antes - 1) + d.slice(antes); antes--; }
      else if (e.inputType === "deleteContentForward" && antes < d.length) valor = d.slice(0, antes) + d.slice(antes + 1);
    }
    const formatado = mascaraFone(valor);
    anterior = formatado;
    if (formatado === input.value) return;
    input.value = formatado;
    if (document.activeElement === input) {
      const pos = posicaoDoDigito(formatado, antes);
      input.setSelectionRange(pos, pos);
    }
  });
  // Valor posto pelo sistema (reabrir cotação, editar contrato): guarda para comparar no próximo apagar.
  input.addEventListener("focus", () => { anterior = input.value; });
}
