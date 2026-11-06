// Encontra no texto lido do RG, da CNH ou da Carteira de Identidade só os dados usados na proposta:
// nome, CPF, data de nascimento, número do RG, data de expedição, filiação e naturalidade.
// Roda inteiro no navegador: nada do documento sai do computador.

const semAcento = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const so = (s) => String(s).replace(/\D/g, "");
const UF = "AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO";

export const CAMPOS = ["Nome", "CPF", "Data de nascimento", "Número do RG", "Data de expedição", "Filiação", "Naturalidade"];

export function cpfValido(numeros) {
  const d = so(numeros);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const digito = (n) => {
    const soma = [...d.slice(0, n)].reduce((t, c, i) => t + Number(c) * (n + 1 - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return digito(9) === Number(d[9]) && digito(10) === Number(d[10]);
}
const formatarCpf = (d) => `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;

export function tipoDoDocumento(texto) {
  const t = semAcento(texto);
  if (/HABILITACAO|DRIVER LICENSE|PERMISO DE CONDUC/.test(t)) return "CNH";
  if (/IDENTIDADE NACIONAL|PERSONAL NUMBER|CARD ISSUER|CARDHOLDER|FILIATION|PLACE OF BIRTH/.test(t)) return "Carteira de Identidade";
  if (/REGISTRO GERAL|CARTEIRA DE IDENTIDADE|SECRETARIA DE SEGURANCA|INSTITUTO DE IDENTIFICACAO|NATURALIDADE/.test(t) || new RegExp(`\\b(${UF})-\\d{1,2}\\.\\d{3}\\.\\d{3}\\b`).test(t)) return "RG";
  return "Documento";
}

// A leitura da foto troca letras por números parecidos (e vice-versa) dentro dos números.
const corrigirNumeros = (s) => s.replace(/[\dOoIl|]{3,}[\d.\-/OoIl|]*/g, (m) => (/\d/.test(m) ? m.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1") : m));

const CONECTORES = new Set(["DE", "DA", "DO", "DOS", "DAS", "E"]);
// Um nome: palavras em maiúsculas, com vogal, sem sequências de consoantes que nenhum nome tem.
function nomeDaLinha(linha) {
  const palavras = String(linha).split(/\s+/).map((p) => p.replace(/^[^A-ZÀ-Ú]+|[^A-ZÀ-Ú]+$/g, ""));
  const boa = (p) => CONECTORES.has(semAcento(p)) || (/^[A-ZÀ-Ú]{2,}$/.test(p) && /[AEIOUY]/.test(semAcento(p)) && !/[^AEIOUY]{4}/.test(semAcento(p)) && !/(.)\1\1/.test(p));
  let melhor = [], atual = [];
  for (const p of [...palavras, ""]) {
    if (p && boa(p)) { atual.push(p); continue; }
    while (atual.length && CONECTORES.has(semAcento(atual[0]))) atual.shift();
    while (atual.length && CONECTORES.has(semAcento(atual.at(-1)))) atual.pop();
    const fortes = atual.filter((x) => !CONECTORES.has(semAcento(x)) && x.length >= 3).length;
    if (fortes >= 2 && atual.join(" ").length > melhor.join(" ").length) melhor = atual;
    atual = [];
  }
  const nome = melhor.join(" ");
  return TITULOS.test(semAcento(nome)) || ROTULO.test(semAcento(nome)) ? "" : nome;
}
const TITULOS = /REPUBLICA|FEDERATIVA|BRASIL|MINISTERIO|SECRETARIA|ESTADO|GOVERNO|POLICIA|INSTITUTO|CARTEIRA|NACIONAL|TERRITORIO|ASSINATURA|DIRETOR|IDENTIDADE|HABILITACAO|TRANSITO|BRASILEIR|HORIZONTE/;
// Palavras dos rótulos do documento: uma linha com elas é rótulo, não nome de pessoa.
const ROTULO = /\b(DATA|EMISSAO|EXPEDICAO|EXPEDIDOR|LOCAL|VALIDADE|NOME|CPF|REGISTRO|ORGAO|EMISSOR|NACIONALIDADE|NATURALIDADE|SEXO|CARD|ISSUER|ISSUE|PLACE|BIRTH|NAME|EXPIRY|NATIONALITY|SIGNATURE|DOC|CATEGORIA|HAB)\b/;

// Rótulos de cada data; validade e 1ª habilitação entram só para não serem confundidas com as outras.
const ROTULOS_DE_DATA = [
  [/NASC|BIRTH/, "Data de nascimento"],
  [/EXPEDI|EMISS|ISSUE\b/, "Data de expedição"],
  [/VALIDADE|EXPIRY|VALIDA ATE/, ""],
  [/HABILITA/, ""],
];
const rotulosDaLinha = (linha) => ROTULOS_DE_DATA
  .map(([r, nome]) => ({ nome, pos: semAcento(linha).search(r) }))
  .filter((r) => r.pos >= 0)
  .sort((a, b) => a.pos - b.pos);

function datasDaLinha(linha) {
  const datas = [];
  for (const m of linha.matchAll(/(?<!\d)(\d{1,2})[/.-]?(\d{1,2})[/.-](\d{4})(?!\d)/g)) {
    // A leitura costuma trocar o 9 de "19xx" por 0 ("1094"): ano que começa com 10 volta a ser 19.
    const [dia, mes] = [Number(m[1]), Number(m[2])];
    const ano = /^10\d\d$/.test(m[3]) ? Number(`19${m[3].slice(2)}`) : Number(m[3]);
    if (dia < 1 || dia > 31 || mes < 1 || mes > 12 || ano < 1900 || ano > 2100) continue;
    datas.push({ valor: `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}/${ano}`, pos: m.index, fim: m.index + m[0].length });
  }
  return datas;
}

export function extrairCampos(texto) {
  const linhas = String(texto || "").split(/\r?\n/).map((l) => corrigirNumeros(l.replace(/\s{2,}/g, " ").trim())).filter(Boolean);
  const tudo = linhas.join("\n");
  const tipo = tipoDoDocumento(tudo);
  const achados = {};
  const guardar = (campo, valor) => { if (valor && !achados[campo]) achados[campo] = valor; };
  const proximas = (i, n = 2) => linhas.slice(i + 1, i + 1 + n);

  // Nome: depois do rótulo, na mesma linha ou nas seguintes.
  linhas.forEach((l, i) => {
    const t = semAcento(l);
    const m = t.match(/\bNOME\b(?:\s+E\s+SOBRENOME)?(?!\s+(?:SOCIAL|DO PAI|DA MAE|EMPRESARIAL))/);
    if (!m || /NOME SOCIAL|SOCIAL NAME/.test(t)) return;
    guardar("Nome", nomeDaLinha(l.slice(m.index + m[0].length).replace(/\/\s*NAME\b/i, "")) || proximas(i).map(nomeDaLinha).find(Boolean));
  });
  // Na CNH, o nome é a primeira linha com nome depois do título, mesmo quando o rótulo não sai na leitura.
  if (tipo === "CNH" && !achados.Nome) {
    const titulo = linhas.findIndex((l) => /HABILITACAO|DRIVER LICENSE/.test(semAcento(l)));
    if (titulo >= 0) guardar("Nome", linhas.slice(titulo + 1, titulo + 4).map(nomeDaLinha).find(Boolean));
  }

  // CPF: só número que passa na conferência dos dígitos; perto do rótulo, aceita sem os pontos.
  for (const m of tudo.matchAll(/\d{3}[.\s]\d{3}[.\s]\d{3}[-\s.]\d{2}/g)) if (cpfValido(m[0])) guardar("CPF", formatarCpf(so(m[0])));
  linhas.forEach((l, i) => {
    if (!/\bCPF\b/.test(semAcento(l))) return;
    for (const linha of [l, ...proximas(i)]) for (const m of linha.matchAll(/(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g)) if (cpfValido(m[0])) guardar("CPF", formatarCpf(so(m[0])));
  });

  // Número do RG: o do RG antigo tem a UF na frente; na CNH vem em "Doc. identidade";
  // na Carteira de Identidade nova, o registro geral é o próprio CPF.
  // Sem a UF legível, o formato 00.000.000 do RG ainda o identifica (o CPF tem um traço no fim).
  // No RG antigo o número fica na mesma linha da data de expedição, o que também o identifica.
  const RG_SEM_UF = /(?<![\d.])\d{1,2}\.\s?\d{3}\.\s?\d{3}(?![\d.-])/;
  const rgComUf = tudo.match(new RegExp(`\\b(?:${UF})-?\\s?\\d{1,2}\\.?\\d{3}\\.?\\d{3}\\b`))
    ?? (tipo === "RG" ? tudo.match(RG_SEM_UF) : null)
    ?? linhas.filter((l) => datasDaLinha(l).length).map((l) => l.match(RG_SEM_UF)).find(Boolean);
  if (rgComUf) guardar("Número do RG", rgComUf[0].replace(/\s/g, ""));
  linhas.forEach((l, i) => {
    const t = semAcento(l);
    if (/REGISTRO GERAL/.test(t) && /CPF/.test(t) && achados.CPF) guardar("Número do RG", achados.CPF);
    if (!/DOC(?:UMENTO)?\.?\s?(?:DE\s)?IDENTIDADE|REGISTRO GERAL|\bRG\b/.test(t) || /CPF/.test(t)) return;
    for (const linha of [l.slice(t.search(/IDENTIDADE|GERAL|\bRG\b/) + 5), ...proximas(i)]) {
      const m = semAcento(linha).match(/\b[A-Z]{0,2}-?\d[\d.\-]{4,12}[\dX]\b/);
      if (m && !cpfValido(m[0])) { guardar("Número do RG", m[0]); break; }
    }
  });

  // Datas: o rótulo da mesma linha diz qual é; sem ele, valem os da linha de cima, na ordem.
  // Na leitura por partes, o rótulo pode ficar algumas linhas acima: vale o mais próximo, se for um só.
  linhas.forEach((l, i) => {
    const datas = datasDaLinha(l);
    const deCima = rotulosDaLinha(linhas[i - 1] || "");
    const acima = linhas.slice(Math.max(0, i - 4), i).reverse().map(rotulosDaLinha).find((r) => r.length);
    datas.forEach((d, k) => {
      const naLinha = rotulosDaLinha(l.slice(datas[k - 1]?.fim ?? 0, d.pos)).at(-1);
      const rotulo = naLinha ?? (deCima.length === datas.length ? deCima[k] : !deCima.length && datas.length === 1 && acima?.length === 1 ? acima[0] : null);
      if (rotulo) guardar(rotulo.nome, d.valor);
      // No RG antigo, a data de expedição fica na mesma linha do número do RG.
      else if (rgComUf && l.includes(rgComUf[0].slice(0, 5))) guardar("Data de expedição", d.valor);
    });
  });

  // Filiação: os dois nomes que vêm depois do rótulo, na ordem do documento, até o próximo rótulo.
  const filiacao = [];
  linhas.forEach((l, i) => {
    if (filiacao.length || !/\bF\w{0,3}ACAO\b|FILIATION/.test(semAcento(l))) return;
    for (const linha of linhas.slice(i + 1, i + 9)) {
      if (ROTULO.test(semAcento(linha))) break;
      const nome = nomeDaLinha(linha);
      if (nome && nome !== achados.Nome) filiacao.push(nome);
      if (filiacao.length === 2) break;
    }
  });

  // Naturalidade: cidade e UF, como UBERLANDIA/MG ou COROMANDEL-MG.
  const cidadeUf = (linha) => {
    const m = semAcento(linha.replace(/(?<=[A-Za-z])1(?=[A-Za-z])/g, "I")).match(new RegExp(`([A-Z][A-Z ]{2,}?)\\s?[/,-]\\s?(${UF})\\b`));
    return m ? `${m[1].trim()}/${m[2]}` : "";
  };
  linhas.forEach((l, i) => {
    const t = semAcento(l);
    if (!/NATURALIDADE|PLACE OF BIRTH|LOCAL E UF DE NASCIMENTO/.test(t)) return;
    const resto = l.slice(t.search(/NATURALIDADE|PLACE OF BIRTH|NASCIMENTO/) + 12);
    guardar("Naturalidade", [resto, ...proximas(i)].map(cidadeUf).find(Boolean));
  });
  // Na CNH, a data de nascimento vem junto da cidade e da UF ("05/09/1980 ARAGUARI/MG"):
  // mesmo sem o rótulo legível, esse par é o nascimento.
  for (const l of linhas) {
    const [d] = datasDaLinha(l);
    const cidade = d ? cidadeUf(l.slice(d.fim)) : "";
    if (!cidade || ROTULO.test(semAcento(l.slice(d.fim)))) continue;
    guardar("Data de nascimento", d.valor);
    guardar("Naturalidade", cidade);
    break;
  }

  const campos = CAMPOS.flatMap((campo) => (campo === "Filiação" ? filiacao.map((valor) => ({ campo, valor })) : achados[campo] ? [{ campo, valor: achados[campo] }] : []));
  return { tipoDocumento: tipo, campos };
}

// Junta as leituras da mesma imagem: vale o primeiro valor achado de cada dado. No nome, a leitura
// costuma cortar o começo ou o fim, então fica o mais completo.
export function juntarLeituras(leituras) {
  const tipo = leituras.map((l) => l.tipoDocumento).find((t) => t !== "Documento") ?? "Documento";
  const campos = [];
  for (const campo of CAMPOS) {
    const valores = leituras.map((l) => l.campos.filter((c) => c.campo === campo).map((c) => c.valor));
    const escolhidos = campo === "Filiação" ? (valores.find((v) => v.length === 2) ?? valores.find((v) => v.length) ?? [])
      : campo === "Nome" ? valores.flat().sort((a, b) => b.length - a.length).slice(0, 1)
      : (valores.find((v) => v.length) ?? []).slice(0, 1);
    campos.push(...escolhidos.map((valor) => ({ campo, valor })));
  }
  return { tipoDocumento: tipo, campos };
}
