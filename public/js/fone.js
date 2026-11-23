// Campo de telefone do cliente: no máximo 11 dígitos (DDD + número). Digitar além disso não entra;
// colar um número com +55 ou com sobra fica com os 11 dígitos, já formatado.
import { fmtFone, normFone } from "./calculo.js";

export const MAX_DIGITOS_FONE = 11;
const digitos = (s) => String(s ?? "").replace(/\D/g, "");

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

export function travarFone(input) {
  input.setAttribute("inputmode", "tel");
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
    input.value = fmtFone(foneColado(junto));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // Preenchimento automático ou arrastar: corta o que passar de 11 dígitos.
  input.addEventListener("input", () => {
    if (digitos(input.value).length > MAX_DIGITOS_FONE) input.value = fmtFone(foneColado(input.value));
  });
}
