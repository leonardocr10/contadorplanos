# Cotador de Planos

Monta cotações por faixa etária e gera uma imagem de proposta por plano para enviar pelo WhatsApp. Roda só no seu computador.

## Como usar

1. Dê dois cliques em **`iniciar.bat`**. Ele instala o que faltar, inclusive o Node.js, e pode levar alguns minutos na primeira vez. Se o Windows pedir permissão, clique em Sim. Depois, o cotador abre sozinho no navegador.
2. Deixe a janela preta aberta enquanto usa o cotador. Para encerrar, feche essa janela.

Se o Node.js não puder ser instalado automaticamente, baixe a versão LTS em https://nodejs.org e abra o `iniciar.bat` de novo.

Na aba **Meus dados**, preencha seu nome, telefone e corretora. Eles aparecem na imagem e na mensagem.

## Atualizar o sistema

Com o login de administrador, na aba **Configurações**, clique em **Atualizar agora**. O cotador baixa a versão nova do GitHub e reinicia sozinho, desde que tenha sido aberto pelo `iniciar.bat`.

## Login

Cada pessoa entra com o próprio login e, em **Configurações**, preenche os próprios dados e altera a própria senha. O administrador também vê usuários, backup e a atualização do sistema. As senhas ficam no banco só como hash. As páginas das propostas continuam abrindo sem login para o cliente.

O primeiro administrador é criado a partir do arquivo `.env`, que não vai para o GitHub:

```
LOGIN_USUARIO=seu_login
LOGIN_SENHA=sua_senha
```

Depois disso, a senha é alterada em **Configurações**, e mudar o `.env` não muda mais a senha.

Se o administrador esquecer a senha, coloque a nova senha em `LOGIN_SENHA`, acrescente `LOGIN_REDEFINIR_SENHA=1` ao `.env` e reinicie o cotador. Depois de entrar, apague a linha `LOGIN_REDEFINIR_SENHA`, senão a senha volta para a do `.env` a cada reinício.

### Acesso às telas

Em **Configurações > Usuários**, o administrador escolhe, para cada usuário e cada tela (Nova cotação, Planos e valores, Documentos, Histórico e Aceites), entre **Sem acesso**, **Visualização** e **Edição**. O administrador sempre tem acesso a tudo. Quem só visualiza a Nova cotação pode simular, mas não envia nem salva.

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

**Por enquanto, o link é local:** ele só abre neste computador, com o cotador ligado, e o cliente não consegue abri-lo. Até ter o domínio, envie também a imagem da proposta. A imagem mostra a mesma página do link, na tela de computador, com a primeira situação de carência. O botão de aceite e o seletor da imagem são só desenho: para aceitar ou trocar a situação, o cliente precisa do link.

A página guarda os valores do momento em que o link foi criado. Mudar o plano depois não altera o que já foi gerado.

### Aceite da proposta

A página da proposta tem o botão **Aceitar proposta**: o cliente escolhe a acomodação e confirma. Depois disso:

- A página avisa o cliente que ele receberá a lista de documentos necessários para a contratação, e oferece o botão **Falar com o corretor no WhatsApp**.
- O aceite aparece na aba **Aceites**. O botão **Enviar documentos no WhatsApp** mostra os documentos ativos do plano: desmarque o que não quer pedir, e a conversa abre com a mensagem pronta. Na aba **Documentos**, cadastre cada documento e escolha em quais planos ele fica ativo. Um plano novo começa sem documentos ativos.

O aceite registra o interesse do cliente, mas não substitui a assinatura do contrato com a operadora.

### Publicação

Quando as páginas estiverem publicadas num domínio, coloque o endereço no `.env` e reinicie o cotador:

```
PUBLIC_URL=https://propostas.seudominio.com.br
```

Quem receber o link consegue ver o nome do cliente e os valores da proposta. Na publicação, exponha só a porta pública: o cotador, o histórico e o backup não têm senha.

## Leitura automática de tabelas (opcional)

Para o Claude ler o PDF ou a imagem de uma tabela nova, é preciso ter uma chave da API, criada em https://platform.claude.com. O uso da API é cobrado à parte.

1. Abra o arquivo **`.env`** na pasta do cotador com o Bloco de Notas. Ele é criado na primeira execução.
2. Coloque a chave depois do sinal de igual: `ANTHROPIC_API_KEY=sua-chave-aqui`
3. Salve o arquivo, feche a janela do cotador e abra o `iniciar.bat` de novo.

Sem a chave, todo o resto funciona normalmente, inclusive sem internet. Para atualizar valores, use o campo **Colar da planilha** no editor do plano.

## Backup

Seus planos e seu histórico ficam em `dados\cotador.db`, e as imagens enviadas ficam em `dados\uploads`.

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
