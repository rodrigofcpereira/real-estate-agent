# LF Imóveis

Aplicativo web de gestão de contratos imobiliários.

## Como usar

1. Abra o arquivo `index.html` diretamente no navegador **ou** use a extensão *Live Server* no VS Code.

## Funcionalidades

| Função | Descrição |
|---|---|
| **Pesquisar** | Filtra a tabela por qualquer campo em tempo real |
| **Atualizar dados** | Recarrega os dados (planilha ou exemplo) |
| **Aniversáriante** | Envia mensagem de parabéns via WhatsApp |
| **Contratos vencidos** | Envia aviso de renovação via WhatsApp |
| **Ano novo** | Envia saudação de ano novo para todos |
| **Filtrar por contratos vencidos** | Exibe somente contratos expirados |
| **Filtrar por Aniversáriante** | Exibe somente quem faz aniversário hoje |
| **Email / WhatsApp** | Envia relatório de vencidos por e-mail ou WhatsApp |

## Conectar à sua planilha Google Sheets

1. Abra sua planilha no Google Sheets.
2. **Arquivo → Compartilhar → Publicar na web** → selecione a aba → formato **CSV** → clique em *Publicar*.
3. Copie a URL gerada.
4. Em `app.js`, altere:
   ```js
   const USE_SHEETS = true;
   const SHEETS_CSV_URL = "COLE_A_URL_AQUI";
   ```
5. A planilha deve ter exatamente esta ordem de colunas:
   ```
   nome | telefone | apartamento | nascimento | inicioContrato | terminoContrato | condominio
   ```

## Estrutura do projeto

```
corretor/
├── index.html   ← estrutura da página
├── style.css    ← estilos visuais
├── app.js       ← lógica e dados
└── README.md
```
