# 💰 Gestor Financeiro

Sistema completo de gestão financeira pessoal desenvolvido com React e Node.js.

## 🌐 Demo Online

**Acesse o sistema em produção**: https://gestor-financeito.onrender.com

### Credenciais de Teste:
- **Email**: admin@gestor.com
- **Senha**: j92953793*/*

## 🚀 Funcionalidades

- **Dashboard Interativo**: Visão geral das finanças mensais
- **Lançamento de Entradas**: Cadastro de receitas por categoria
- **Lançamento de Despesas**: Controle de gastos organizados
- **Relatórios Mensais**: Análise detalhada com gráficos
- **Exportação Excel**: Relatórios exportáveis em CSV
- **Sistema de Usuários**: Controle de acesso e perfis
- **Painel Administrativo**: Gestão completa do sistema

## 🛠️ Tecnologias Utilizadas

### Frontend
- React 18
- CSS3 com design responsivo
- Fetch API para requisições

### Backend
- Node.js
- Express.js
- SQLite3
- CORS

## 📦 Instalação

1. **Clone o repositório**:
```bash
git clone https://github.com/MedeirosJunior/Gestor-Financeito.git
cd Gestor-Financeito
```

2. **Instale as dependências do backend**:
```bash
npm install
```

3. **Instale as dependências do frontend**:
```bash
cd gestor-financeiro-frontend
npm install
cd ..
```

4. **Execute o projeto**:
```bash
npm run dev
```

O sistema estará disponível em:
- Frontend: http://localhost:3000
- Backend: http://localhost:3001

## 👤 Acesso Administrativo

O sistema cria automaticamente um usuário administrador com as credenciais mostradas acima.

## 📱 Funcionalidades Detalhadas

### Dashboard
- Resumo financeiro mensal
- Saldo atual (entradas - despesas)
- Últimas transações registradas
- Indicadores visuais de performance

### Lançamentos
- **Entradas**: Salário, Freelance, Investimentos, Vendas, Outros
- **Despesas**: Alimentação, Transporte, Moradia, Saúde, Educação, Lazer, Outros
- Validação de campos obrigatórios
- Data automática (editável)

### Relatórios
- Filtro por mês/ano
- Análise por categorias
- Percentuais de gastos
- Exportação para Excel/CSV

### Administração
- Cadastro de novos usuários
- Controle de perfis (Admin/Usuário)
- Estatísticas gerais do sistema
- Visualização de todas as transações

## 🔒 Segurança

- Transações isoladas por usuário
- Verificação de propriedade antes de operações
- Controle de acesso baseado em perfis
- Proteção contra exclusão de administradores

## 📊 Estrutura do Banco de Dados

### Tabela Users
- id, name, email, password, role, created_at

### Tabela Transactions
- id, type, description, category, value, date, userId, created_at

## 🤝 Contribuição

1. Faça um fork do projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📝 Licença

Este projeto está sob a licença MIT. Veja o arquivo `LICENSE` para mais detalhes.

## 👨‍💻 Autor

MedeirosJunior
- GitHub: [@MedeirosJunior](https://github.com/MedeirosJunior)
- Projeto: [Gestor-Financeito](https://github.com/MedeirosJunior/Gestor-Financeito)

## 🎯 Próximas Funcionalidades

- [ ] Gráficos interativos
- [ ] Notificações de gastos
- [ ] Metas financeiras
- [ ] Backup automático
- [ ] App mobile
- [ ] Integração bancária

## 🚀 Deploy

O sistema está hospedado no Render.com:
- **URL**: https://gestor-financeito.onrender.com
- **Backend**: Node.js + Express
- **Frontend**: React (servido como arquivos estáticos)
- **Banco**: SQLite

### Deploy Automático
O projeto está configurado para deploy automático via GitHub:
1. Push para a branch `main`
2. Render detecta mudanças
3. Executa build automaticamente
4. Atualiza a aplicação
