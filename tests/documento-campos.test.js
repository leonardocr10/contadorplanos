import test from "node:test";
import assert from "node:assert/strict";
import { CAMPOS, cpfValido, extrairCampos, juntarLeituras, tipoDoDocumento } from "../public/js/documento-campos.js";

// Os textos abaixo imitam o que a leitura das fotos devolve de verdade (ruído, ordem trocada,
// letras no lugar de números), mas com nomes e números inventados.
const valores = (r) => Object.fromEntries(CAMPOS.map((c) => [c, r.campos.filter((x) => x.campo === c).map((x) => x.valor)]));

test("confere os dígitos do CPF", () => {
  assert.equal(cpfValido("529.982.247-25"), true);
  assert.equal(cpfValido("529.982.247-26"), false);
  assert.equal(cpfValido("111.111.111-11"), false);
});

test("só traz os dados usados na proposta, na ordem combinada", () => {
  assert.deepEqual(CAMPOS, ["Nome", "CPF", "Data de nascimento", "Número do RG", "Data de expedição", "Filiação", "Naturalidade"]);
});

test("CNH: nome, CPF, nascimento, RG, filiação e naturalidade", () => {
  const r = extrairCampos(`REPÚBLICA FEDERATIVA DO BRASIL
CARTEIRA NACIONAL DE HABILITAÇÃO / DRIVER LICENSE / PERMISO DE CONDUCCION
2 e 1 NOME E SOBRENOME 1º HABILITAÇÃO
CAROLINA PEREIRA LIMA [ 11/07/2001
3 DATA, LOCAL E UF DE NASCIMENTO
05/09/1980 ARAGUARI/MG
4a DATA EMISSÃO 4b VALIDADE ACC
[ 01/10/2024 )[ 16/02/2034 ) D
4c DOC. IDENTIDADE / ÓRG. EMISSOR / UF
[M1234567 SSP MG
4d CPF 5 Nº REGISTRO 9 CAT. HAB.
[ 529.982.247-25 )[ oo0123456789 )| B
FILIAÇÃO
PAULO ROBERTO LIMA
MARIA HELENA PEREIRA LIMA
7 ASSINATURA DO PORTADOR`);
  assert.equal(r.tipoDocumento, "CNH");
  assert.deepEqual(valores(r), {
    Nome: ["CAROLINA PEREIRA LIMA"], CPF: ["529.982.247-25"], "Data de nascimento": ["05/09/1980"], "Número do RG": ["M1234567"],
    "Data de expedição": ["01/10/2024"], Filiação: ["PAULO ROBERTO LIMA", "MARIA HELENA PEREIRA LIMA"], Naturalidade: ["ARAGUARI/MG"],
  });
});

test("Carteira de Identidade nova: o registro geral é o próprio CPF", () => {
  const frente = extrairCampos(`REPUBLICA FEDERATIVA DO BRASIL
GOVERNO FEDERAL
Polícia Cívil do Estado de Minas Gerais
Nome / Name
VITOR AUGUSTO MENDES ROCHA
Nome Social / Social Name
Registro Geral - CPF / Personal Number
529982247-25
Data de Nascimento / Date of Birth Nacionalidade / Nationality
08/01/2002 BRA
Naturalidade / Place of Birth Validade / Expiry
UBERLANDIA/MG 25/03/2035`);
  assert.equal(frente.tipoDocumento, "Carteira de Identidade");
  const f = valores(frente);
  assert.deepEqual(f.Nome, ["VITOR AUGUSTO MENDES ROCHA"]);
  assert.deepEqual(f.CPF, ["529.982.247-25"]);
  assert.deepEqual(f["Número do RG"], ["529.982.247-25"]);
  assert.deepEqual(f["Data de nascimento"], ["08/01/2002"]);
  assert.deepEqual(f.Naturalidade, ["UBERLANDIA/MG"]);
  // Validade não é um dos dados pedidos.
  assert.ok(!frente.campos.some((c) => c.valor === "25/03/2035"));

  // No verso, a leitura por partes separa rótulos e valores em linhas distantes.
  const verso = extrairCampos(`Fiação / Fliaton
HELENA CRISTINA ALVES ROCHA
JORGE LUIZ MENDES ROCHA
Órgão Expedidor / Card Issuer
INSTITUTO DE IDENTIFICAÇÃO / PCMG
Emissão / Issue
Local / Place of Issue
BELO HORIZONTE
25/03/2025`);
  const v = valores(verso);
  assert.deepEqual(v.Filiação, ["HELENA CRISTINA ALVES ROCHA", "JORGE LUIZ MENDES ROCHA"]);
  assert.deepEqual(v["Data de expedição"], ["25/03/2025"]);
});

test("RG antigo: número com a UF, expedição na mesma linha e mês com um dígito", () => {
  const r = extrairCampos(`VÁLIDA EM TODO O TERRITÓRIO NACIONAL
REGISTRO MG-12.345.678 DATA DE 11/09/2018
GERAL EXPEDIÇÃO
NOME
ANDREIA COSTA MARTINS
FILIAÇÃO
ROBERTO MARTINS
SILVIA COSTA MARTINS
NATURALIDADE DATA DE NASCIMENTO
UBERLANDIA-MG 28/6/1995
CPF 529.982.247-25`);
  assert.equal(r.tipoDocumento, "RG");
  assert.deepEqual(valores(r), {
    Nome: ["ANDREIA COSTA MARTINS"], CPF: ["529.982.247-25"], "Data de nascimento": ["28/06/1995"], "Número do RG": ["MG-12.345.678"],
    "Data de expedição": ["11/09/2018"], Filiação: ["ROBERTO MARTINS", "SILVIA COSTA MARTINS"], Naturalidade: ["UBERLANDIA/MG"],
  });
  // Sem a UF legível, o formato do número ainda identifica o RG.
  assert.deepEqual(valores(extrairCampos("REGISTRO GERAL\nxostome- 12.345. 678 uns 11/09/2018"))["Número do RG"], ["12.345.678"]);
  // Nem o rótulo legível: o número ao lado da data ainda é o RG, e a data é a expedição.
  const semRotulo = valores(extrairCampos("ps * TR\nxostome- 12.345. 678 uns 11/09/2018 BM"));
  assert.deepEqual(semRotulo["Número do RG"], ["12.345.678"]);
  assert.deepEqual(semRotulo["Data de expedição"], ["11/09/2018"]);
});

test("junta as duas leituras: o primeiro valor achado vale, e o nome mais completo fica", () => {
  const a = extrairCampos("NOME E SOBRENOME\nROLINA PEREIRA LIMA\nCPF 529.982.247-25");
  const b = extrairCampos("NOME E SOBRENOME\nCAROLINA PEREIRA LIMA\nFILIAÇÃO\nPAULO ROBERTO LIMA\nMARIA HELENA LIMA");
  const j = valores(juntarLeituras([a, b]));
  assert.deepEqual(j.Nome, ["CAROLINA PEREIRA LIMA"]);
  assert.deepEqual(j.CPF, ["529.982.247-25"]);
  assert.deepEqual(j.Filiação, ["PAULO ROBERTO LIMA", "MARIA HELENA LIMA"]);
});

test("rótulos não viram filiação, e a data com cidade e UF é o nascimento", () => {
  // "IDENTIFICAÇÃO" termina parecido com "FILIAÇÃO", e o nome da cidade não é de pessoa.
  const verso = valores(extrairCampos("Órgão Expedidor / Card Issuer\nINSTITUTO DE IDENTIFICAÇÃO / PCMG\nLocal / Place of Issue\nBELO HORIZONTE\nEmissão / Issue\n25/03/2025"));
  assert.deepEqual(verso.Filiação, []);
  const cnh = valores(extrairCampos("FILIAÇÃO\nPAULO ROBERTO LIMA\nDATA EMISSÃO\n[05/09/1980 ARAGUARI/MG |"));
  assert.deepEqual(cnh.Filiação, ["PAULO ROBERTO LIMA"]);
  assert.deepEqual(cnh["Data de nascimento"], ["05/09/1980"]);
  assert.deepEqual(cnh.Naturalidade, ["ARAGUARI/MG"]);
});

// Como a leitura da imagem de uma CNH digital (PDF) devolveu, com dados inventados.
test("CNH digital: nome sem rótulo, ano lido errado e cidade com vírgula", () => {
  const r = valores(extrairCampos(`REPÚBLICA FEDERATIVA DO BRASIL
MINISTÉRIO DOS TRANSPORTES
CARTEIRA NACIONAL DE HABILITAÇÃO / DRIVER LICENSE / PERMISO DE CONDUCCIÓN
(CAROLINA PEREIRA LIMA 1903201 —)
(10/06/1094, ARAGUARI, MG
4a DATA EMISSÃO 4b VALIDADE ACC
“ | 11/08/2026 | 07/08/2036 =`));
  assert.deepEqual(r.Nome, ["CAROLINA PEREIRA LIMA"]);
  assert.deepEqual(r["Data de nascimento"], ["10/06/1994"]);
  assert.deepEqual(r.Naturalidade, ["ARAGUARI/MG"]);
  assert.deepEqual(r["Data de expedição"], ["11/08/2026"]);
  // A folha de legendas do PDF não vira naturalidade.
  assert.deepEqual(valores(extrairCampos("3. Data e Local de Nascimento / Date and Place of Birth DD/MM/YYYY")).Naturalidade, []);
});

test("não inventa: ruído e títulos do documento não viram dado", () => {
  const r = extrairCampos("REPÚBLICA FEDERATIVA DO BRASIL\nNOME\nRSS EEOLSPISAA AA BoA EE\n123.456.789-00\nASSINATURA DO DIRETOR");
  assert.deepEqual(r.campos, []);
  assert.equal(tipoDoDocumento("qualquer coisa"), "Documento");
  assert.deepEqual(extrairCampos(""), { tipoDocumento: "Documento", campos: [] });
});
