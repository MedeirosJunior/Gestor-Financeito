import React, { useState, useEffect } from 'react';
import './App.css';
import config from './config';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);

  // Verificar autenticação no localStorage
  useEffect(() => {
    const authStatus = localStorage.getItem('isAuthenticated');
    const userData = localStorage.getItem('currentUser');
    if (authStatus === 'true' && userData) {
      setIsAuthenticated(true);
      setCurrentUser(JSON.parse(userData));
    }
  }, []);

  const fetchTransactions = async () => {
    if (!currentUser) return;
    
    setLoading(true);
    try {
      const response = await fetch(`${config.API_URL}/transactions?userId=${encodeURIComponent(currentUser.username)}`);
      const data = await response.json();
      setTransactions(data);
    } catch (error) {
      console.error('Erro ao buscar transações:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchTransactions();
    }
  }, [isAuthenticated]);

  const addTransaction = async (transaction) => {
    try {
      await fetch(`${config.API_URL}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transaction),
      });
      fetchTransactions();
    } catch (error) {
      console.error('Erro ao adicionar transação:', error);
    }
  };

  const deleteTransaction = async (id) => {
    try {
      await fetch(`${config.API_URL}/transactions/${id}`, {
        method: 'DELETE',
      });
      fetchTransactions();
    } catch (error) {
      console.error('Erro ao deletar transação:', error);
    }
  };

  const handleLogin = (user) => {
    setIsAuthenticated(true);
    setCurrentUser(user);
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setCurrentUser(null);
    localStorage.removeItem('isAuthenticated');
    localStorage.removeItem('currentUser');
    setActiveTab('dashboard');
  };

  // Se não estiver autenticado, mostrar tela de login
  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-top">
          <h1>💰 Gestor Financeiro</h1>
          <div className="user-info">
            <span>👤 {currentUser?.name || currentUser?.username}</span>
            {currentUser?.isAdmin && (
              <button 
                className={activeTab === 'usuarios' ? 'active' : ''} 
                onClick={() => setActiveTab('usuarios')}
                title="Gerenciar Usuários"
              >
                👥 Usuários
              </button>
            )}
            <button 
              className="logout-btn" 
              onClick={handleLogout}
              title="Sair"
            >
              🚪 Sair
            </button>
          </div>
        </div>
        <nav className="nav">
          <button 
            className={activeTab === 'dashboard' ? 'active' : ''} 
            onClick={() => setActiveTab('dashboard')}
          >
            📊 Dashboard
          </button>
          <button 
            className={activeTab === 'entradas' ? 'active' : ''} 
            onClick={() => setActiveTab('entradas')}
          >
            💵 Entradas
          </button>
          <button 
            className={activeTab === 'despesas' ? 'active' : ''} 
            onClick={() => setActiveTab('despesas')}
          >
            💸 Despesas
          </button>
          <button 
            className={activeTab === 'relatorios' ? 'active' : ''} 
            onClick={() => setActiveTab('relatorios')}
          >
            📈 Relatórios
          </button>
          <button 
            className={activeTab === 'historico' ? 'active' : ''} 
            onClick={() => setActiveTab('historico')}
          >
            📋 Histórico
          </button>
        </nav>
      </header>

      <main className="main">
        {loading && <div className="loading">Carregando...</div>}
        
        {activeTab === 'dashboard' && (
          <Dashboard transactions={transactions} />
        )}
        
        {activeTab === 'entradas' && (
          <LancamentoForm 
            type="entrada" 
            onAdd={addTransaction}
            title="💵 Lançar Entrada"
          />
        )}
        
        {activeTab === 'despesas' && (
          <LancamentoForm 
            type="despesa" 
            onAdd={addTransaction}
            title="💸 Lançar Despesa"
          />
        )}
        
        {activeTab === 'relatorios' && (
          <Relatorios transactions={transactions} />
        )}
        
        {activeTab === 'historico' && (
          <Historico 
            transactions={transactions} 
            onDelete={deleteTransaction}
          />
        )}
        
        {activeTab === 'usuarios' && currentUser?.isAdmin && (
          <GerenciarUsuarios />
        )}
      </main>
    </div>
  );
}

// Componente de Login
function Login({ onLogin }) {
  const [credentials, setCredentials] = useState({
    username: '',
    password: ''
  });

  // Carregar usuários do localStorage (fallback) e verificar API
  const getUsers = () => {
    // Primeiro tenta autenticar via API (método preferido)
    return [
      { 
        username: 'junior395@gmail.com', 
        password: 'j991343519*/*', 
        name: 'Administrador',
        isAdmin: true 
      }
    ];
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const users = getUsers();

    // Verificar login
    const user = users.find(user => 
      user.username === credentials.username && user.password === credentials.password
    );

    if (user) {
      onLogin(user);
      localStorage.setItem('isAuthenticated', 'true');
      localStorage.setItem('currentUser', JSON.stringify(user));
    } else {
      alert('Usuário ou senha incorretos!');
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h1>💰 Gestor Financeiro</h1>
        <h2>🔐 Login</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>👤 Email:</label>
            <input
              type="email"
              value={credentials.username}
              onChange={(e) => setCredentials({...credentials, username: e.target.value})}
              placeholder="Digite seu email"
              required
            />
          </div>
          <div className="form-group">
            <label>🔑 Senha:</label>
            <input
              type="password"
              value={credentials.password}
              onChange={(e) => setCredentials({...credentials, password: e.target.value})}
              placeholder="Digite sua senha"
              required
            />
          </div>
          <button type="submit" className="login-btn">
            Entrar
          </button>
        </form>
        
        <div className="login-info">
          <p><strong>Acesso restrito ao administrador</strong></p>
          <p>Entre em contato para obter credenciais</p>
        </div>
      </div>
    </div>
  );
}

// Componente para gerenciar usuários (apenas admin)
function GerenciarUsuarios() {
  const [users, setUsers] = useState([]);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
    name: '',
    isAdmin: false
  });

  // Carregar usuários
  const loadUsers = () => {
    const savedUsers = localStorage.getItem('financeiro_users');
    if (savedUsers) {
      setUsers(JSON.parse(savedUsers));
    }
  };

  // Salvar usuários
  const saveUsers = (updatedUsers) => {
    localStorage.setItem('financeiro_users', JSON.stringify(updatedUsers));
    setUsers(updatedUsers);
  };

  useEffect(() => {
    loadUsers();
  }, []);

  // Adicionar novo usuário
  const handleAddUser = (e) => {
    e.preventDefault();
    
    if (newUser.password.length < 4) {
      alert('A senha deve ter pelo menos 4 caracteres!');
      return;
    }

    // Verificar se usuário já existe
    const userExists = users.find(user => user.username === newUser.username);
    if (userExists) {
      alert('Usuário já existe!');
      return;
    }

    const updatedUsers = [...users, { ...newUser }];
    saveUsers(updatedUsers);
    setNewUser({ username: '', password: '', name: '', isAdmin: false });
    setIsAddingUser(false);
    alert('Usuário cadastrado com sucesso!');
  };

  // Remover usuário
  const handleRemoveUser = (username) => {
    if (username === 'junior395@gmail.com') {
      alert('Não é possível remover o administrador principal!');
      return;
    }

    if (window.confirm(`Deseja realmente remover o usuário ${username}?`)) {
      const updatedUsers = users.filter(user => user.username !== username);
      saveUsers(updatedUsers);
    }
  };

  return (
    <div className="usuarios-management">
      <h2>👥 Gerenciar Usuários</h2>
      
      <div className="users-actions">
        <button 
          onClick={() => setIsAddingUser(!isAddingUser)}
          className="add-user-btn"
        >
          {isAddingUser ? '❌ Cancelar' : '➕ Adicionar Usuário'}
        </button>
      </div>

      {isAddingUser && (
        <div className="add-user-form">
          <h3>Adicionar Novo Usuário</h3>
          <form onSubmit={handleAddUser}>
            <div className="form-group">
              <label>👤 Email:</label>
              <input
                type="email"
                value={newUser.username}
                onChange={(e) => setNewUser({...newUser, username: e.target.value})}
                required
              />
            </div>
            <div className="form-group">
              <label>👨‍💼 Nome:</label>
              <input
                type="text"
                value={newUser.name}
                onChange={(e) => setNewUser({...newUser, name: e.target.value})}
                required
              />
            </div>
            <div className="form-group">
              <label>🔑 Senha:</label>
              <input
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                required
                minLength="4"
              />
            </div>
            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={newUser.isAdmin}
                  onChange={(e) => setNewUser({...newUser, isAdmin: e.target.checked})}
                />
                👑 Administrador
              </label>
            </div>
            <button type="submit" className="submit-btn">Cadastrar</button>
          </form>
        </div>
      )}

      <div className="users-list">
        <h3>Usuários Cadastrados</h3>
        {users.map(user => (
          <div key={user.username} className="user-card">
            <div className="user-info">
              <h4>{user.name}</h4>
              <p>{user.username}</p>
              {user.isAdmin && <span className="admin-badge">👑 Admin</span>}
            </div>
            <div className="user-actions">
              {user.username !== 'junior395@gmail.com' && (
                <button 
                  onClick={() => handleRemoveUser(user.username)}
                  className="remove-btn"
                >
                  🗑️ Remover
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Dashboard com resumo financeiro
function Dashboard({ transactions }) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  
  const monthlyTransactions = transactions.filter(t => 
    t.date.startsWith(currentMonth)
  );
  
  const totalEntradas = monthlyTransactions
    .filter(t => t.type === 'entrada')
    .reduce((sum, t) => sum + parseFloat(t.value), 0);
    
  const totalDespesas = monthlyTransactions
    .filter(t => t.type === 'despesa')
    .reduce((sum, t) => sum + parseFloat(t.value), 0);
    
  const saldo = totalEntradas - totalDespesas;

  return (
    <div className="dashboard">
      <h2>📊 Dashboard - {new Date().toLocaleDateString('pt-BR', { year: 'numeric', month: 'long' })}</h2>
      
      <div className="cards">
        <div className="card entradas">
          <h3>💵 Entradas</h3>
          <p>R$ {totalEntradas.toFixed(2)}</p>
        </div>
        
        <div className="card despesas">
          <h3>💸 Despesas</h3>
          <p>R$ {totalDespesas.toFixed(2)}</p>
        </div>
        
        <div className={`card saldo ${saldo >= 0 ? 'positive' : 'negative'}`}>
          <h3>💰 Saldo</h3>
          <p>R$ {saldo.toFixed(2)}</p>
        </div>
      </div>

      <div className="recent-transactions">
        <h3>Últimas Transações</h3>
        {transactions.slice(-5).reverse().map(transaction => (
          <div key={transaction.id} className={`transaction-item ${transaction.type}`}>
            <span>{transaction.description}</span>
            <span>{transaction.type === 'entrada' ? '+' : '-'}R$ {parseFloat(transaction.value).toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Formulário de lançamento
function LancamentoForm({ type, onAdd, title }) {
  const [form, setForm] = useState({
    description: '',
    value: '',
    category: '',
    date: new Date().toISOString().slice(0, 10)
  });

  const categorias = type === 'entrada' 
    ? ['Salário', 'Freelance', 'Investimentos', 'Outros']
    : ['Alimentação', 'Transporte', 'Moradia', 'Saúde', 'Lazer', 'Outros'];

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.description || !form.value || !form.category) {
      alert('Preencha todos os campos!');
      return;
    }

    onAdd({
      ...form,
      type,
      value: parseFloat(form.value)
    });

    setForm({
      description: '',
      value: '',
      category: '',
      date: new Date().toISOString().slice(0, 10)
    });
  };

  return (
    <div className="lancamento-form">
      <h2>{title}</h2>
      
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Descrição:</label>
          <input
            type="text"
            value={form.description}
            onChange={e => setForm({...form, description: e.target.value})}
            placeholder="Ex: Salário, Supermercado..."
            required
          />
        </div>

        <div className="form-group">
          <label>Valor:</label>
          <input
            type="number"
            step="0.01"
            value={form.value}
            onChange={e => setForm({...form, value: e.target.value})}
            placeholder="0.00"
            required
          />
        </div>

        <div className="form-group">
          <label>Categoria:</label>
          <select
            value={form.category}
            onChange={e => setForm({...form, category: e.target.value})}
            required
          >
            <option value="">Selecione uma categoria</option>
            {categorias.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Data:</label>
          <input
            type="date"
            value={form.date}
            onChange={e => setForm({...form, date: e.target.value})}
            required
          />
        </div>

        <button type="submit" className="submit-btn">
          Lançar {type === 'entrada' ? 'Entrada' : 'Despesa'}
        </button>
      </form>
    </div>
  );
}

// Relatórios mensais
function Relatorios({ transactions }) {
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  
  const monthlyData = transactions.filter(t => 
    t.date.startsWith(selectedMonth)
  );

  const entradas = monthlyData.filter(t => t.type === 'entrada');
  const despesas = monthlyData.filter(t => t.type === 'despesa');
  
  const totalEntradas = entradas.reduce((sum, t) => sum + parseFloat(t.value), 0);
  const totalDespesas = despesas.reduce((sum, t) => sum + parseFloat(t.value), 0);
  
  const categoriesData = {};
  despesas.forEach(t => {
    categoriesData[t.category] = (categoriesData[t.category] || 0) + parseFloat(t.value);
  });

  // Função para exportar para Excel
  const exportToExcel = () => {
    const workbook = XLSX.utils.book_new();
    
    // Aba 1: Resumo do Mês
    const resumoData = [
      ['Resumo Financeiro', selectedMonth],
      [''],
      ['Tipo', 'Valor (R$)'],
      ['Entradas', totalEntradas.toFixed(2)],
      ['Despesas', totalDespesas.toFixed(2)],
      ['Saldo', (totalEntradas - totalDespesas).toFixed(2)]
    ];
    const resumoSheet = XLSX.utils.aoa_to_sheet(resumoData);
    XLSX.utils.book_append_sheet(workbook, resumoSheet, 'Resumo');

    // Aba 2: Transações Detalhadas
    const transacoesData = [
      ['Data', 'Descrição', 'Categoria', 'Tipo', 'Valor (R$)']
    ];
    monthlyData.forEach(t => {
      transacoesData.push([
        new Date(t.date).toLocaleDateString('pt-BR'),
        t.description,
        t.category,
        t.type === 'entrada' ? 'Entrada' : 'Despesa',
        parseFloat(t.value).toFixed(2)
      ]);
    });
    const transacoesSheet = XLSX.utils.aoa_to_sheet(transacoesData);
    XLSX.utils.book_append_sheet(workbook, transacoesSheet, 'Transações');

    // Aba 3: Gastos por Categoria
    const categoriasData = [
      ['Categoria', 'Valor (R$)', 'Percentual (%)']
    ];
    Object.entries(categoriesData).forEach(([category, value]) => {
      categoriasData.push([
        category,
        value.toFixed(2),
        ((value / totalDespesas) * 100).toFixed(1) + '%'
      ]);
    });
    const categoriasSheet = XLSX.utils.aoa_to_sheet(categoriasData);
    XLSX.utils.book_append_sheet(workbook, categoriasSheet, 'Categorias');

    // Salvar arquivo
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `relatorio-financeiro-${selectedMonth}.xlsx`);
  };

  // Função para exportar para CSV
  const exportToCSV = () => {
    const csvData = [
      ['Data', 'Descrição', 'Categoria', 'Tipo', 'Valor (R$)']
    ];
    monthlyData.forEach(t => {
      csvData.push([
        new Date(t.date).toLocaleDateString('pt-BR'),
        t.description,
        t.category,
        t.type === 'entrada' ? 'Entrada' : 'Despesa',
        parseFloat(t.value).toFixed(2)
      ]);
    });

    const csv = csvData.map(row => row.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `transacoes-${selectedMonth}.csv`);
  };

  return (
    <div className="relatorios">
      <h2>📈 Relatórios Mensais</h2>
      
      <div className="month-selector">
        <label>Selecionar Mês:</label>
        <input
          type="month"
          value={selectedMonth}
          onChange={e => setSelectedMonth(e.target.value)}
        />
      </div>

      <div className="export-buttons">
        <button onClick={exportToExcel} className="export-btn excel">
          📊 Exportar Excel
        </button>
        <button onClick={exportToCSV} className="export-btn csv">
          📄 Exportar CSV
        </button>
      </div>

      <div className="report-summary">
        <div className="summary-card">
          <h3>Resumo do Mês</h3>
          <p>💵 Entradas: R$ {totalEntradas.toFixed(2)}</p>
          <p>💸 Despesas: R$ {totalDespesas.toFixed(2)}</p>
          <p className={totalEntradas - totalDespesas >= 0 ? 'positive' : 'negative'}>
            💰 Saldo: R$ {(totalEntradas - totalDespesas).toFixed(2)}
          </p>
        </div>
      </div>

      <div className="categories-report">
        <h3>Gastos por Categoria</h3>
        {Object.entries(categoriesData).map(([category, value]) => (
          <div key={category} className="category-item">
            <span>{category}</span>
            <span>R$ {value.toFixed(2)}</span>
            <span>({((value / totalDespesas) * 100).toFixed(1)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Histórico de transações
function Historico({ transactions, onDelete }) {
  const [filter, setFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('');

  const filteredTransactions = transactions.filter(t => {
    const typeMatch = filter === 'all' || t.type === filter;
    const monthMatch = !monthFilter || t.date.startsWith(monthFilter);
    return typeMatch && monthMatch;
  }).reverse();

  // Função para exportar histórico para Excel
  const exportHistoricoToExcel = () => {
    const workbook = XLSX.utils.book_new();
    
    const historicoData = [
      ['Histórico de Transações'],
      [''],
      ['Data', 'Descrição', 'Categoria', 'Tipo', 'Valor (R$)']
    ];
    
    filteredTransactions.forEach(t => {
      historicoData.push([
        new Date(t.date).toLocaleDateString('pt-BR'),
        t.description,
        t.category,
        t.type === 'entrada' ? 'Entrada' : 'Despesa',
        parseFloat(t.value).toFixed(2)
      ]);
    });

    const sheet = XLSX.utils.aoa_to_sheet(historicoData);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Histórico');

    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    
    const filterText = filter === 'all' ? 'todas' : filter;
    const monthText = monthFilter ? `-${monthFilter}` : '';
    saveAs(blob, `historico-${filterText}${monthText}.xlsx`);
  };

  return (
    <div className="historico">
      <h2>📋 Histórico de Transações</h2>
      
      <div className="filters">
        <select value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">Todas</option>
          <option value="entrada">Entradas</option>
          <option value="despesa">Despesas</option>
        </select>
        
        <input
          type="month"
          value={monthFilter}
          onChange={e => setMonthFilter(e.target.value)}
          placeholder="Filtrar por mês"
        />
        
        <button onClick={exportHistoricoToExcel} className="export-btn excel">
          📊 Exportar
        </button>
      </div>

      <div className="transactions-list">
        {filteredTransactions.map(transaction => (
          <div key={transaction.id} className={`transaction-card ${transaction.type}`}>
            <div className="transaction-info">
              <h4>{transaction.description}</h4>
              <p>{transaction.category}</p>
              <span className="date">{new Date(transaction.date).toLocaleDateString('pt-BR')}</span>
            </div>
            <div className="transaction-value">
              <span className={`value ${transaction.type}`}>
                {transaction.type === 'entrada' ? '+' : '-'}R$ {parseFloat(transaction.value).toFixed(2)}
              </span>
              <button 
                onClick={() => {
                  if (window.confirm('Deseja realmente excluir esta transação?')) {
                    onDelete(transaction.id);
                  }
                }}
                className="delete-btn"
              >
                🗑️
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
