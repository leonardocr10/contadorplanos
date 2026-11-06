// Encontra os dados de RG, CNH e outros documentos no texto lido do PDF ou da foto.
// Roda inteiro no navegador: nada do documento sai do computador.

const semAcento = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
const so = (s) => s.replace(/\D/g, "");

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

export function cnpjValido(numeros) {
  const d = so(numeros);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const digito = (n) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = [...d.slice(0, n)].reduce((t, c, i) => t + Number(c) * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return digito(12) === Number(d[12]) && digito(13) === Number(d[13]);
}

const formatarCpf = (d) => `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
const formatarCnpj = (d) => `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;

export function tipoDoDocumento(texto) {
  const t = semAcento(texto);
  if (/HABILITACAO|DRIVER LICENSE|PERMISSAO PARA DIRIGIR/.test(t)) return "CNH";
  if (/IDENTIDADE NACIONAL/.test(t)) return "Carteira de Identidade Nacional";
  if (/REGISTRO GERAL|CARTEIRA DE IDENTIDADE|SECRETARIA DE SEGURANCA|INSTITUTO DE IDENTIFICACAO/.test(t)) return "RG";
  if (/PESSOA JURIDICA|CNPJ/.test(t) && /RAZAO SOCIAL|NOME EMPRESARIAL|INSCRICAO/.test(t)) return "Cartão CNPJ";
  if (/CERTIDAO DE NASCIMENTO/.test(t)) return "Certidão de nascimento";
  if (/CERTIDAO DE CASAMENTO/.test(t)) return "Certidão de casamento";
  if (/CARTAO NACIONAL DE SAUDE|CARTAO DO SUS|\bCNS\b/.test(t)) return "Cartão do SUS";
  if (/PASSAPORTE|PASSPORT/.test(t)) return "Passaporte";
  if (/CADASTRO DE PESSOAS FISICAS|RECEITA FEDERAL/.test(t)) return "CPF";
  if (/VENCIMENTO|LEITURA|CONSUMO|FATURA|CODIGO DO CLIENTE|INSTALACAO/.test(t)) return "Comprovante de residência";
  return "Documento";
}

// Rótulos que podem aparecer antes de uma data; o primeiro que bater dá o nome do campo.
const ROTULOS_DE_DATA = [
  [/NASC/, "Data de nascimento"],
  [/VALIDADE|VALIDA ATE|VENCIMENTO/, "Validade"],
  [/1[A-Z.ºª° ]{0,3}HABILITA|PRIMEIRA HABILITA/, "Primeira habilitação"],
  [/EXPEDI|EMISSAO|EMITIDO/, "Data de expedição"],
];

// Linhas que são títulos do formulário, e não dados.
const TITULO = /REPUBLICA|FEDERATIVA|BRASIL|MINISTERIO|SECRETARIA|DEPARTAMENTO|ESTADO D|CARTEIRA|VALIDA EM|TODO O TERRITORIO|ASSINATURA|POLEGAR|DETRAN|INSTITUTO|DOCUMENTO|LEI N/;

const limparLinha = (s) => s.replace(/[|_~=*«»"“”]+/g, " ").replace(/\s{2,}/g, " ").trim();
const pareceNome = (s) => {
  const t = semAcento(s);
  return /^[A-Z][A-Z '.-]{3,}$/.test(t) && t.split(" ").filter((p) => p.length > 1).length >= 2 && !TITULO.test(t);
};

// Valor de um rótulo: o que vem depois dele na mesma linha ou, se nada, a linha seguinte.
function valorDoRotulo(linhas, rotulo, aceita = () => true) {
  for (let i = 0; i < linhas.length; i++) {
    const t = semAcento(linhas[i]);
    const m = rotulo.exec(t);
    if (!m) continue;
    const resto = limparLinha(linhas[i].slice(m.index + m[0].length)).replace(/^[\s:.\-–]+/, "");
    if (resto && aceita(resto)) return resto;
    for (let j = i + 1; j < Math.min(i + 3, linhas.length); j++) {
      const proxima = limparLinha(linhas[j]);
      if (proxima && aceita(proxima)) return proxima;
    }
  }
  return "";
}

export function extrairCampos(texto) {
  const linhas = String(texto || "").split(/\r?\n/).map(limparLinha).filter(Boolean);
  const tudo = linhas.join("\n");
  const campos = [];
  const juntar = (campo, valor) => {
    const v = String(valor || "").trim();
    if (v && !campos.some((c) => c.campo === campo && c.valor === v)) campos.push({ campo, valor: v });
  };

  // Categoria da CNH: na CNH ela fica na mesma faixa da filiação, e a leitura costuma juntar as duas na linha.
  const CATEGORIA = /(?:^|\s)(ACC|AB|AC|AD|AE|[A-E])$/;
  let categoria = "";
  linhas.forEach((l, i) => {
    if (categoria || !/CAT(?:EGORIA|\.)?\s?HAB/.test(semAcento(l))) return;
    const mesma = semAcento(l).match(/CAT(?:EGORIA|\.)?\s?HAB[A-Z.]*\s*[:.-]?\s*(ACC|AB|AC|AD|AE|[A-E])\b/);
    if (mesma) { categoria = mesma[1]; return; }
    for (const proxima of linhas.slice(i + 1, i + 3)) {
      const m = semAcento(proxima).match(CATEGORIA);
      if (m) { categoria = m[1]; break; }
    }
  });
  const semCategoria = (nome) => (categoria ? nome.replace(new RegExp(`\\s${categoria}$`), "") : nome);

  juntar("Nome", semCategoria(valorDoRotulo(linhas, /\bNOME(?: E SOBRENOME| SOCIAL| CIVIL)?\b(?! DO PAI| DA MAE| EMPRESARIAL)/, pareceNome)));
  const filiacao = (() => {
    for (let i = 0; i < linhas.length; i++) {
      if (!/FILIACAO/.test(semAcento(linhas[i]))) continue;
      return linhas.slice(i + 1, i + 4).map(semCategoria).filter(pareceNome).slice(0, 2);
    }
    return [];
  })();
  filiacao.forEach((nome, i) => juntar(filiacao.length === 2 ? (i === 0 ? "Filiação (pai)" : "Filiação (mãe)") : "Filiação", nome));
  juntar("Nome do pai", valorDoRotulo(linhas, /\bNOME DO PAI\b|\bPAI\b:/, pareceNome));
  juntar("Nome da mãe", valorDoRotulo(linhas, /\bNOME DA MAE\b|\bMAE\b:/, pareceNome));

  // CPF e CNPJ: só números que passam na conferência dos dígitos. Onze dígitos soltos só contam
  // com a palavra CPF na linha, senão o registro da CNH, por exemplo, poderia passar por CPF.
  for (const m of tudo.matchAll(/\d{3}[.\s]\d{3}[.\s]\d{3}[-\s.]\d{2}/g)) if (cpfValido(m[0])) juntar("CPF", formatarCpf(so(m[0])));
  for (const linha of linhas.filter((l) => /\bCPF\b/.test(semAcento(l)))) {
    for (const m of linha.matchAll(/(?<!\d)\d{11}(?!\d)/g)) if (cpfValido(m[0])) juntar("CPF", formatarCpf(m[0]));
  }
  for (const m of tudo.matchAll(/\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}/g)) if (cnpjValido(m[0])) juntar("CNPJ", formatarCnpj(so(m[0])));

  const rg = valorDoRotulo(linhas, /REGISTRO GERAL|\bRG\b|DOC(?:UMENTO)?\.? (?:DE )?IDENTIDADE|IDENTIDADE N/, (v) => /\d{5,}/.test(so(v)) && !cpfValido(v));
  if (rg) juntar("RG", (rg.match(/[A-Z]{0,2}[-\s]?\d[\d.\-\sX]{4,14}[\dX]/i)?.[0] || rg).trim());
  juntar("Órgão emissor", (semAcento(tudo).match(/\b(SSP|SDS|SESP|SEDS|PC|PCMG|IIRGD|DETRAN|DGPC|IFP|SJS|SSPDS)\s?[/-]?\s?(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/) || [])[0]?.replace(/\s?[/-]?\s?(?=[A-Z]{2}$)/, "/"));

  // CNH: registro de 11 dígitos e categoria.
  const registro = valorDoRotulo(linhas, /N[º°O.]?\s?(?:DO )?REGISTRO|REGISTRO N/, (v) => /^\d{9,11}$/.test(so(v).slice(0, 11)));
  if (registro) juntar("Nº de registro", so(registro).slice(0, 11));
  juntar("Categoria", categoria);

  // Datas: o rótulo da mesma linha diz qual é. Sem ele, valem os rótulos da linha de cima,
  // na ordem em que aparecem: com duas datas e dois rótulos, a primeira data é do primeiro rótulo.
  const rotulosDaLinha = (linha) => ROTULOS_DE_DATA
    .map(([r, nome]) => ({ nome, pos: semAcento(linha).search(r) }))
    .filter((r) => r.pos >= 0)
    .sort((a, b) => a.pos - b.pos);
  linhas.forEach((linha, i) => {
    const datas = [...linha.matchAll(/\b(\d{2})[/.-](\d{2})[/.-](\d{4})\b/g)];
    const deCima = rotulosDaLinha(linhas[i - 1] || "");
    datas.forEach((m, k) => {
      const data = `${m[1]}/${m[2]}/${m[3]}`;
      const naLinha = rotulosDaLinha(linha.slice(datas[k - 1] ? datas[k - 1].index + datas[k - 1][0].length : 0, m.index)).at(-1);
      const rotulo = naLinha ?? (deCima.length === datas.length ? deCima[k] : deCima.length === 1 && datas.length === 1 ? deCima[0] : null);
      juntar(rotulo ? rotulo.nome : "Data", data);
    });
  });

  juntar("Naturalidade", valorDoRotulo(linhas, /NATURALIDADE|LOCAL DE NASCIMENTO/, (v) => /[A-Z]{3,}/i.test(v) && !/\d{2}\/\d{2}/.test(v)));
  const endereco = linhas.find((l) => /^(RUA|R\.|AV\.?|AVENIDA|ALAMEDA|AL\.|TRAVESSA|TV\.|PRACA|RODOVIA|ESTRADA)\s/i.test(semAcento(l)));
  juntar("Endereço", endereco);
  juntar("Bairro", valorDoRotulo(linhas, /\bBAIRRO\b/, (v) => /[A-Z]{3,}/i.test(v)));
  const cep = tudo.match(/\b\d{2}\.?\d{3}-\d{3}\b/);
  if (cep) juntar("CEP", `${so(cep[0]).slice(0, 5)}-${so(cep[0]).slice(5)}`);
  juntar("Razão social", valorDoRotulo(linhas, /RAZAO SOCIAL|NOME EMPRESARIAL/, (v) => /[A-Z]{3,}/i.test(v)));
  for (const m of tudo.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) juntar("E-mail", m[0].toLowerCase());
  for (const m of tudo.matchAll(/\(?\b(\d{2})\)?\s?(9?\d{4})[-\s](\d{4})\b/g)) juntar("Telefone", `(${m[1]}) ${m[2]}-${m[3]}`);

  return { tipoDocumento: tipoDoDocumento(tudo), campos };
}
