import test from "node:test";
import assert from "node:assert/strict";
import { cnpjValido, cpfValido, extrairCampos, tipoDoDocumento } from "../public/js/documento-campos.js";

const campo = (r, nome) => r.campos.filter((c) => c.campo === nome).map((c) => c.valor);

test("confere os dígitos do CPF e do CNPJ", () => {
  assert.equal(cpfValido("529.982.247-25"), true);
  assert.equal(cpfValido("529.982.247-26"), false);
  assert.equal(cpfValido("111.111.111-11"), false);
  assert.equal(cnpjValido("11.222.333/0001-81"), true);
  assert.equal(cnpjValido("11.222.333/0001-82"), false);
});

// Texto como o leitor costuma devolver de uma CNH: rótulos e valores em linhas separadas e algum ruído.
const CNH = `REPÚBLICA FEDERATIVA DO BRASIL
MINISTÉRIO DA INFRAESTRUTURA
CARTEIRA NACIONAL DE HABILITAÇÃO
NOME E SOBRENOME
MARIA APARECIDA DA SILVA
DOC. IDENTIDADE / ÓRG. EMISSOR / UF
MG-12.345.678 SSP MG
CPF DATA NASCIMENTO
529.982.247-25 | 15/03/1985
FILIAÇÃO
JOSÉ CARLOS DA SILVA
ANA MARIA DE SOUZA
CAT. HAB.
AB
Nº REGISTRO VALIDADE 1ª HABILITAÇÃO
01234567890 20/05/2030 10/01/2005
DATA EMISSÃO
20/05/2025
UBERLÂNDIA, MG`;

test("encontra os dados de uma CNH", () => {
  const r = extrairCampos(CNH);
  assert.equal(r.tipoDocumento, "CNH");
  assert.deepEqual(campo(r, "Nome"), ["MARIA APARECIDA DA SILVA"]);
  assert.deepEqual(campo(r, "CPF"), ["529.982.247-25"]);
  assert.deepEqual(campo(r, "Data de nascimento"), ["15/03/1985"]);
  assert.deepEqual(campo(r, "Filiação (pai)"), ["JOSÉ CARLOS DA SILVA"]);
  assert.deepEqual(campo(r, "Filiação (mãe)"), ["ANA MARIA DE SOUZA"]);
  assert.deepEqual(campo(r, "Categoria"), ["AB"]);
  assert.deepEqual(campo(r, "Nº de registro"), ["01234567890"]);
  assert.deepEqual(campo(r, "Órgão emissor"), ["SSP/MG"]);
  assert.ok(campo(r, "RG")[0].includes("12.345.678"));
  assert.deepEqual(campo(r, "Data de expedição"), ["20/05/2025"]);
  // Duas datas na linha e dois rótulos na de cima: cada data fica com o seu.
  assert.deepEqual(campo(r, "Validade"), ["20/05/2030"]);
  assert.deepEqual(campo(r, "Primeira habilitação"), ["10/01/2005"]);
});

// Como a leitura da foto devolveu de verdade: a categoria junta com o nome do pai, e o º vira outro símbolo.
test("separa a categoria do nome quando a leitura junta as duas na linha", () => {
  const r = extrairCampos(`CARTEIRA NACIONAL DE HABILITAÇÃO\nNOME E SOBRENOME\nMARIA APARECIDA DA SILVA\nCPF DATA NASCIMENTO\n529.982.247-25 15/03/1985\nFILIAÇÃO CAT. HAB.\nJOSÉ CARLOS DA SILVA AB\nANA MARIA DE SOUZA\nNº REGISTRO VALIDADE 1º HABILITAÇÃO\n01234567890 20/05/2030 10/01/2005`);
  assert.deepEqual(campo(r, "Filiação (pai)"), ["JOSÉ CARLOS DA SILVA"]);
  assert.deepEqual(campo(r, "Filiação (mãe)"), ["ANA MARIA DE SOUZA"]);
  assert.deepEqual(campo(r, "Categoria"), ["AB"]);
  assert.deepEqual(campo(r, "Validade"), ["20/05/2030"]);
  assert.deepEqual(campo(r, "Primeira habilitação"), ["10/01/2005"]);
  assert.deepEqual(campo(r, "Data de nascimento"), ["15/03/1985"]);
});

const RG = `REPÚBLICA FEDERATIVA DO BRASIL
ESTADO DE MINAS GERAIS
SECRETARIA DE ESTADO DE SEGURANÇA PÚBLICA
CARTEIRA DE IDENTIDADE
REGISTRO GERAL 12.345.678 DATA DE EXPEDIÇÃO 02/08/2010
NOME
JOÃO PEDRO OLIVEIRA
FILIAÇÃO
ANTÔNIO OLIVEIRA
LUCIA OLIVEIRA
NATURALIDADE DATA DE NASCIMENTO
UBERLÂNDIA - MG 30/11/1990
CPF 529.982.247-25`;

test("encontra os dados de um RG", () => {
  const r = extrairCampos(RG);
  assert.equal(r.tipoDocumento, "RG");
  assert.deepEqual(campo(r, "Nome"), ["JOÃO PEDRO OLIVEIRA"]);
  assert.deepEqual(campo(r, "RG"), ["12.345.678"]);
  assert.deepEqual(campo(r, "Data de expedição"), ["02/08/2010"]);
  assert.deepEqual(campo(r, "Data de nascimento"), ["30/11/1990"]);
  assert.deepEqual(campo(r, "CPF"), ["529.982.247-25"]);
  assert.deepEqual(campo(r, "Filiação (mãe)"), ["LUCIA OLIVEIRA"]);
});

test("comprovante e cartão CNPJ trazem endereço, CEP e empresa", () => {
  const conta = extrairCampos(`CEMIG DISTRIBUIÇÃO\nFATURA DE ENERGIA\nMARIA DA SILVA\nRUA DAS FLORES, 123 APTO 4\nBAIRRO CENTRO\nUBERLÂNDIA MG 38400-123\nVENCIMENTO 10/12/2026\ncontato@exemplo.com (34) 99999-0000`);
  assert.equal(conta.tipoDocumento, "Comprovante de residência");
  assert.deepEqual(campo(conta, "Endereço"), ["RUA DAS FLORES, 123 APTO 4"]);
  assert.deepEqual(campo(conta, "CEP"), ["38400-123"]);
  assert.deepEqual(campo(conta, "Bairro"), ["CENTRO"]);
  assert.deepEqual(campo(conta, "Validade"), ["10/12/2026"]);
  assert.deepEqual(campo(conta, "E-mail"), ["contato@exemplo.com"]);
  assert.deepEqual(campo(conta, "Telefone"), ["(34) 99999-0000"]);
  const cnpj = extrairCampos(`CADASTRO NACIONAL DA PESSOA JURÍDICA\nNÚMERO DE INSCRIÇÃO\n11.222.333/0001-81\nNOME EMPRESARIAL\nEXEMPLO CORRETORA LTDA`);
  assert.equal(cnpj.tipoDocumento, "Cartão CNPJ");
  assert.deepEqual(campo(cnpj, "CNPJ"), ["11.222.333/0001-81"]);
  assert.deepEqual(campo(cnpj, "Razão social"), ["EXEMPLO CORRETORA LTDA"]);
});

test("não inventa: texto sem dados não vira campo", () => {
  assert.deepEqual(extrairCampos("REPÚBLICA FEDERATIVA DO BRASIL\n123.456.789-00\n||| ~~~").campos, []);
  assert.equal(tipoDoDocumento("qualquer coisa"), "Documento");
  assert.deepEqual(extrairCampos(""), { tipoDocumento: "Documento", campos: [] });
});
