import React, { useState, useEffect } from 'react';
import './App.css';
import config from './config';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [loadingRecurring, setLoadingRecurring] = useState(false);
  const [loadingExport, setLoadingExport] = useState(false);
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [recurringExpenses, setRecurringExpenses] = useState([]);
  const [dueAlerts, setDueAlerts] = useState([]);

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
    setLoading(true);
    try {
      const response = await fetch(`${config.API_URL}/transactions`);
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
    setLoadingTransactions(true);
    try {
      await fetch(`${config.API_URL}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transaction),
      });
      fetchTransactions();
      toast.success(`${transaction.type === 'entrada' ? 'Receita' : 'Despesa'} adicionada com sucesso!`);
    } catch (error) {
      console.error('Erro ao adicionar transação:', error);
      toast.error('Erro ao adicionar transação. Tente novamente.');
    } finally {
      setLoadingTransactions(false);
    }
  };

  const deleteTransaction = async (id) => {
    setLoadingTransactions(true);
    try {
      await fetch(`${config.API_URL}/transactions/${id}`, {
        method: 'DELETE',
      });
      fetchTransactions();
      toast.success('Transação excluída com sucesso!');
    } catch (error) {
      console.error('Erro ao deletar transação:', error);
      toast.error('Erro ao excluir transação. Tente novamente.');
    } finally {
      setLoadingTransactions(false);
    }
  };

  const handleLogin = (user) => {
    setIsAuthenticated(true);
    setCurrentUser(user);
    toast.success(`Bem-vindo, ${user.name}!`);
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setCurrentUser(null);
    localStorage.removeItem('isAuthenticated');
    localStorage.removeItem('currentUser');
    setActiveTab('dashboard');
    toast.info('Logout realizado com sucesso!');
  };

  // Funções para despesas recorrentes
  const saveRecurringExpenses = (expenses) => {
    localStorage.setItem('recurringExpenses', JSON.stringify(expenses));
    setRecurringExpenses(expenses);
    checkDueExpenses(expenses);
  };

  const addRecurringExpense = (expense) => {
    setLoadingRecurring(true);
    try {
      const newExpense = {
        ...expense,
        id: Date.now(),
        createdAt: new Date().toISOString(),
        nextDue: calculateNextDue(expense.startDate, expense.recurrence)
      };
      const updated = [...recurringExpenses, newExpense];
      saveRecurringExpenses(updated);
      toast.success('Despesa recorrente adicionada com sucesso!');
    } catch (error) {
      console.error('Erro ao adicionar despesa recorrente:', error);
      toast.error('Erro ao adicionar despesa recorrente. Tente novamente.');
    } finally {
      setLoadingRecurring(false);
    }
  };

  const deleteRecurringExpense = (id) => {
    setLoadingRecurring(true);
    try {
      const updated = recurringExpenses.filter(expense => expense.id !== id);
      saveRecurringExpenses(updated);
      toast.success('Despesa recorrente excluída com sucesso!');
    } catch (error) {
      console.error('Erro ao excluir despesa recorrente:', error);
      toast.error('Erro ao excluir despesa recorrente. Tente novamente.');
    } finally {
      setLoadingRecurring(false);
    }
  };

  // Calcular próxima data de vencimento
  const calculateNextDue = (startDate, recurrence) => {
    const start = new Date(startDate);
    const today = new Date();
    let nextDue = new Date(start);

    while (nextDue <= today) {
      switch (recurrence) {
        case 'mensal':
          nextDue.setMonth(nextDue.getMonth() + 1);
          break;
        case 'bimestral':
          nextDue.setMonth(nextDue.getMonth() + 2);
          break;
        case 'trimestral':
          nextDue.setMonth(nextDue.getMonth() + 3);
          break;
        case 'semestral':
          nextDue.setMonth(nextDue.getMonth() + 6);
          break;
        case 'anual':
          nextDue.setFullYear(nextDue.getFullYear() + 1);
          break;
        case 'quinto-dia-util':
          nextDue = calculateFifthBusinessDay(nextDue);
          break;
        default:
          nextDue.setMonth(nextDue.getMonth() + 1);
      }
    }
    return nextDue.toISOString().split('T')[0];
  };

  // Calcular quinto dia útil do mês
  const calculateFifthBusinessDay = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    let businessDays = 0;
    let day = 1;
    
    while (businessDays < 5) {
      const currentDate = new Date(year, month, day);
      const dayOfWeek = currentDate.getDay();
      
      // Se não for sábado (6) nem domingo (0)
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        businessDays++;
      }
      
      if (businessDays < 5) {
        day++;
      }
    }
    
    let nextMonth = new Date(year, month + 1, day);
    return nextMonth;
  };

  // Verificar despesas vencendo
  const checkDueExpenses = (expenses) => {
    const today = new Date();
    const alerts = [];

    expenses.forEach(expense => {
      const dueDate = new Date(expense.nextDue);
      const diffTime = dueDate - today;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays <= 7 && diffDays >= 0) {
        alerts.push({
          ...expense,
          daysUntilDue: diffDays
        });
      } else if (diffDays < 0) {
        alerts.push({
          ...expense,
          daysUntilDue: diffDays,
          overdue: true
        });
      }
    });

    setDueAlerts(alerts);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isAuthenticated) {
      const saved = localStorage.getItem('recurringExpenses');
      if (saved) {
        const expenses = JSON.parse(saved);
        setRecurringExpenses(expenses);
        checkDueExpenses(expenses);
      }
    }
  }, [isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  // Se não estiver autenticado, mostrar tela de login
  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} loadingAuth={loadingAuth} setLoadingAuth={setLoadingAuth} />;
  }

  return (
    <div className="app">
      <LoadingOverlay 
        show={loadingTransactions} 
        message="Processando transação..." 
      />
      <LoadingOverlay 
        show={loadingRecurring} 
        message="Processando despesa recorrente..." 
      />
      
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
          <button 
            className={activeTab === 'recorrentes' ? 'active' : ''} 
            onClick={() => setActiveTab('recorrentes')}
          >
            🔄 Recorrentes
          </button>
        </nav>
      </header>

      <main className="main">
        {loading && <div className="loading">Carregando...</div>}
        
        {activeTab === 'dashboard' && (
          <Dashboard 
            transactions={transactions} 
            dueAlerts={dueAlerts}
          />
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
          <Relatorios 
            transactions={transactions} 
            loadingExport={loadingExport}
            setLoadingExport={setLoadingExport}
          />
        )}
        
        {activeTab === 'historico' && (
          <Historico 
            transactions={transactions} 
            onDelete={deleteTransaction}
          />
        )}
        
        {activeTab === 'recorrentes' && (
          <DespesasRecorrentes 
            expenses={recurringExpenses}
            onAdd={addRecurringExpense}
            onDelete={deleteRecurringExpense}
          />
        )}
        
        {activeTab === 'usuarios' && currentUser?.isAdmin && (
          <GerenciarUsuarios />
        )}
      </main>
    </div>
  );
}

// Componentes de Loading
function Spinner({ size = '20px', color = '#007bff' }) {
  return (
    <div 
      className="spinner"
      style={{
        width: size,
        height: size,
        borderColor: `${color}33`,
        borderTopColor: color
      }}
    />
  );
}

function ButtonSpinner({ loading, children, onClick, className = '', disabled = false, ...props }) {
  return (
    <button
      className={`${className} ${loading ? 'loading' : ''}`}
      onClick={onClick}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <>
          <Spinner size="16px" color="currentColor" />
          <span style={{ marginLeft: '8px' }}>Carregando...</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

function LoadingOverlay({ show, message = 'Carregando...' }) {
  if (!show) return null;
  
  return (
    <div className="loading-overlay">
      <div className="loading-content">
        <Spinner size="40px" />
        <span>{message}</span>
      </div>
    </div>
  );
}

// Componente de Login
function Login({ onLogin, loadingAuth, setLoadingAuth }) {
  const [credentials, setCredentials] = useState({
    username: '',
    password: ''
  });

  // Carregar usuários do localStorage
  const getUsers = () => {
    const users = localStorage.getItem('financeiro_users');
    return users ? JSON.parse(users) : [
      { 
        username: 'junior395@gmail.com', 
        password: 'j92953793*/*', 
        name: 'Administrador',
        isAdmin: true 
      }
    ];
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setLoadingAuth(true);
    
    try {
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
        toast.error('Usuário ou senha incorretos!');
      }
    } catch (error) {
      console.error('Erro no login:', error);
      toast.error('Erro no login. Tente novamente.');
    } finally {
      setLoadingAuth(false);
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
          <ButtonSpinner 
            type="submit" 
            className="login-btn" 
            loading={loadingAuth}
          >
            Entrar
          </ButtonSpinner>
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
function Dashboard({ transactions, dueAlerts }) {
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

      {/* Alertas de Vencimento */}
      {dueAlerts.length > 0 && (
        <div className="due-alerts">
          <h3>⚠️ Alertas de Vencimento</h3>
          {dueAlerts.map(alert => (
            <div key={alert.id} className={`alert-item ${alert.status}`}>
              <div className="alert-info">
                <span className="alert-description">{alert.description}</span>
                <span className="alert-value">R$ {parseFloat(alert.value).toFixed(2)}</span>
              </div>
              <div className="alert-date">
                <span className={`alert-status ${alert.status}`}>
                  {alert.status === 'overdue' ? '🔴 Vencida' : '🟡 Vence em breve'}
                </span>
                <span className="alert-due-date">{alert.dueDate}</span>
              </div>
            </div>
          ))}
        </div>
      )}

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

// Componente de Despesas Recorrentes
function DespesasRecorrentes({ expenses, onAdd, onDelete }) {
  const [form, setForm] = useState({
    description: '',
    value: '',
    category: '',
    recurrence: 'monthly',
    startDate: new Date().toISOString().slice(0, 10)
  });

  const recurrenceOptions = [
    { value: 'monthly', label: 'Mensal' },
    { value: 'bimonthly', label: 'Bimestral' },
    { value: 'quarterly', label: 'Trimestral' },
    { value: 'semiannual', label: 'Semestral' },
    { value: 'annual', label: 'Anual' },
    { value: 'fifth-business-day', label: 'Quinto Dia Útil' }
  ];

  const categorias = ['Alimentação', 'Transporte', 'Moradia', 'Saúde', 'Lazer', 'Outros'];

  const handleSubmit = (e) => {
    e.preventDefault();
    if (form.description && form.value && form.category) {
      if (parseFloat(form.value) <= 0) {
        toast.error('O valor deve ser maior que zero!');
        return;
      }
      onAdd({
        ...form,
        value: parseFloat(form.value),
        id: Date.now(),
        created: new Date().toISOString()
      });
      setForm({
        description: '',
        value: '',
        category: '',
        recurrence: 'monthly',
        startDate: new Date().toISOString().slice(0, 10)
      });
    } else {
      toast.error('Preencha todos os campos obrigatórios!');
    }
  };

  const formatRecurrence = (recurrence) => {
    const option = recurrenceOptions.find(opt => opt.value === recurrence);
    return option ? option.label : recurrence;
  };

  return (
    <div className="recurring-expenses">
      <h2>🔄 Despesas Recorrentes</h2>
      
      <form onSubmit={handleSubmit} className="recurring-form">
        <div className="form-grid">
          <input
            type="text"
            placeholder="Descrição"
            value={form.description}
            onChange={(e) => setForm({...form, description: e.target.value})}
            required
          />
          
          <input
            type="number"
            step="0.01"
            placeholder="Valor"
            value={form.value}
            onChange={(e) => setForm({...form, value: e.target.value})}
            required
          />
          
          <select
            value={form.category}
            onChange={(e) => setForm({...form, category: e.target.value})}
            required
          >
            <option value="">Categoria</option>
            {categorias.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          
          <select
            value={form.recurrence}
            onChange={(e) => setForm({...form, recurrence: e.target.value})}
            required
          >
            {recurrenceOptions.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          
          <input
            type="date"
            value={form.startDate}
            onChange={(e) => setForm({...form, startDate: e.target.value})}
            required
          />
          
          <button type="submit">Adicionar Recorrente</button>
        </div>
      </form>

      <div className="recurring-list">
        <h3>Despesas Cadastradas</h3>
        {expenses.length === 0 ? (
          <p className="empty-message">Nenhuma despesa recorrente cadastrada</p>
        ) : (
          expenses.map(expense => (
            <div key={expense.id} className="recurring-item">
              <div className="recurring-info">
                <h4>{expense.description}</h4>
                <p className="recurring-details">
                  <span className="category">{expense.category}</span>
                  <span className="recurrence">{formatRecurrence(expense.recurrence)}</span>
                </p>
              </div>
              <div className="recurring-actions">
                <span className="recurring-value">R$ {parseFloat(expense.value).toFixed(2)}</span>
                <button
                  className="delete-btn"
                  onClick={() => onDelete(expense.id)}
                  title="Excluir"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))
        )}
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
      toast.error('Preencha todos os campos obrigatórios!');
      return;
    }

    if (parseFloat(form.value) <= 0) {
      toast.error('O valor deve ser maior que zero!');
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
function Relatorios({ transactions, loadingExport, setLoadingExport }) {
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
  const exportToExcel = async () => {
    setLoadingExport(true);
    try {
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
    toast.success('Relatório Excel exportado com sucesso!');
    } catch (error) {
      console.error('Erro ao exportar Excel:', error);
      toast.error('Erro ao exportar relatório Excel. Tente novamente.');
    } finally {
      setLoadingExport(false);
    }
  };

  // Função para exportar para CSV
  const exportToCSV = async () => {
    setLoadingExport(true);
    try {
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
    toast.success('Relatório CSV exportado com sucesso!');
    } catch (error) {
      console.error('Erro ao exportar CSV:', error);
      toast.error('Erro ao exportar relatório CSV. Tente novamente.');
    } finally {
      setLoadingExport(false);
    }
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
        <ButtonSpinner 
          onClick={exportToExcel} 
          className="export-btn excel" 
          loading={loadingExport}
        >
          📊 Exportar Excel
        </ButtonSpinner>
        <ButtonSpinner 
          onClick={exportToCSV} 
          className="export-btn csv" 
          loading={loadingExport}
        >
          📄 Exportar CSV
        </ButtonSpinner>
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
      
      {/* Container de Notificações Toast */}
      <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="light"
      />
    </div>
  );
}

export default App;
