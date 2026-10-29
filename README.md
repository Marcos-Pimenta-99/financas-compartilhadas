# Finanças Compartilhadas

Interface web responsiva para controle financeiro individual, com
compartilhamento opcional por grupos ou famílias, tema escuro em azul-cobalto
e modo claro.

## Funcionalidades desta versão

- Cadastro de novos usuários diretamente na tela de entrada.
- Dashboard individual por padrão.
- Visões separadas para espaço pessoal, grupo selecionado ou família selecionada.
- Navegação entre lançamentos, contas, cartões, grupos, família e relatórios.
- Contas e cartões pertencem exclusivamente ao usuário que os criou.
- Cadastro, edição e exclusão de contas e cartões.
- Dados de outra pessoa nunca aparecem na visão pessoal.
- Modo família com convite que precisa ser aceito.
- Compartilhamento seletivo de cada conta, cartão e lançamento com uma família.
- Entrar numa família não compartilha automaticamente nenhum dado.
- Bancos Nubank, Mercado Pago, Itaú e Sicoob.
- Cartões com fechamento e vencimento individuais.
- Cadastro manual de receitas e despesas.
- Lançamentos pessoais ou destinados a um grupo específico.
- Edição e exclusão de qualquer lançamento próprio.
- Pagamentos e recebimentos fixos, gerados automaticamente todo mês.
- Pausa e exclusão de regras fixas sem apagar as ocorrências já registradas.
- Divisão igual de despesas entre todos ou somente os participantes marcados.
- Categoria, conta ou cartão digitáveis, além das sugestões prontas.
- Configuração das categorias compartilhadas.
- Criação de vários grupos e convites que precisam ser aceitos pelos participantes.
- Tema claro e escuro.
- Layout responsivo para computador e celular.
- Perfil com alteração de nome, usuário e senha.
- Botões para mostrar ou ocultar a senha durante a digitação.
- Filtro entre meus lançamentos, lançamentos do grupo, família e visão completa.
- Edição do nome do grupo.
- Inclusão e remoção de participantes.
- Exclusão segura do grupo sem apagar os lançamentos pessoais.
- Criação e exclusão de grupos a qualquer momento.
- Preservação dos lançamentos pessoais quando um grupo é apagado.

## Estrutura do projeto

O pacote foi simplificado para uso local:

- `src/`: interface React.
- `backend/`: API FastAPI e banco SQLite.
- `dados/`: criada automaticamente para armazenar o banco.
- `backups/`: criada automaticamente para os backups diários.
- `iniciar.py`: inicialização conjunta do frontend e backend.

## Instalação pelo terminal do VS Code

Requisitos:

- Node.js 22 ou superior.
- npm.

No terminal PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
npm install
```

## Executar tudo junto pelo VS Code

Depois da instalação, use apenas:

```powershell
.\.venv\Scripts\Activate.ps1
python iniciar.py
```

Esse comando inicia o backend e o frontend, abre o navegador e mantém os dois
processos juntos. Para encerrar, pressione `Ctrl+C`.

## Executar separadamente (opcional)

Terminal 1:

```powershell
.\.venv\Scripts\Activate.ps1
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Terminal 2:

```powershell
npm run dev -- --host 0.0.0.0
```

O navegador abrirá em `http://localhost:5173`. Para acessar em outro aparelho
na mesma rede, use `http://IP-DO-COMPUTADOR:5173`.

## Primeiro acesso

Na primeira execução, abra a tela de entrada e clique em **Criar conta**. Cada
pessoa deve criar o próprio usuário. Um usuário novo começa sem contas,
cartões, grupos ou acesso a dados de terceiros.

Caso precise redefinir uma senha diretamente no computador principal:

```powershell
.\.venv\Scripts\Activate.ps1
python trocar_senha.py
```

## Armazenamento e backup

Todos os usuários, sessões e lançamentos ficam em:

```text
dados/financas.db
```

Para fazer backup com o sistema fechado, copie esse arquivo para um local
seguro. Para restaurar, substitua o arquivo pelo backup.

O sistema também cria automaticamente um backup diário na pasta `backups` e
mantém os últimos 30 arquivos.

## Regras de privacidade

- Contas, cartões e lançamentos são privados por padrão.
- Grupos mostram somente lançamentos criados para aquele grupo.
- Família mostra apenas itens compartilhados explicitamente pelo proprietário.
- Entrar em um grupo ou família nunca libera automaticamente os dados pessoais.
