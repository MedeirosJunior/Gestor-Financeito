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
    fetchTransactions();
  }, []);

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
      </main>
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
  const monthName = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  return (
    <div className="dashboard">
      <h2>Dashboard - {monthName}</h2>
      
      <div className="cards">
        <div className="card entrada">
          <h3>💵 Total Entradas</h3>
          <p className="value">R$ {totalEntradas.toFixed(2)}</p>
        </div>
        
        <div className="card despesa">
          <h3>💸 Total Despesas</h3>
          <p className="value">R$ {totalDespesas.toFixed(2)}</p>
        </div>
        
        <div className={`card saldo ${saldo >= 0 ? 'positivo' : 'negativo'}`}>
          <h3>💰 Saldo</h3>
          <p className="value">R$ {saldo.toFixed(2)}</p>
        </div>
      </div>

      <div className="recent-transactions">
        <h3>Últimas Transações</h3>
        {monthlyTransactions.slice(-5).reverse().map(transaction => (
          <div key={transaction.id} className={`transaction-item ${transaction.type}`}>
            <span className="date">{new Date(transaction.date).toLocaleDateString('pt-BR')}</span>
            <span className="description">{transaction.description}</span>
            <span className="category">{transaction.category}</span>
            <span className="value">
              {transaction.type === 'entrada' ? '+' : '-'}R$ {parseFloat(transaction.value).toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Formulário para lançamentos
function LancamentoForm({ type, onAdd, title }) {
  const [form, setForm] = useState({
    type: type,
    description: '',
    value: '',
    date: new Date().toISOString().slice(0, 10),
    category: ''
  });

  const categories = {
    entrada: ['Salário', 'Freelance', 'Investimentos', 'Vendas', 'Outros'],
    despesa: ['Alimentação', 'Transporte', 'Moradia', 'Saúde', 'Educação', 'Lazer', 'Outros']
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.description || !form.value || !form.category) {
      alert('Preencha todos os campos obrigatórios');
      return;
    }
    
    onAdd({
      ...form,
      value: parseFloat(form.value)
    });
    
    setForm({
      type: type,
      description: '',
      value: '',
      date: new Date().toISOString().slice(0, 10),
      category: ''
    });
    
    alert(`${type === 'entrada' ? 'Entrada' : 'Despesa'} cadastrada com sucesso!`);
  };

  return (
    <div className="lancamento-form">
      <h2>{title}</h2>
      
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Descrição *</label>
          <input
            type="text"
            placeholder="Ex: Supermercado, Salário..."
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            required
          />
        </div>

        <div className="form-group">
          <label>Categoria *</label>
          <select
            value={form.category}
            onChange={e => setForm({ ...form, category: e.target.value })}
            required
          >
            <option value="">Selecione uma categoria</option>
            {categories[type].map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Valor *</label>
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="0,00"
            value={form.value}
            onChange={e => setForm({ ...form, value: e.target.value })}
            required
          />
        </div>

        <div className="form-group">
          <label>Data *</label>
          <input
            type="date"
            value={form.date}
            onChange={e => setForm({ ...form, date: e.target.value })}
            required
          />
        </div>

        <button type="submit" className="submit-btn">
          {type === 'entrada' ? '💵 Cadastrar Entrada' : '💸 Cadastrar Despesa'}
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
