# Cotador de Planos

Monta cotações por faixa etária e gera uma imagem de proposta por plano para enviar pelo WhatsApp. Roda num computador ou servidor Windows, com login para cada pessoa, e as propostas podem ser abertas pelo cliente num link.

## Como usar

1. Dê dois cliques em **`iniciar.bat`**. Ele instala o que faltar, inclusive o Node.js, e pode levar alguns minutos na primeira vez. Se o Windows pedir permissão, clique em Sim. Depois, o cotador abre sozinho no navegador.
2. Deixe a janela preta aberta enquanto usa o cotador. Para encerrar, feche essa janela.

Se o Node.js não puder ser instalado automaticamente, baixe a versão LTS em https://nodejs.org e abra o `iniciar.bat` de novo.

Em **Configurações > Meus dados**, preencha seu nome, telefone e corretora. Eles aparecem na imagem e na mensagem.

## Atualizar o sistema

Com o login de administrador, em **Configurações > Atualizar sistema**, clique em **Atualizar agora**. O cotador baixa a versão nova do GitHub e reinicia sozinho, desde que tenha sido aberto pelo `iniciar.bat`. Quando ele volta, a tela recarrega com a versão nova: o navegador sempre confere com o servidor as telas e os scripts, então não precisa limpar o cache.

## Login

Cada pessoa entra com o próprio login e, em **Configurações**, preenche os próprios dados e altera a própria senha. O administrador também vê usuários, backup e a atualização do sistema. As senhas ficam no banco só como hash. As páginas das propostas continuam abrindo sem login para o cliente.

Cada login é de uso individual: quando alguém entra com um login que já está em uso, o acesso anterior é encerrado na hora. Quem caiu volta para a tela de login, que explica o motivo.

O primeiro administrador é criado a partir do arquivo `.env`, que não vai para o GitHub:

```
LOGIN_USUARIO=seu_login
LOGIN_SENHA=sua_senha
```

Depois disso, a senha é alterada em **Configurações**, e mudar o `.env` não muda mais a senha.

Se o administrador esquecer a senha, coloque a nova senha em `LOGIN_SENHA`, acrescente `LOGIN_REDEFINIR_SENHA=1` ao `.env` e reinicie o cotador. Depois de entrar, apague a linha `LOGIN_REDEFINIR_SENHA`, senão a senha volta para a do `.env` a cada reinício.

### Acesso às telas

Em **Configurações > Usuários**, o administrador escolhe, para cada usuário e cada tela (Nova Cotação, Planos e Valores, Documentos, Histórico, Aceites e Contratos Vendidos), entre **Sem acesso**, **Visualização** e **Edição**. O administrador sempre tem acesso a tudo. Quem só visualiza a Nova Cotação pode simular, mas não envia nem salva.

No **Histórico**, cada usuário vê e altera só as próprias cotações, inclusive o administrador. O backup guarda as cotações de todos.

Usuários não são excluídos: o administrador **desativa** quem não deve mais entrar. O login fica bloqueado, e as cotações, os contratos vendidos e os documentos dos clientes continuam guardados. **Ativar** devolve o acesso com tudo como estava.

### Recuperar a senha por e-mail

Cada usuário tem um e-mail, e a tela de login oferece **Esqueci minha senha**. O link enviado vale por uma hora e uma única vez. Para funcionar, preencha os dados do servidor de e-mail no `.env` e reinicie o cotador:

```
SMTP_HOST=smtp.seu-provedor.com
SMTP_PORTA=587
SMTP_USUARIO=seu_usuario
SMTP_SENHA=sua_senha
SMTP_REMETENTE=cotador@seu-dominio.com
```

O endereço do link vem de `PUBLIC_URL`, que também precisa estar preenchido: sem ele, a recuperação fica desligada. Quem já existia antes desta função precisa preencher o e-mail em **Configurações > Meus dados**, ou pedir ao administrador.

## Links das propostas

As páginas das propostas ficam abertas para a internet na porta 9090. Execute o `iniciar.bat` como administrador na primeira vez, para ele liberar a porta no firewall do Windows, e preencha no `.env` o endereço público, como `PUBLIC_URL=http://IP_DA_MAQUINA:9090`. A tela do cotador também abre nessa porta, sempre com login. Use uma senha forte e, se possível, um domínio com HTTPS: sem HTTPS, a senha e os dados trafegam sem criptografia.

A mensagem enviada não traz link: vai o texto e a imagem da proposta. O botão **Copiar link** cria a página de cada plano escolhido, com o botão de aceite, e copia o endereço para você enviar ao cliente.

**Sem `PUBLIC_URL`, o link é local:** ele só abre no próprio computador do cotador, e o cliente não consegue abri-lo. A imagem da proposta mostra a mesma página do link, na tela de computador, com a primeira situação de carência. O botão de aceite e o seletor da imagem são só desenho: para aceitar ou trocar a situação, o cliente precisa do link.

A página guarda os valores do momento em que o link foi criado. Mudar o plano depois não altera o que já foi gerado.

### Aceite da proposta

A página da proposta tem o botão **Aceitar proposta**: o cliente escolhe a acomodação e confirma. Depois disso:

- A página avisa o cliente que ele receberá a lista de documentos necessários para a contratação, e oferece o botão **Falar com o corretor no WhatsApp**.
- O aceite aparece na tela **Aceites**. O botão **Pedir documentos no WhatsApp** mostra os documentos do plano: desmarque o que não quer pedir, e a conversa abre com a mensagem pronta e o link de envio.

### Envio de documentos pelo cliente

Depois de aceitar, o cliente vê na própria proposta o botão **Enviar documentos**. O endereço é o da proposta com `/documentos` no fim.

- **Login pelo telefone:** o cliente informa o número de WhatsApp da proposta, com DDD. Vale com ou sem o nono dígito. Se a proposta foi criada sem número, o primeiro telefone informado passa a ser o login dela. Cinco números errados bloqueiam a entrada por um minuto.
- **Envio aos poucos:** a página lista os documentos do plano aceito e aceita foto ou PDF de até 20 MB, vários por documento. Cada arquivo é guardado assim que chega: o cliente pode parar e voltar depois pelo mesmo link, em qualquer aparelho, informando o telefone. O acesso dura 30 dias em cada aparelho.
- **Fotos grandes:** são reduzidas no próprio celular antes de subir, para o envio ser rápido.
- **Concluir:** ao terminar, o cliente toca em **Concluir envio**. Ele pode concluir com documentos faltando e também reabrir para trocar ou acrescentar algum.
- **Para o corretor:** a tela **Aceites** mostra quantos documentos chegaram e, em **Documentos do cliente**, cada arquivo para abrir ou baixar. **Copiar link de envio** copia o endereço para mandar ao cliente.
- **Privacidade:** os arquivos ficam no banco de dados e entram no backup. Pela internet, o cliente vê só o nome dos arquivos que enviou e pode removê-los; o conteúdo só abre dentro do cotador, com login. Excluir o aceite apaga os documentos dele.

O aceite registra o interesse do cliente, mas não substitui a assinatura do contrato com a operadora.

## Documentos

Na tela **Documentos**, escolha o plano na lista para cadastrar ou excluir os documentos dele. Nos planos com várias opções (ex.: AMIL OURO 30%, 40%, MEI, PARCIAL), escolha em qual opção cadastrar. Marque os documentos que quer pedir e copie a mensagem pronta para o WhatsApp.

## Contratos Vendidos

Cadastre cada venda com o nome e o telefone do cliente, o plano contratado, o valor e a data de ativação. A partir da data de ativação, até você marcar **Contato feito**, o sistema avisa que é preciso falar com o cliente: um número na tela, uma faixa no topo e um aviso ao abrir o cotador. O botão **Mensagem no WhatsApp** abre um texto pronto, que pode ser editado antes de enviar.

Em **Documentos**, cada contrato guarda os arquivos que o cliente enviou (PDF, JPG, PNG ou WebP), sem limite de quantidade. As fotos são reduzidas antes do envio. Os arquivos ficam dentro do banco: entram no backup e não têm link público. Cada usuário vê só os contratos que cadastrou, inclusive o administrador. Excluir um contrato apaga também os documentos dele.

## Financeiro

O menu **Financeiro** tem dois itens. Quem não é administrador começa sem acesso: libere em **Configurações > Usuários**.

- **Regras de pagamento:** cadastre uma ou mais corretoras e, em cada uma, clique em **Nova regra**. Cada regra tem o segmento (Pessoa física ou PME), a operadora, escolhida entre os planos cadastrados no sistema (Pessoa física mostra os planos PF; PME, os planos CNPJ), a **angariação** e até 4 parcelas. A angariação é só para Pessoa física. Tudo em % sobre a mensalidade: a angariação é paga no ato da venda e as parcelas uma por mês, a 1ª no mês da ativação, a 2ª no mês seguinte e assim por diante. Campo em branco vale zero.
- **Comissões:** lista os contratos de Contratos Vendidos com a mensalidade cadastrada. Na calculadora de cada contrato, escolha a regra. O detalhamento mostra cada parcela prevista, com a data e o valor. Os cards mostram o total de vendas, a comissão prevista e os contratos sem regra, de acordo com os filtros.

Excluir uma regra ou uma corretora deixa sem regra os contratos que a usavam. Ao atualizar, as regras antigas (das tabelas importadas antes) que não são de um plano cadastrado são excluídas uma única vez.

### Publicação

Quando as páginas estiverem publicadas num domínio, coloque o endereço no `.env` e reinicie o cotador:

```
PUBLIC_URL=https://propostas.seudominio.com.br
```

Quem receber o link consegue ver o nome do cliente e os valores da proposta. Exponha na internet só a porta pública (9090): nela, as propostas abrem sem login, e a tela do cotador, o histórico e o backup sempre pedem login. A porta 3210 atende só o próprio computador.

## Leitura automática de tabelas (opcional)

Para o Claude ler o PDF ou a imagem de uma tabela nova, é preciso ter uma chave da API, criada em https://platform.claude.com. O uso da API é cobrado à parte.

1. Abra o arquivo **`.env`** na pasta do cotador com o Bloco de Notas. Ele é criado na primeira execução.
2. Coloque a chave depois do sinal de igual: `ANTHROPIC_API_KEY=sua-chave-aqui`
3. Salve o arquivo, feche a janela do cotador e abra o `iniciar.bat` de novo.

Sem a chave, todo o resto funciona normalmente, inclusive sem internet. Para atualizar valores, use o campo **Colar da planilha** no editor do plano.

## Backup

Os planos, o histórico, os contratos vendidos e os documentos dos clientes ficam em `dados\cotador.db`, e as imagens enviadas ficam em `dados\uploads`.

- **Configurações > Backup**: **Fazer backup** baixa um único arquivo com o banco e as imagens de `dados\uploads`, inclusive as fotos dos usuários. **Restaurar backup** troca os dados atuais pelos do arquivo e devolve as imagens dele. Antes de trocar, o cotador guarda uma cópia dos dados atuais em `backups`. Backups antigos, feitos sem as imagens, continuam funcionando e deixam as imagens atuais como estão.
- **`backup.bat`**: copia o banco e a pasta de imagens para `backups`, com data e hora no nome. Para voltar essa cópia, devolva os dois para a pasta `dados` com o cotador fechado.

## Para quem for mexer no código

```bash
npm install
```

```bash
npm test
```

As portas (`PORT`, padrão 3210, e `PORT_PUBLICA`, padrão 9090) e o modelo do Claude (`ANTHROPIC_MODEL`) ficam no `.env`. A porta pública é atendida por `server/publico.js` e só entrega as páginas das propostas.
