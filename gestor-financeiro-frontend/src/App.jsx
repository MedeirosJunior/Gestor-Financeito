import React, { useState, useEffect, useCallback, useMemo, Suspense, lazy } from 'react';
import './App.css';
import config from './config';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

// Componente de Loading para Suspense
const SuspenseLoader = ({ message = "Carregando..." }) => (
  <div className="suspense-loader">
    <div className="loading-spinner large"></div>
    <p>{message}</p>
  </div>
);

// Hook personalizado para debounce
const useDebounce = (value, delay) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};

// Funções de Validação
const ValidationUtils = {
  // Validar se é um número válido e positivo
  isValidPositiveNumber: (value) => {
    const num = parseFloat(value);
    return !isNaN(num) && num > 0 && isFinite(num);
  },

  // Validar se string não está vazia
  isNotEmpty: (value) => {
    return typeof value === 'string' && value.trim().length > 0;
  },

  // Validar formato de data
  isValidDate: (dateString) => {
    if (!dateString) return false;
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date) && dateString.length === 10;
  },

  // Validar se data não é futura demais (máximo 1 ano no futuro)
  isReasonableDate: (dateString) => {
    if (!ValidationUtils.isValidDate(dateString)) return false;
    const date = new Date(dateString);
    const now = new Date();
    const oneYearFromNow = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    return date <= oneYearFromNow;
  },

  // Validar valor monetário (máximo 1 milhão)
  isReasonableAmount: (value) => {
    const num = parseFloat(value);
    return ValidationUtils.isValidPositiveNumber(value) && num <= 1000000;
  },

  // Validar descrição (máximo 100 caracteres)
  isValidDescription: (description) => {
    return ValidationUtils.isNotEmpty(description) && description.trim().length <= 100;
  },

  // Validar categoria
  isValidCategory: (category, validCategories) => {
    return ValidationUtils.isNotEmpty(category) && validCategories.includes(category);
  },

  // Sanitizar entrada de texto
  sanitizeText: (text) => {
    if (typeof text !== 'string') return '';
    return text.trim().slice(0, 100);
  },

  // Validar credenciais de login
  isValidCredentials: (username, password) => {
    return ValidationUtils.isNotEmpty(username) && 
           ValidationUtils.isNotEmpty(password) && 
           username.length >= 3 && 
           password.length >= 3;
  }
};

// Função para tratamento de erros
const ErrorHandler = {
  // Tratar erros de API
  handleApiError: (error, operation = 'operação') => {
    console.error(`Erro na ${operation}:`, error);
    
    if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
      toast.error('Erro de conexão. Verifique sua internet e tente novamente.');
      return;
    }
    
    if (error.status) {
      switch (error.status) {
        case 400:
          toast.error('Dados inválidos. Verifique as informações e tente novamente.');
          break;
        case 401:
          toast.error('Não autorizado. Faça login novamente.');
          break;
        case 403:
          toast.error('Acesso negado. Você não tem permissão para esta ação.');
          break;
        case 404:
          toast.error('Recurso não encontrado.');
          break;
        case 500:
          toast.error('Erro interno do servidor. Tente novamente mais tarde.');
          break;
        default:
          toast.error(`Erro ${error.status}: ${operation} falhou.`);
      }
    } else {
      toast.error(`Erro inesperado durante ${operation}. Tente novamente.`);
    }
  },

  // Tratar erros de localStorage
  handleStorageError: (error, operation = 'salvar dados') => {
    console.error(`Erro de armazenamento ao ${operation}:`, error);
    
    if (error.name === 'QuotaExceededError') {
      toast.error('Espaço de armazenamento esgotado. Limpe alguns dados antigos.');
    } else {
      toast.error(`Erro ao ${operation}. Tente recarregar a página.`);
    }
  }
};

// Sistema de Categorias Personalizadas
const CategoryManager = {
  // Categorias padrão do sistema
  defaultCategories: {
    entrada: [
      { id: 'sal', name: 'Salário', icon: '💼', color: '#10b981' },
      { id: 'free', name: 'Freelance', icon: '💻', color: '#3b82f6' },
      { id: 'inv', name: 'Investimentos', icon: '📈', color: '#8b5cf6' },
      { id: 'out-ent', name: 'Outros', icon: '💰', color: '#6b7280' }
    ],
    despesa: [
      { id: 'alim', name: 'Alimentação', icon: '🍽️', color: '#ef4444' },
      { id: 'trans', name: 'Transporte', icon: '🚗', color: '#f59e0b' },
      { id: 'mor', name: 'Moradia', icon: '🏠', color: '#06b6d4' },
      { id: 'sau', name: 'Saúde', icon: '⚕️', color: '#84cc16' },
      { id: 'laz', name: 'Lazer', icon: '🎮', color: '#ec4899' },
      { id: 'out-desp', name: 'Outros', icon: '💸', color: '#6b7280' }
    ]
  },

  // Ícones disponíveis para seleção
  availableIcons: [
    '💼', '💻', '📈', '💰', '🏆', '🎯', '💎', '🔥',
    '🍽️', '🚗', '🏠', '⚕️', '🎮', '💸', '📚', '👕',
    '🎬', '✈️', '🏋️', '🎨', '🔧', '📱', '💊', '🎪',
    '🛒', '⛽', '💡', '🧾', '🎵', '📺', '🎈', '🌟'
  ],

  // Cores disponíveis para seleção
  availableColors: [
    '#ef4444', '#f59e0b', '#84cc16', '#10b981', '#06b6d4',
    '#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e', '#6b7280'
  ],

  // Carregar categorias do localStorage
  loadCategories: () => {
    try {
      const saved = localStorage.getItem('customCategories');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          entrada: [...CategoryManager.defaultCategories.entrada, ...(parsed.entrada || [])],
          despesa: [...CategoryManager.defaultCategories.despesa, ...(parsed.despesa || [])]
        };
      }
      return CategoryManager.defaultCategories;
    } catch (error) {
      console.error('Erro ao carregar categorias:', error);
      return CategoryManager.defaultCategories;
    }
  },

  // Salvar categorias customizadas (apenas as personalizadas)
  saveCustomCategories: (customCategories) => {
    try {
      localStorage.setItem('customCategories', JSON.stringify(customCategories));
      return true;
    } catch (error) {
      ErrorHandler.handleStorageError(error, 'salvar categorias');
      return false;
    }
  },

  // Obter apenas categorias customizadas
  getCustomCategories: () => {
    try {
      const saved = localStorage.getItem('customCategories');
      return saved ? JSON.parse(saved) : { entrada: [], despesa: [] };
    } catch (error) {
      console.error('Erro ao obter categorias customizadas:', error);
      return { entrada: [], despesa: [] };
    }
  },

  // Validar dados da categoria
  validateCategory: (category) => {
    if (!ValidationUtils.isNotEmpty(category.name)) {
      return { valid: false, error: 'Nome da categoria é obrigatório' };
    }
    
    if (category.name.length > 30) {
      return { valid: false, error: 'Nome deve ter no máximo 30 caracteres' };
    }

    if (!category.icon || !CategoryManager.availableIcons.includes(category.icon)) {
      return { valid: false, error: 'Ícone inválido selecionado' };
    }

    if (!category.color || !CategoryManager.availableColors.includes(category.color)) {
      return { valid: false, error: 'Cor inválida selecionada' };
    }

    return { valid: true };
  },

  // Verificar se categoria já existe
  categoryExists: (name, type, excludeId = null) => {
    const categories = CategoryManager.loadCategories();
    return categories[type].some(cat => 
      cat.name.toLowerCase() === name.toLowerCase() && cat.id !== excludeId
    );
  },

  // Gerar ID único para nova categoria
  generateId: () => {
    return 'custom_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }
};

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
  
  // Estado para categorias personalizadas
  const [categories, setCategories] = useState(CategoryManager.defaultCategories);
  const [customCategories, setCustomCategories] = useState({ entrada: [], despesa: [] });

  // Verificar autenticação no localStorage
  useEffect(() => {
    const authStatus = localStorage.getItem('isAuthenticated');
    const userData = localStorage.getItem('currentUser');
    if (authStatus === 'true' && userData) {
      setIsAuthenticated(true);
      setCurrentUser(JSON.parse(userData));
    }
  }, []);

  // Carregar categorias personalizadas na inicialização
  useEffect(() => {
    if (isAuthenticated) {
      const loadedCategories = CategoryManager.loadCategories();
      const customCats = CategoryManager.getCustomCategories();
      setCategories(loadedCategories);
      setCustomCategories(customCats);
    }
  }, [isAuthenticated]);

  // Funções CRUD para categorias personalizadas
  const addCustomCategory = useCallback((type, categoryData) => {
    // Validar dados da categoria
    const validation = CategoryManager.validateCategory(categoryData);
    if (!validation.valid) {
      toast.error(validation.error);
      return false;
    }

    // Verificar se já existe
    if (CategoryManager.categoryExists(categoryData.name, type)) {
      toast.error('Já existe uma categoria com esse nome!');
      return false;
    }

    try {
      // Criar nova categoria
      const newCategory = {
        id: CategoryManager.generateId(),
        name: ValidationUtils.sanitizeText(categoryData.name),
        icon: categoryData.icon,
        color: categoryData.color,
        custom: true,
        createdAt: new Date().toISOString()
      };

      // Atualizar estado local
      const updatedCustomCategories = {
        ...customCategories,
        [type]: [...customCategories[type], newCategory]
      };

      const updatedAllCategories = {
        ...categories,
        [type]: [...categories[type], newCategory]
      };

      // Salvar no localStorage
      if (CategoryManager.saveCustomCategories(updatedCustomCategories)) {
        setCustomCategories(updatedCustomCategories);
        setCategories(updatedAllCategories);
        toast.success(`Categoria "${newCategory.name}" criada com sucesso!`);
        return true;
      }
      return false;
    } catch (error) {
      ErrorHandler.handleStorageError(error, 'adicionar categoria');
      return false;
    }
  }, [customCategories, categories]);

  const updateCustomCategory = useCallback((type, categoryId, updatedData) => {
    // Validar dados da categoria
    const validation = CategoryManager.validateCategory(updatedData);
    if (!validation.valid) {
      toast.error(validation.error);
      return false;
    }

    // Verificar se nome já existe (excluindo a categoria atual)
    if (CategoryManager.categoryExists(updatedData.name, type, categoryId)) {
      toast.error('Já existe uma categoria com esse nome!');
      return false;
    }

    try {
      // Atualizar categoria personalizada
      const updatedCustomCategories = {
        ...customCategories,
        [type]: customCategories[type].map(cat => 
          cat.id === categoryId 
            ? {
                ...cat,
                name: ValidationUtils.sanitizeText(updatedData.name),
                icon: updatedData.icon,
                color: updatedData.color,
                updatedAt: new Date().toISOString()
              }
            : cat
        )
      };

      const updatedAllCategories = {
        ...categories,
        [type]: categories[type].map(cat => 
          cat.id === categoryId 
            ? {
                ...cat,
                name: ValidationUtils.sanitizeText(updatedData.name),
                icon: updatedData.icon,
                color: updatedData.color,
                updatedAt: new Date().toISOString()
              }
            : cat
        )
      };

      // Salvar no localStorage
      if (CategoryManager.saveCustomCategories(updatedCustomCategories)) {
        setCustomCategories(updatedCustomCategories);
        setCategories(updatedAllCategories);
        toast.success('Categoria atualizada com sucesso!');
        return true;
      }
      return false;
    } catch (error) {
      ErrorHandler.handleStorageError(error, 'atualizar categoria');
      return false;
    }
  }, [customCategories, categories]);

  const deleteCustomCategory = useCallback((type, categoryId) => {
    try {
      // Verificar se categoria é padrão (não pode ser deletada)
      const isDefault = CategoryManager.defaultCategories[type].some(cat => cat.id === categoryId);
      if (isDefault) {
        toast.error('Não é possível excluir categorias padrão do sistema!');
        return false;
      }

      // Verificar se categoria está em uso
      const categoryInUse = transactions.some(t => t.category === categoryId);
      if (categoryInUse) {
        toast.error('Não é possível excluir categoria que está sendo usada em transações!');
        return false;
      }

      // Remover categoria
      const updatedCustomCategories = {
        ...customCategories,
        [type]: customCategories[type].filter(cat => cat.id !== categoryId)
      };

      const updatedAllCategories = {
        ...categories,
        [type]: categories[type].filter(cat => cat.id !== categoryId)
      };

      // Salvar no localStorage
      if (CategoryManager.saveCustomCategories(updatedCustomCategories)) {
        setCustomCategories(updatedCustomCategories);
        setCategories(updatedAllCategories);
        toast.success('Categoria excluída com sucesso!');
        return true;
      }
      return false;
    } catch (error) {
      ErrorHandler.handleStorageError(error, 'excluir categoria');
      return false;
    }
  }, [customCategories, categories, transactions]);

  // Otimizar fetchTransactions com useCallback
  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${config.API_URL}/transactions`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (!Array.isArray(data)) {
        throw new Error('Formato de dados inválido recebido do servidor');
      }
      
      setTransactions(data);
    } catch (error) {
      ErrorHandler.handleApiError(error, 'buscar transações');
      setTransactions([]); // Fallback para array vazio
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchTransactions();
    }
  }, [isAuthenticated]);

  // Otimizar addTransaction com useCallback
  const addTransaction = useCallback(async (transaction) => {
    // Validação antes de enviar
    if (!ValidationUtils.isValidDescription(transaction.description)) {
      toast.error('Descrição deve ter entre 1 e 100 caracteres!');
      return;
    }

    if (!ValidationUtils.isReasonableAmount(transaction.value)) {
      toast.error('Valor deve ser um número positivo até R$ 1.000.000!');
      return;
    }

    if (!ValidationUtils.isValidDate(transaction.date)) {
      toast.error('Data inválida!');
      return;
    }

    if (!ValidationUtils.isReasonableDate(transaction.date)) {
      toast.error('Data não pode ser mais de 1 ano no futuro!');
      return;
    }

    // Usar categorias dinâmicas para validação
    const validCategoryIds = categories[transaction.type]?.map(cat => cat.id) || [];
    
    if (!validCategoryIds.includes(transaction.category)) {
      toast.error('Categoria inválida!');
      return;
    }

    setLoadingTransactions(true);
    try {
      // Sanitizar dados antes de enviar
      const sanitizedTransaction = {
        ...transaction,
        description: ValidationUtils.sanitizeText(transaction.description),
        value: parseFloat(transaction.value),
        date: transaction.date
      };

      const response = await fetch(`${config.API_URL}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sanitizedTransaction),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      fetchTransactions();
      toast.success(`${transaction.type === 'entrada' ? 'Receita' : 'Despesa'} adicionada com sucesso!`);
    } catch (error) {
      ErrorHandler.handleApiError(error, 'adicionar transação');
    } finally {
      setLoadingTransactions(false);
    }
  }, [fetchTransactions, categories]);

  // Otimizar deleteTransaction com useCallback
  const deleteTransaction = useCallback(async (id) => {
    // Validação do ID antes de excluir
    if (!ValidationUtils.isValidPositiveNumber(id)) {
      toast.error('ID de transação inválido!');
      return;
    }

    setLoadingTransactions(true);
    try {
      const response = await fetch(`${config.API_URL}/transactions/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      fetchTransactions();
      toast.success('Transação excluída com sucesso!');
    } catch (error) {
      ErrorHandler.handleApiError(error, 'excluir transação');
    } finally {
      setLoadingTransactions(false);
    }
  }, [fetchTransactions]);

  // Otimizar handleLogin com useCallback
  const handleLogin = useCallback((user) => {
    // Validação dos dados do usuário
    if (!user || !ValidationUtils.isValidCredentials(user.name, user.email)) {
      toast.error('Dados de usuário inválidos!');
      return;
    }

    try {
      // Sanitizar dados do usuário
      const sanitizedUser = {
        name: ValidationUtils.sanitizeText(user.name),
        email: user.email.toLowerCase().trim()
      };

      setIsAuthenticated(true);
      setCurrentUser(sanitizedUser);
      
      // Salvar dados do usuário de forma segura
      localStorage.setItem('isAuthenticated', 'true');
      localStorage.setItem('currentUser', JSON.stringify(sanitizedUser));
      
      toast.success(`Bem-vindo, ${sanitizedUser.name}!`);
    } catch (error) {
      ErrorHandler.handleStorageError(error, 'realizar login');
    }
  }, []);

  // Otimizar handleLogout com useCallback
  const handleLogout = useCallback(() => {
    try {
      setIsAuthenticated(false);
      setCurrentUser(null);
      localStorage.removeItem('isAuthenticated');
      localStorage.removeItem('currentUser');
      setActiveTab('dashboard');
      toast.info('Logout realizado com sucesso!');
    } catch (error) {
      ErrorHandler.handleStorageError(error, 'realizar logout');
    }
  }, []);

  // Funções para despesas recorrentes
  const saveRecurringExpenses = (expenses) => {
    localStorage.setItem('recurringExpenses', JSON.stringify(expenses));
    setRecurringExpenses(expenses);
    checkDueExpenses(expenses);
  };

  const addRecurringExpense = (expense) => {
    // Validação antes de adicionar
    if (!ValidationUtils.isValidDescription(expense.description)) {
      toast.error('Descrição deve ter entre 1 e 100 caracteres!');
      return;
    }

    if (!ValidationUtils.isReasonableAmount(expense.value)) {
      toast.error('Valor deve ser um número positivo até R$ 1.000.000!');
      return;
    }

    if (!ValidationUtils.isValidDate(expense.startDate)) {
      toast.error('Data de início inválida!');
      return;
    }

    const validRecurrences = ['mensal', 'semanal', 'anual'];
    if (!expense.recurrence || !validRecurrences.includes(expense.recurrence)) {
      toast.error('Recorrência inválida! Use: mensal, semanal ou anual.');
      return;
    }

    const validCategories = ['Alimentação', 'Transporte', 'Moradia', 'Saúde', 'Lazer', 'Outros'];
    if (!ValidationUtils.isValidCategory(expense.category, validCategories)) {
      toast.error('Categoria inválida!');
      return;
    }

    setLoadingRecurring(true);
    try {
      // Sanitizar dados antes de salvar
      const newExpense = {
        id: Date.now(),
        description: ValidationUtils.sanitizeText(expense.description),
        value: parseFloat(expense.value),
        startDate: expense.startDate,
        recurrence: expense.recurrence,
        category: expense.category,
        createdAt: new Date().toISOString(),
        nextDue: calculateNextDue(expense.startDate, expense.recurrence)
      };
      
      const updated = [...recurringExpenses, newExpense];
      saveRecurringExpenses(updated);
      toast.success('Despesa recorrente adicionada com sucesso!');
    } catch (error) {
      ErrorHandler.handleStorageError(error, 'adicionar despesa recorrente');
    } finally {
      setLoadingRecurring(false);
    }
  };

  const deleteRecurringExpense = (id) => {
    // Validação do ID antes de excluir
    if (!ValidationUtils.isValidPositiveNumber(id)) {
      toast.error('ID de despesa inválido!');
      return;
    }

    setLoadingRecurring(true);
    try {
      const updated = recurringExpenses.filter(expense => expense.id !== id);
      saveRecurringExpenses(updated);
      toast.success('Despesa recorrente excluída com sucesso!');
    } catch (error) {
      ErrorHandler.handleStorageError(error, 'excluir despesa recorrente');
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
          <button 
            className={activeTab === 'categorias' ? 'active' : ''} 
            onClick={() => setActiveTab('categorias')}
          >
            🏷️ Categorias
          </button>
        </nav>
      </header>

      <main className="main">
        {loading && <div className="loading">Carregando...</div>}
        
        <Suspense fallback={<SuspenseLoader message="Carregando aba..." />}>
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
              categories={categories}
            />
          )}
          
          {activeTab === 'despesas' && (
            <LancamentoForm 
              type="despesa" 
              onAdd={addTransaction}
              title="💸 Lançar Despesa"
              categories={categories}
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
          
          {activeTab === 'categorias' && (
            <CategoryManagement 
              categories={categories}
              onAddCategory={addCustomCategory}
              onUpdateCategory={updateCustomCategory}
              onDeleteCategory={deleteCustomCategory}
            />
          )}
          
          {activeTab === 'usuarios' && currentUser?.isAdmin && (
            <GerenciarUsuarios />
          )}
        </Suspense>
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

// Componente de Login otimizado com React.memo
const Login = React.memo(({ onLogin, loadingAuth, setLoadingAuth }) => {
  const [credentials, setCredentials] = useState({
    username: '',
    password: ''
  });

  // Memoizar a função getUsers para evitar recriação
  const getUsers = useCallback(() => {
    const users = localStorage.getItem('financeiro_users');
    return users ? JSON.parse(users) : [
      { 
        username: 'junior395@gmail.com', 
        password: 'j92953793*/*', 
        name: 'Administrador',
        isAdmin: true 
      }
    ];
  }, []);

  // Otimizar handleSubmit com useCallback
  const handleSubmit = useCallback((e) => {
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
  }, [credentials, onLogin, setLoadingAuth, getUsers]);

  // Otimizar handlers de input com useCallback
  const handleUsernameChange = useCallback((e) => {
    setCredentials(prev => ({...prev, username: e.target.value}));
  }, []);

  const handlePasswordChange = useCallback((e) => {
    setCredentials(prev => ({...prev, password: e.target.value}));
  }, []);

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
              onChange={handleUsernameChange}
              placeholder="Digite seu email"
              required
            />
          </div>
          <div className="form-group">
            <label>🔑 Senha:</label>
            <input
              type="password"
              value={credentials.password}
              onChange={handlePasswordChange}
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
});

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

// Componente de Gerenciamento de Categorias
const CategoryManagement = React.memo(({ 
  categories, 
  onAddCategory, 
  onUpdateCategory, 
  onDeleteCategory 
}) => {
  const [activeType, setActiveType] = useState('despesa');
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [categoryForm, setCategoryForm] = useState({
    name: '',
    icon: '💰',
    color: '#6b7280'
  });

  // Resetar formulário
  const resetForm = useCallback(() => {
    setCategoryForm({ name: '', icon: '💰', color: '#6b7280' });
    setIsAddingCategory(false);
    setEditingCategory(null);
  }, []);

  // Preparar edição
  const startEdit = useCallback((category) => {
    setCategoryForm({
      name: category.name,
      icon: category.icon,
      color: category.color
    });
    setEditingCategory(category);
    setIsAddingCategory(false);
  }, []);

  // Submeter formulário
  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    
    if (editingCategory) {
      // Atualizar categoria existente
      if (onUpdateCategory(activeType, editingCategory.id, categoryForm)) {
        resetForm();
      }
    } else {
      // Adicionar nova categoria
      if (onAddCategory(activeType, categoryForm)) {
        resetForm();
      }
    }
  }, [editingCategory, activeType, categoryForm, onUpdateCategory, onAddCategory, resetForm]);

  // Confirmar exclusão
  const handleDelete = useCallback((category) => {
    if (window.confirm(`Deseja realmente excluir a categoria "${category.name}"?`)) {
      onDeleteCategory(activeType, category.id);
    }
  }, [activeType, onDeleteCategory]);

  return (
    <div className="category-management">
      <h2>🏷️ Gerenciar Categorias</h2>
      
      <div className="category-type-tabs">
        <button 
          className={activeType === 'despesa' ? 'active' : ''}
          onClick={() => setActiveType('despesa')}
        >
          💸 Despesas
        </button>
        <button 
          className={activeType === 'entrada' ? 'active' : ''}
          onClick={() => setActiveType('entrada')}
        >
          💵 Receitas
        </button>
      </div>

      <div className="category-actions">
        <button 
          className="add-category-btn"
          onClick={() => setIsAddingCategory(true)}
          disabled={isAddingCategory || editingCategory}
        >
          ➕ Nova Categoria
        </button>
      </div>

      {(isAddingCategory || editingCategory) && (
        <form className="category-form" onSubmit={handleSubmit}>
          <h3>{editingCategory ? 'Editar Categoria' : 'Nova Categoria'}</h3>
          
          <div className="form-group">
            <label>Nome da Categoria:</label>
            <input
              type="text"
              value={categoryForm.name}
              onChange={(e) => setCategoryForm({...categoryForm, name: e.target.value})}
              placeholder="Ex: Educação, Investimentos..."
              maxLength={30}
              required
            />
          </div>

          <div className="form-group">
            <label>Ícone:</label>
            <div className="icon-selector">
              {CategoryManager.availableIcons.map(icon => (
                <button
                  key={icon}
                  type="button"
                  className={`icon-option ${categoryForm.icon === icon ? 'selected' : ''}`}
                  onClick={() => setCategoryForm({...categoryForm, icon})}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Cor:</label>
            <div className="color-selector">
              {CategoryManager.availableColors.map(color => (
                <button
                  key={color}
                  type="button"
                  className={`color-option ${categoryForm.color === color ? 'selected' : ''}`}
                  style={{ backgroundColor: color }}
                  onClick={() => setCategoryForm({...categoryForm, color})}
                />
              ))}
            </div>
          </div>

          <div className="form-actions">
            <button type="submit" className="save-btn">
              {editingCategory ? 'Atualizar' : 'Criar'} Categoria
            </button>
            <button type="button" className="cancel-btn" onClick={resetForm}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="categories-list">
        <h3>Categorias de {activeType === 'entrada' ? 'Receitas' : 'Despesas'}</h3>
        
        <div className="categories-grid">
          {categories[activeType]?.map(category => (
            <div 
              key={category.id} 
              className={`category-item ${category.custom ? 'custom' : 'default'}`}
              style={{ borderLeftColor: category.color }}
            >
              <div className="category-info">
                <span className="category-icon">{category.icon}</span>
                <span className="category-name">{category.name}</span>
                {category.custom && <span className="custom-badge">Personalizada</span>}
              </div>
              
              {category.custom && (
                <div className="category-actions">
                  <button 
                    className="edit-btn"
                    onClick={() => startEdit(category)}
                    disabled={isAddingCategory || editingCategory}
                  >
                    ✏️
                  </button>
                  <button 
                    className="delete-btn"
                    onClick={() => handleDelete(category)}
                    disabled={isAddingCategory || editingCategory}
                  >
                    🗑️
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

// Dashboard com resumo financeiro otimizado
const Dashboard = React.memo(({ transactions, dueAlerts }) => {
  const currentMonth = new Date().toISOString().slice(0, 7);
  
  // Otimizar filtro de transações mensais com useMemo
  const monthlyTransactions = useMemo(() => 
    transactions.filter(t => t.date.startsWith(currentMonth)), 
    [transactions, currentMonth]
  );
  
  // Otimizar cálculo de entradas com useMemo
  const totalEntradas = useMemo(() => 
    monthlyTransactions
      .filter(t => t.type === 'entrada')
      .reduce((sum, t) => sum + parseFloat(t.value), 0),
    [monthlyTransactions]
  );
    
  // Otimizar cálculo de despesas com useMemo
  const totalDespesas = useMemo(() => 
    monthlyTransactions
      .filter(t => t.type === 'despesa')
      .reduce((sum, t) => sum + parseFloat(t.value), 0),
    [monthlyTransactions]
  );
    
  // Otimizar cálculo de saldo com useMemo
  const saldo = useMemo(() => 
    totalEntradas - totalDespesas, 
    [totalEntradas, totalDespesas]
  );

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
});

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

// Formulário de lançamento otimizado
const LancamentoForm = React.memo(({ type, onAdd, title, categories }) => {
  const [form, setForm] = useState({
    description: '',
    value: '',
    category: '',
    date: new Date().toISOString().slice(0, 10)
  });

  // Usar categorias dinâmicas
  const availableCategories = useMemo(() => 
    categories?.[type] || [], 
    [categories, type]
  );

  const handleSubmit = useCallback((e) => {
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
  }, [form, type, onAdd]);

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
            {availableCategories.map(cat => (
              <option key={cat.id} value={cat.id}>
                {cat.icon} {cat.name}
              </option>
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
});

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
    // Validação dos dados antes de exportar
    if (!monthlyData || monthlyData.length === 0) {
      toast.error('Não há dados para exportar!');
      return;
    }

    if (!selectedMonth || !ValidationUtils.isNotEmpty(selectedMonth)) {
      toast.error('Mês selecionado inválido!');
      return;
    }

    setLoadingExport(true);
    try {
      const csvData = [
        ['Data', 'Descrição', 'Categoria', 'Tipo', 'Valor (R$)']
      ];
      
      // Validar e sanitizar cada transação antes de exportar
      monthlyData.forEach(t => {
        if (t && ValidationUtils.isValidDate(t.date) && ValidationUtils.isNotEmpty(t.description)) {
          csvData.push([
            new Date(t.date).toLocaleDateString('pt-BR'),
            ValidationUtils.sanitizeText(t.description),
            t.category || 'Outros',
            t.type === 'entrada' ? 'Entrada' : 'Despesa',
            ValidationUtils.isValidPositiveNumber(t.value) ? parseFloat(t.value).toFixed(2) : '0.00'
          ]);
        }
      });

      if (csvData.length <= 1) {
        toast.error('Nenhum dado válido encontrado para exportar!');
        return;
      }

      const csv = csvData.map(row => row.join(',')).join('\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      
      // Sanitizar nome do arquivo
      const fileName = `transacoes-${ValidationUtils.sanitizeText(selectedMonth)}.csv`;
      saveAs(blob, fileName);
      
      toast.success(`Relatório CSV exportado com sucesso! ${csvData.length - 1} transações exportadas.`);
    } catch (error) {
      ErrorHandler.handleApiError(error, 'exportar relatório CSV');
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

// Histórico de transações otimizado
const Historico = React.memo(({ transactions, onDelete }) => {
  const [filter, setFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Implementar debounce na busca
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // Otimizar filtros com useMemo incluindo busca
  const filteredTransactions = useMemo(() => 
    transactions.filter(t => {
      const typeMatch = filter === 'all' || t.type === filter;
      const monthMatch = !monthFilter || t.date.startsWith(monthFilter);
      const searchMatch = !debouncedSearchTerm || 
        t.description.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
        t.category.toLowerCase().includes(debouncedSearchTerm.toLowerCase());
      return typeMatch && monthMatch && searchMatch;
    }).reverse(),
    [transactions, filter, monthFilter, debouncedSearchTerm]
  );

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
        
        <input
          type="text"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="🔍 Buscar descrição ou categoria..."
          className="search-input"
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
});

export default App;
