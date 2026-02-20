import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import './App.css';
import './mobile.css';
import './professional.css';
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
      toast.error('Erro de conexão com servidor. Verifique sua internet e tente novamente.');
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
          toast.error('Servidor não encontrado. Verifique a conexão com a internet.');
          break;
        case 500:
          toast.error('Erro interno do servidor. Tente novamente mais tarde.');
          break;
        default:
          toast.error(`Erro ${error.status}: ${operation} falhou. Conexão com servidor necessária.`);
      }
    } else {
      toast.error(`Erro inesperado durante ${operation}. Conexão com servidor necessária.`);
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

// Utilitários para conectividade
const ConnectivityUtils = {
  // Verificar se a API está disponível
  checkApiHealth: async () => {
    try {
      console.log('Testando conexão com API...');
      const response = await fetch(`${config.API_URL}/api/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000) // Timeout de 10 segundos
      });

      const isAvailable = response.ok;
      console.log('Resultado do teste de API:', isAvailable ? 'DISPONÍVEL' : 'INDISPONÍVEL');
      return isAvailable;
    } catch (error) {
      console.error('API não disponível:', error.message);
      return false;
    }
  },

  // Verificar conectividade básica
  isOnline: () => {
    return navigator.onLine;
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

// Avança uma data de vencimento pelo período de recorrência
const calcNextDue = (currentDueStr, frequency) => {
  const [y, m, d] = currentDueStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  switch (frequency) {
    case 'monthly': date.setMonth(date.getMonth() + 1); break;
    case 'bimonthly': date.setMonth(date.getMonth() + 2); break;
    case 'quarterly': date.setMonth(date.getMonth() + 3); break;
    case 'semiannual': date.setMonth(date.getMonth() + 6); break;
    case 'annual': date.setFullYear(date.getFullYear() + 1); break;
    case 'fifth-business-day': {
      const nm = new Date(y, m, 1); // primeiro dia do próximo mês
      let count = 0, td = 1;
      while (count < 5) {
        const t = new Date(nm.getFullYear(), nm.getMonth(), td);
        if (t.getDay() !== 0 && t.getDay() !== 6) count++;
        if (count < 5) td++;
      }
      return `${nm.getFullYear()}-${String(nm.getMonth() + 1).padStart(2, '0')}-${String(td).padStart(2, '0')}`;
    }
    default: date.setMonth(date.getMonth() + 1);
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const RECURRING_CAT_MAP = {
  'Alimentação': 'alim', 'Transporte': 'trans', 'Moradia': 'mor',
  'Saúde': 'sau', 'Lazer': 'laz', 'Outros': 'out-desp'
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
  const [budgets, setBudgets] = useState([]);
  const [wallets, setWallets] = useState([]);
  const [goals, setGoals] = useState([]);
  // Estado para modo escuro
  const [darkMode, setDarkMode] = useState(false);

  // Estado para conectividade da API
  const [isApiAvailable, setIsApiAvailable] = useState(false);
  const [apiChecked, setApiChecked] = useState(false);

  // Estado para categorias personalizadas
  const [categories, setCategories] = useState(CategoryManager.defaultCategories);
  const [customCategories, setCustomCategories] = useState({ entrada: [], despesa: [] });

  // Verificar autenticação no localStorage com validação mais rigorosa
  useEffect(() => {
    console.log('🔍 Verificando autenticação no localStorage...');
    const authStatus = localStorage.getItem('isAuthenticated');
    const userData = localStorage.getItem('currentUser');
    const authTimestamp = localStorage.getItem('authTimestamp');

    console.log('📋 Dados do localStorage:', {
      authStatus,
      userData,
      authTimestamp
    });

    // Verificar se a autenticação é válida e não expirou (24 horas)
    if (authStatus === 'true' && userData && authTimestamp) {
      const now = new Date().getTime();
      const authTime = parseInt(authTimestamp);
      const twentyFourHours = 24 * 60 * 60 * 1000; // 24 horas em ms

      console.log('⏰ Verificando expiração:', {
        now,
        authTime,
        difference: now - authTime,
        expired: (now - authTime) >= twentyFourHours
      });

      if (now - authTime < twentyFourHours) {
        try {
          const user = JSON.parse(userData);
          console.log('✅ Usuário válido encontrado:', user);
          setIsAuthenticated(true);
          setCurrentUser(user);
        } catch (error) {
          console.error('❌ Erro ao fazer parse dos dados do usuário:', error);
          // Limpar dados corrompidos
          localStorage.removeItem('isAuthenticated');
          localStorage.removeItem('currentUser');
          localStorage.removeItem('authTimestamp');
        }
      } else {
        console.log('⏰ Sessão expirada - limpando dados');
        // Sessão expirada - limpar dados
        localStorage.removeItem('isAuthenticated');
        localStorage.removeItem('currentUser');
        localStorage.removeItem('authTimestamp');
        toast.info('Sessão expirada. Faça login novamente.');
      }
    }
  }, []);

  // Verificar disponibilidade da API na inicialização
  useEffect(() => {
    const checkApi = async () => {
      console.log('=== VERIFICANDO DISPONIBILIDADE DA API ===');
      setApiChecked(false);

      try {
        const available = await ConnectivityUtils.checkApiHealth();
        console.log('Resultado final da verificação:', available);

        setIsApiAvailable(available);
        setApiChecked(true);

        if (available) {
          console.log('✅ API disponível - sistema operacional');
          toast.success('Conectado ao servidor!', { autoClose: 2000 });
        } else {
          console.log('❌ API indisponível - sistema bloqueado');
          toast.error('Servidor indisponível. Verifique sua conexão.', { autoClose: 5000 });
        }
      } catch (error) {
        console.error('Erro ao verificar API:', error);
        setIsApiAvailable(false);
        setApiChecked(true);
        toast.error('Erro ao conectar com o servidor.', { autoClose: 5000 });
      }
    };

    checkApi();

    // Recheck API a cada 30 segundos se estiver offline
    const interval = setInterval(() => {
      if (!isApiAvailable) {
        console.log('Recheck da API...');
        checkApi();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [isApiAvailable]);

  // Carregar categorias personalizadas
  useEffect(() => {
    const loadedCategories = CategoryManager.loadCategories();
    const customCats = CategoryManager.getCustomCategories();
    setCategories(loadedCategories);
    setCustomCategories(customCats);
  }, []);

  // Funções para categorias personalizadas
  const addCustomCategory = useCallback((type, categoryData) => {
    const validation = CategoryManager.validateCategory(categoryData);
    if (!validation.valid) {
      toast.error(validation.error);
      return false;
    }

    if (CategoryManager.categoryExists(categoryData.name, type)) {
      toast.error('Já existe uma categoria com este nome!');
      return false;
    }

    const newCategory = {
      ...categoryData,
      id: CategoryManager.generateId(),
      custom: true
    };

    const updatedCustomCategories = {
      ...customCategories,
      [type]: [...customCategories[type], newCategory]
    };

    if (CategoryManager.saveCustomCategories(updatedCustomCategories)) {
      setCustomCategories(updatedCustomCategories);
      const updatedCategories = {
        ...categories,
        [type]: [...categories[type], newCategory]
      };
      setCategories(updatedCategories);
      toast.success('Categoria criada com sucesso!');
      return true;
    }
    return false;
  }, [categories, customCategories]);

  const updateCustomCategory = useCallback((type, categoryId, categoryData) => {
    const validation = CategoryManager.validateCategory(categoryData);
    if (!validation.valid) {
      toast.error(validation.error);
      return false;
    }

    if (CategoryManager.categoryExists(categoryData.name, type, categoryId)) {
      toast.error('Já existe uma categoria com este nome!');
      return false;
    }

    const updatedCustomCategories = {
      ...customCategories,
      [type]: customCategories[type].map(cat =>
        cat.id === categoryId ? { ...categoryData, id: categoryId, custom: true } : cat
      )
    };

    if (CategoryManager.saveCustomCategories(updatedCustomCategories)) {
      setCustomCategories(updatedCustomCategories);
      const updatedCategories = CategoryManager.loadCategories();
      setCategories(updatedCategories);
      toast.success('Categoria atualizada com sucesso!');
      return true;
    }
    return false;
  }, [customCategories]);

  const deleteCustomCategory = useCallback((type, categoryId) => {
    const updatedCustomCategories = {
      ...customCategories,
      [type]: customCategories[type].filter(cat => cat.id !== categoryId)
    };

    if (CategoryManager.saveCustomCategories(updatedCustomCategories)) {
      setCustomCategories(updatedCustomCategories);
      const updatedCategories = CategoryManager.loadCategories();
      setCategories(updatedCategories);
      toast.success('Categoria excluída com sucesso!');
      return true;
    }
    return false;
  }, [customCategories]);

  // All hooks must be called before any conditional returns
  const fetchTransactions = useCallback(async () => {
    try {
      console.log('📡 Fazendo requisição para:', `${config.API_URL}/transactions?userId=${encodeURIComponent(currentUser.email)}`);
      const response = await fetch(`${config.API_URL}/transactions?userId=${encodeURIComponent(currentUser.email)}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      console.log('📥 Dados recebidos:', data);
      if (!Array.isArray(data)) {
        throw new Error('Formato de dados inválido recebido do servidor');
      }
      setTransactions(data);
      console.log('✅ Transações carregadas com sucesso:', data.length, 'itens');
    } catch (error) {
      console.error('❌ Erro ao buscar transações da API:', error);
      setIsApiAvailable(false);
      ErrorHandler.handleApiError(error, 'buscar transações');
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  const addTransaction = useCallback(async (transaction) => {
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

    const validCategoryIds = categories[transaction.type]?.map(cat => cat.id) || [];

    if (!validCategoryIds.includes(transaction.category)) {
      toast.error('Categoria inválida!');
      return;
    }

    setLoadingTransactions(true);
    try {
      if (!isApiAvailable) {
        toast.error('Conexão com servidor necessária para adicionar transações. Verifique sua internet.');
        return;
      }

      if (!currentUser?.email) {
        toast.error('Usuário não autenticado. Faça login novamente.');
        return;
      }

      const sanitizedTransaction = {
        ...transaction,
        description: ValidationUtils.sanitizeText(transaction.description),
        value: parseFloat(transaction.value),
        date: transaction.date,
        userId: currentUser.email
      };

      const response = await fetch(`${config.API_URL}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sanitizedTransaction),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      await fetchTransactions();
      toast.success(`${transaction.type === 'entrada' ? 'Receita' : 'Despesa'} adicionada com sucesso!`);
    } catch (error) {
      console.error('Erro ao adicionar transação via API:', error);
      setIsApiAvailable(false);
      ErrorHandler.handleApiError(error, 'adicionar transação');
    } finally {
      setLoadingTransactions(false);
    }
  }, [fetchTransactions, categories, isApiAvailable, currentUser]);

  const deleteTransaction = useCallback(async (id) => {
    if (!ValidationUtils.isValidPositiveNumber(id)) {
      toast.error('ID de transação inválido!');
      return;
    }

    if (!isApiAvailable) {
      toast.error('Conexão com servidor necessária para excluir transações. Verifique sua internet.');
      return;
    }

    if (!currentUser?.email) {
      toast.error('Usuário não autenticado. Faça login novamente.');
      return;
    }

    setLoadingTransactions(true);
    try {
      const response = await fetch(`${config.API_URL}/transactions/${id}?userId=${encodeURIComponent(currentUser.email)}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        if (response.status === 403) {
          toast.error('Você não tem permissão para excluir esta transação.');
          return;
        } else if (response.status === 404) {
          toast.error('Transação não encontrada. Ela pode já ter sido excluída.');
          fetchTransactions();
          return;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      fetchTransactions();
      toast.success('Transação excluída com sucesso!');
    } catch (error) {
      console.error('❌ Erro ao excluir transação via API:', error);
      setIsApiAvailable(false);
      ErrorHandler.handleApiError(error, 'excluir transação');
    } finally {
      setLoadingTransactions(false);
    }
  }, [fetchTransactions, currentUser, isApiAvailable]);

  const updateTransaction = useCallback(async (id, transaction) => {
    if (!isApiAvailable) {
      toast.error('Conexão com servidor necessária para editar transações.');
      return;
    }
    setLoadingTransactions(true);
    try {
      const response = await fetch(`${config.API_URL}/transactions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...transaction, userId: currentUser.email })
      });
      const data = await response.json();
      if (response.ok) {
        await fetchTransactions();
        toast.success('Transação atualizada com sucesso!');
        return true;
      } else {
        toast.error(data.error || 'Erro ao atualizar transação');
        return false;
      }
    } catch (error) {
      console.error('Erro ao atualizar transação:', error);
      toast.error('Erro de conexão ao atualizar transação');
      return false;
    } finally {
      setLoadingTransactions(false);
    }
  }, [fetchTransactions, currentUser, isApiAvailable]);

  const handleLogin = useCallback((user) => {
    console.log('🔐 HandleLogin chamado com:', user);

    if (!user || !ValidationUtils.isValidCredentials(user.name, user.email)) {
      console.log('❌ Dados de usuário inválidos:', user);
      toast.error('Dados de usuário inválidos!');
      return;
    }

    try {
      const sanitizedUser = {
        name: ValidationUtils.sanitizeText(user.name),
        email: user.email.toLowerCase().trim()
      };

      console.log('🧹 Usuário sanitizado:', sanitizedUser);

      setIsAuthenticated(true);
      setCurrentUser(sanitizedUser);

      localStorage.setItem('isAuthenticated', 'true');
      localStorage.setItem('currentUser', JSON.stringify(sanitizedUser));
      localStorage.setItem('authTimestamp', new Date().getTime().toString());

      console.log('💾 Dados salvos no localStorage:', {
        isAuthenticated: localStorage.getItem('isAuthenticated'),
        currentUser: localStorage.getItem('currentUser'),
        authTimestamp: localStorage.getItem('authTimestamp')
      });

      toast.success(`Bem-vindo, ${sanitizedUser.name}!`);
    } catch (error) {
      ErrorHandler.handleStorageError(error, 'realizar login');
    }
  }, []);

  const handleLogout = useCallback(() => {
    try {
      setIsAuthenticated(false);
      setCurrentUser(null);
      localStorage.removeItem('isAuthenticated');
      localStorage.removeItem('currentUser');
      localStorage.removeItem('authTimestamp');
      setActiveTab('dashboard');
      toast.info('Logout realizado com sucesso!');
    } catch (error) {
      ErrorHandler.handleStorageError(error, 'realizar logout');
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchTransactions();
    }
  }, [isAuthenticated, fetchTransactions]);

  const fetchRecurringExpenses = useCallback(async () => {
    if (!currentUser?.email) return;
    try {
      const response = await fetch(`${config.API_URL}/recurring-expenses?userId=${encodeURIComponent(currentUser.email)}`);
      if (response.ok) {
        const data = await response.json();
        const mapped = data.map(e => ({
          ...e,
          recurrence: e.frequency,
          nextDue: e.next_due_date
        }));
        setRecurringExpenses(mapped);
        checkDueExpenses(mapped);
      }
    } catch (error) {
      console.error('Erro ao buscar despesas recorrentes:', error);
    }
  }, [currentUser]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isAuthenticated) {
      fetchRecurringExpenses();
    }
  }, [isAuthenticated, fetchRecurringExpenses]);

  // Funções para despesas recorrentes
  const addRecurringExpense = async (expense) => {
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
    const validRecurrences = ['monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual', 'fifth-business-day'];
    if (!expense.recurrence || !validRecurrences.includes(expense.recurrence)) {
      toast.error('Recorrência inválida! Selecione uma opção válida.');
      return;
    }
    const validCategories = ['Alimentação', 'Transporte', 'Moradia', 'Saúde', 'Lazer', 'Outros'];
    if (!ValidationUtils.isValidCategory(expense.category, validCategories)) {
      toast.error('Categoria inválida!');
      return;
    }

    setLoadingRecurring(true);
    try {
      // Avança a partir da data de início até o próximo vencimento futuro
      let nextDueDate = expense.startDate;
      const today = new Date().toISOString().split('T')[0];
      while (nextDueDate <= today) {
        nextDueDate = calcNextDue(nextDueDate, expense.recurrence);
      }
      const response = await fetch(`${config.API_URL}/recurring-expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.email,
          description: ValidationUtils.sanitizeText(expense.description),
          category: expense.category,
          value: parseFloat(expense.value),
          frequency: expense.recurrence,
          next_due_date: nextDueDate
        })
      });
      if (response.ok) {
        await fetchRecurringExpenses();
        toast.success('Despesa recorrente adicionada com sucesso!');
      } else {
        const data = await response.json();
        toast.error(data.error || 'Erro ao adicionar despesa recorrente');
      }
    } catch (error) {
      toast.error('Erro de conexão ao adicionar despesa recorrente');
    } finally {
      setLoadingRecurring(false);
    }
  };

  const deleteRecurringExpense = async (id) => {
    setLoadingRecurring(true);
    try {
      const response = await fetch(`${config.API_URL}/recurring-expenses/${id}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        await fetchRecurringExpenses();
        toast.success('Despesa recorrente excluída com sucesso!');
      } else {
        toast.error('Erro ao excluir despesa recorrente');
      }
    } catch (error) {
      toast.error('Erro de conexão ao excluir despesa recorrente');
    } finally {
      setLoadingRecurring(false);
    }
  };

  const payRecurringExpense = useCallback(async (expense) => {
    if (!currentUser?.email) return;
    setLoadingRecurring(true);
    try {
      const dueDate = expense.next_due_date || expense.nextDue;
      const freq = expense.frequency || expense.recurrence;
      const catId = RECURRING_CAT_MAP[expense.category] || 'out-desp';

      // 1. Criar transação de despesa
      const txRes = await fetch(`${config.API_URL}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'despesa',
          description: expense.description,
          category: catId,
          value: parseFloat(expense.value),
          date: dueDate,
          userId: currentUser.email
        })
      });
      if (!txRes.ok) {
        toast.error('Erro ao registrar transação');
        return;
      }

      // 2. Avançar próximo vencimento
      const newDue = calcNextDue(dueDate, freq);
      await fetch(`${config.API_URL}/recurring-expenses/${expense.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: expense.description,
          category: expense.category,
          value: parseFloat(expense.value),
          frequency: freq,
          next_due_date: newDue,
          is_active: 1
        })
      });

      await fetchTransactions();
      await fetchRecurringExpenses();
      toast.success(`✅ Pagamento registrado! Próximo vencimento: ${new Date(newDue + 'T00:00:00').toLocaleDateString('pt-BR')}`);
    } catch (error) {
      toast.error('Erro ao registrar pagamento');
    } finally {
      setLoadingRecurring(false);
    }
  }, [currentUser, fetchTransactions, fetchRecurringExpenses]);

  const updateRecurringExpense = useCallback(async (id, data) => {
    setLoadingRecurring(true);
    try {
      const res = await fetch(`${config.API_URL}/recurring-expenses/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (res.ok) {
        await fetchRecurringExpenses();
        toast.success('Despesa recorrente atualizada!');
        return true;
      }
      toast.error('Erro ao atualizar despesa recorrente');
      return false;
    } catch (error) {
      toast.error('Erro de conexão');
      return false;
    } finally {
      setLoadingRecurring(false);
    }
  }, [fetchRecurringExpenses]);

  // ============ ORÇAMENTOS ============
  const fetchBudgets = useCallback(async () => {
    if (!currentUser?.email) return;
    try {
      const res = await fetch(`${config.API_URL}/budgets?userId=${encodeURIComponent(currentUser.email)}`);
      if (res.ok) setBudgets(await res.json());
    } catch (e) { console.error('Erro ao buscar orçamentos', e); }
  }, [currentUser]);

  useEffect(() => { if (isAuthenticated) fetchBudgets(); }, [isAuthenticated, fetchBudgets]);

  const addBudget = useCallback(async (data) => {
    const res = await fetch(`${config.API_URL}/budgets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, userId: currentUser.email })
    });
    if (res.ok) { await fetchBudgets(); toast.success('Orçamento criado!'); return true; }
    const d = await res.json(); toast.error(d.error || 'Erro ao criar orçamento'); return false;
  }, [currentUser, fetchBudgets]);

  const deleteBudget = useCallback(async (id) => {
    const res = await fetch(`${config.API_URL}/budgets/${id}`, { method: 'DELETE' });
    if (res.ok) { await fetchBudgets(); toast.success('Orçamento removido!'); }
  }, [fetchBudgets]);

  // ============ CONTAS ============
  const fetchWallets = useCallback(async () => {
    if (!currentUser?.email) return;
    try {
      const res = await fetch(`${config.API_URL}/wallets?userId=${encodeURIComponent(currentUser.email)}`);
      if (res.ok) setWallets(await res.json());
    } catch (e) { console.error('Erro ao buscar contas', e); }
  }, [currentUser]);

  useEffect(() => { if (isAuthenticated) fetchWallets(); }, [isAuthenticated, fetchWallets]);

  const addWallet = useCallback(async (data) => {
    const res = await fetch(`${config.API_URL}/wallets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, userId: currentUser.email })
    });
    if (res.ok) { await fetchWallets(); toast.success('Conta criada!'); return true; }
    const d = await res.json(); toast.error(d.error || 'Erro ao criar conta'); return false;
  }, [currentUser, fetchWallets]);

  const updateWallet = useCallback(async (id, data) => {
    const res = await fetch(`${config.API_URL}/wallets/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (res.ok) { await fetchWallets(); toast.success('Conta atualizada!'); return true; }
    return false;
  }, [fetchWallets]);

  const deleteWallet = useCallback(async (id) => {
    const res = await fetch(`${config.API_URL}/wallets/${id}`, { method: 'DELETE' });
    if (res.ok) { await fetchWallets(); toast.success('Conta removida!'); }
  }, [fetchWallets]);

  // ============ METAS ============
  const fetchGoals = useCallback(async () => {
    if (!currentUser?.email) return;
    try {
      const res = await fetch(`${config.API_URL}/goals?userId=${encodeURIComponent(currentUser.email)}`);
      if (res.ok) setGoals(await res.json());
    } catch (e) { console.error('Erro ao buscar metas', e); }
  }, [currentUser]);

  useEffect(() => { if (isAuthenticated) fetchGoals(); }, [isAuthenticated, fetchGoals]);

  const addGoal = useCallback(async (data) => {
    const res = await fetch(`${config.API_URL}/goals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, userId: currentUser.email })
    });
    if (res.ok) { await fetchGoals(); toast.success('Meta criada!'); return true; }
    const d = await res.json(); toast.error(d.error || 'Erro ao criar meta'); return false;
  }, [currentUser, fetchGoals]);

  const updateGoal = useCallback(async (id, data) => {
    const res = await fetch(`${config.API_URL}/goals/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (res.ok) { await fetchGoals(); toast.success('Meta atualizada!'); return true; }
    return false;
  }, [fetchGoals]);

  const deleteGoal = useCallback(async (id) => {
    const res = await fetch(`${config.API_URL}/goals/${id}`, { method: 'DELETE' });
    if (res.ok) { await fetchGoals(); toast.success('Meta removida!'); }
  }, [fetchGoals]);

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

  const isAdmin = currentUser?.email === 'junior395@gmail.com';

  // Se não estiver autenticado, mostrar tela de login
  if (!isAuthenticated) {
    return (
      <Login
        onLogin={handleLogin}
        loadingAuth={loadingAuth}
        setLoadingAuth={setLoadingAuth}
      />
    );
  }

  return (
    <div className={`app${darkMode ? ' dark-mode' : ''}`}>
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
          <div className="header-controls">
            <div className="connectivity-status">
              {apiChecked && (
                <span className={`status-indicator ${isApiAvailable ? 'online' : 'offline'}`}>
                  {isApiAvailable ? '🟢 Online' : '🔴 Offline'}
                </span>
              )}
            </div>
            <div className="user-info">
              <span>👤 {currentUser?.name || currentUser?.username}</span>
              {isAdmin && (
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
              <button
                className="darkmode-btn"
                onClick={() => setDarkMode(dm => !dm)}
                title={darkMode ? 'Modo Claro' : 'Modo Escuro'}
                style={{ marginLeft: '10px' }}
              >
                {darkMode ? '🌙' : '☀️'}
              </button>
            </div>
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
          <button
            className={activeTab === 'orcamentos' ? 'active' : ''}
            onClick={() => setActiveTab('orcamentos')}
          >
            🎯 Orçamentos
          </button>
          <button
            className={activeTab === 'contas' ? 'active' : ''}
            onClick={() => setActiveTab('contas')}
          >
            🏦 Contas
          </button>
          <button
            className={activeTab === 'metas' ? 'active' : ''}
            onClick={() => setActiveTab('metas')}
          >
            🏆 Metas
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
              isApiAvailable={isApiAvailable}
            />
          )}
          {activeTab === 'despesas' && (
            <LancamentoForm
              type="despesa"
              onAdd={addTransaction}
              title="💸 Lançar Despesa"
              categories={categories}
              isApiAvailable={isApiAvailable}
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
              onUpdate={updateTransaction}
              isApiAvailable={isApiAvailable}
              categories={categories}
            />
          )}
          {activeTab === 'recorrentes' && (
            <DespesasRecorrentes
              expenses={recurringExpenses}
              onAdd={addRecurringExpense}
              onDelete={deleteRecurringExpense}
              onPay={payRecurringExpense}
              onUpdate={updateRecurringExpense}
            />
          )}
          {activeTab === 'orcamentos' && (
            <Orcamentos
              budgets={budgets}
              transactions={transactions}
              categories={categories}
              onAdd={addBudget}
              onDelete={deleteBudget}
            />
          )}
          {activeTab === 'contas' && (
            <Contas
              wallets={wallets}
              onAdd={addWallet}
              onUpdate={updateWallet}
              onDelete={deleteWallet}
            />
          )}
          {activeTab === 'metas' && (
            <Metas
              goals={goals}
              onAdd={addGoal}
              onUpdate={updateGoal}
              onDelete={deleteGoal}
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
          {activeTab === 'usuarios' && isAdmin && (
            <GerenciarUsuarios />
          )}
        </Suspense>
      </main>

      <ToastContainer />
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
    email: '',
    password: ''
  });

  // Otimizar handleSubmit com useCallback para API
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setLoadingAuth(true);

    try {
      // Fazer login via API
      const response = await fetch(`${config.API_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: credentials.email,
          password: credentials.password
        })
      });

      const data = await response.json();

      if (response.ok) {
        // Login bem-sucedido
        const user = {
          name: data.user.name,
          email: data.user.email,
          id: data.user.id
        };

        onLogin(user);
        toast.success('Login realizado com sucesso!');
      } else {
        // Login falhou
        toast.error(data.error || 'Email ou senha incorretos!');
      }
    } catch (error) {
      console.error('Erro no login:', error);
      toast.error('Erro de conexão. Verifique sua internet e tente novamente.');
    } finally {
      setLoadingAuth(false);
    }
  }, [credentials, onLogin, setLoadingAuth]);

  // Otimizar handlers de input com useCallback
  const handleEmailChange = useCallback((e) => {
    setCredentials(prev => ({ ...prev, email: e.target.value }));
  }, []);

  const handlePasswordChange = useCallback((e) => {
    setCredentials(prev => ({ ...prev, password: e.target.value }));
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
              value={credentials.email}
              onChange={handleEmailChange}
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
          <p><strong>Sistema:</strong> Gestor Financeiro</p>
          <p><strong>Status:</strong> Conectado à API</p>
        </div>

        <div className="login-actions">
          <button
            type="button"
            className="clear-data-btn"
            onClick={() => {
              if (window.confirm('⚠️ ATENÇÃO: Isso vai limpar apenas os dados do navegador (não os dados do servidor). Deseja continuar?')) {
                localStorage.clear();
                window.location.reload();
              }
            }}
          >
            🧹 Limpar Cache do Navegador
          </button>
        </div>
      </div>
    </div>
  );
});

// Componente para gerenciar usuários (apenas admin)
function GerenciarUsuarios() {
  const [users, setUsers] = useState([]);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [newUser, setNewUser] = useState({
    email: '',
    password: '',
    name: ''
  });
  const [editForm, setEditForm] = useState({
    name: '',
    email: '',
    password: ''
  });

  // Carregar usuários da API
  const loadUsers = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${config.API_URL}/admin/users`);
      if (response.ok) {
        const data = await response.json();
        setUsers(data);
      } else {
        toast.error('Erro ao carregar usuários');
      }
    } catch (error) {
      console.error('Erro ao carregar usuários:', error);
      toast.error('Erro de conexão ao carregar usuários');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  // Adicionar novo usuário via API
  const handleAddUser = async (e) => {
    e.preventDefault();

    if (newUser.password.length < 6) {
      toast.error('A senha deve ter pelo menos 6 caracteres!');
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`${config.API_URL}/admin/register-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(newUser)
      });

      const data = await response.json();

      if (response.ok) {
        toast.success('Usuário cadastrado com sucesso!');
        setNewUser({ email: '', password: '', name: '' });
        setIsAddingUser(false);
        loadUsers();
      } else {
        toast.error(data.error || 'Erro ao cadastrar usuário');
      }
    } catch (error) {
      console.error('Erro ao cadastrar usuário:', error);
      toast.error('Erro de conexão ao cadastrar usuário');
    } finally {
      setLoading(false);
    }
  };

  // Abrir formulário de edição
  const handleStartEdit = (user) => {
    setEditingUser(user.id);
    setEditForm({ name: user.name, email: user.email, password: '' });
    setIsAddingUser(false);
  };

  // Salvar edição do usuário
  const handleUpdateUser = async (e) => {
    e.preventDefault();

    if (editForm.password && editForm.password.length < 6) {
      toast.error('A nova senha deve ter pelo menos 6 caracteres!');
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`${config.API_URL}/admin/users/${editingUser}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm)
      });

      const data = await response.json();

      if (response.ok) {
        toast.success('Usuário atualizado com sucesso!');
        setEditingUser(null);
        setEditForm({ name: '', email: '', password: '' });
        loadUsers();
      } else {
        toast.error(data.error || 'Erro ao atualizar usuário');
      }
    } catch (error) {
      console.error('Erro ao atualizar usuário:', error);
      toast.error('Erro de conexão ao atualizar usuário');
    } finally {
      setLoading(false);
    }
  };

  // Remover usuário via API
  const handleRemoveUser = async (userId, userEmail) => {
    if (userEmail === 'junior395@gmail.com') {
      toast.error('Não é possível remover o administrador principal!');
      return;
    }

    if (window.confirm(`Deseja realmente remover o usuário ${userEmail}?`)) {
      try {
        setLoading(true);
        const response = await fetch(`${config.API_URL}/admin/users/${userId}`, {
          method: 'DELETE'
        });

        if (response.ok) {
          toast.success('Usuário removido com sucesso!');
          loadUsers();
        } else {
          const data = await response.json();
          toast.error(data.error || 'Erro ao remover usuário');
        }
      } catch (error) {
        console.error('Erro ao remover usuário:', error);
        toast.error('Erro de conexão ao remover usuário');
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="usuarios-management">
      <h2>👥 Gerenciar Usuários</h2>

      <div className="users-actions">
        <button
          onClick={() => { setIsAddingUser(!isAddingUser); setEditingUser(null); }}
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
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>👨‍💼 Nome:</label>
              <input
                type="text"
                value={newUser.name}
                onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>🔑 Senha:</label>
              <input
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                required
                minLength="6"
              />
            </div>
            <ButtonSpinner
              type="submit"
              className="submit-btn"
              loading={loading}
            >
              Cadastrar
            </ButtonSpinner>
          </form>
        </div>
      )}

      <div className="users-list">
        <h3>Usuários Cadastrados</h3>
        {loading ? (
          <p>Carregando usuários...</p>
        ) : users.length === 0 ? (
          <p>Nenhum usuário cadastrado</p>
        ) : (
          users.map(user => (
            <div key={user.id} className="user-card">
              {editingUser === user.id ? (
                <form onSubmit={handleUpdateUser} className="edit-user-form">
                  <h4>✏️ Editar Usuário</h4>
                  <div className="form-group">
                    <label>Nome:</label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Email:</label>
                    <input
                      type="email"
                      value={editForm.email}
                      onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Nova Senha (deixe em branco para manter):</label>
                    <input
                      type="password"
                      value={editForm.password}
                      onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                      minLength="6"
                      placeholder="Deixe em branco para não alterar"
                    />
                  </div>
                  <div className="edit-form-actions">
                    <ButtonSpinner type="submit" className="submit-btn" loading={loading}>
                      💾 Salvar
                    </ButtonSpinner>
                    <button type="button" onClick={() => setEditingUser(null)} className="cancel-btn">
                      ❌ Cancelar
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="user-info">
                    <h4>{user.name}</h4>
                    <p>{user.email}</p>
                    <small>Cadastrado: {new Date(user.created_at).toLocaleDateString()}</small>
                  </div>
                  <div className="user-actions">
                    <button
                      onClick={() => handleStartEdit(user)}
                      className="edit-btn"
                    >
                      ✏️ Editar
                    </button>
                    {user.email !== 'junior395@gmail.com' && (
                      <ButtonSpinner
                        onClick={() => handleRemoveUser(user.id, user.email)}
                        className="remove-btn"
                        loading={loading}
                      >
                        🗑️ Remover
                      </ButtonSpinner>
                    )}
                  </div>
                </>
              )}
            </div>
          ))
        )}
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
              onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
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
                  onClick={() => setCategoryForm({ ...categoryForm, icon })}
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
                  onClick={() => setCategoryForm({ ...categoryForm, color })}
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
            <div key={alert.id} className={`alert-item ${alert.overdue ? 'overdue' : 'due-soon'}`}>
              <div className="alert-info">
                <span className="alert-description">{alert.description}</span>
                <span className="alert-value">R$ {parseFloat(alert.value).toFixed(2)}</span>
              </div>
              <div className="alert-date">
                <span className={`alert-status ${alert.overdue ? 'overdue' : 'due-soon'}`}>
                  {alert.overdue ? '🔴 Vencida' : `🟡 Vence em ${alert.daysUntilDue} dia(s)`}
                </span>
                <span className="alert-due-date">{alert.nextDue}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="recent-transactions">
        <h3>📋 Últimas Transações</h3>
        {transactions.length === 0 ? (
          <p className="no-transactions">Nenhuma transação encontrada</p>
        ) : (
          transactions.slice(-5).reverse().map(transaction => (
            <div key={transaction.id} className={`transaction-item ${transaction.type}`}>
              <div className="transaction-info">
                <span className="transaction-icon">
                  {transaction.type === 'entrada' ? '💵' : '💸'}
                </span>
                <div className="transaction-details">
                  <span className="transaction-description">{transaction.description}</span>
                  <span className="transaction-category">🏷️ {transaction.category}</span>
                </div>
              </div>
              <div className="transaction-amount">
                <span className={`amount ${transaction.type}`}>
                  {transaction.type === 'entrada' ? '+' : '-'}R$ {parseFloat(transaction.value).toFixed(2)}
                </span>
                <span className="transaction-date">📅 {new Date(transaction.date).toLocaleDateString()}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
});

// Componente de Despesas Recorrentes
function DespesasRecorrentes({ expenses, onAdd, onDelete, onPay, onUpdate }) {
  const [form, setForm] = useState({
    description: '', value: '', category: '',
    recurrence: 'monthly', startDate: new Date().toISOString().slice(0, 10)
  });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [showAddForm, setShowAddForm] = useState(false);

  const recurrenceOptions = [
    { value: 'monthly', label: 'Mensal' },
    { value: 'bimonthly', label: 'Bimestral' },
    { value: 'quarterly', label: 'Trimestral' },
    { value: 'semiannual', label: 'Semestral' },
    { value: 'annual', label: 'Anual' },
    { value: 'fifth-business-day', label: 'Quinto Dia Útil' }
  ];
  const categorias = ['Alimentação', 'Transporte', 'Moradia', 'Saúde', 'Lazer', 'Outros'];
  const formatRec = (r) => recurrenceOptions.find(o => o.value === r)?.label || r;

  const getDueStatus = (nextDue) => {
    if (!nextDue) return { label: '—', cls: '' };
    const today = new Date();
    const due = new Date(nextDue + 'T00:00:00');
    const diff = Math.ceil((due - today) / 86400000);
    if (diff < 0) return { label: `Vencida há ${Math.abs(diff)}d`, cls: 'overdue' };
    if (diff === 0) return { label: 'Vence hoje!', cls: 'overdue' };
    if (diff <= 7) return { label: `Vence em ${diff}d`, cls: 'due-soon' };
    return { label: `${due.toLocaleDateString('pt-BR')}`, cls: 'ok' };
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.description || !form.value || !form.category) { toast.error('Preencha todos os campos!'); return; }
    if (parseFloat(form.value) <= 0) { toast.error('Valor deve ser maior que zero!'); return; }
    onAdd({ ...form, value: parseFloat(form.value) });
    setForm({ description: '', value: '', category: '', recurrence: 'monthly', startDate: new Date().toISOString().slice(0, 10) });
    setShowAddForm(false);
  };

  const startEdit = (exp) => {
    setEditingId(exp.id);
    setEditForm({
      description: exp.description,
      category: exp.category,
      value: exp.value,
      frequency: exp.frequency || exp.recurrence,
      next_due_date: exp.next_due_date || exp.nextDue,
      is_active: 1
    });
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    const ok = await onUpdate(editingId, editForm);
    if (ok) setEditingId(null);
  };

  return (
    <div className="recurring-expenses">
      <div className="section-header">
        <h2>🔄 Despesas Recorrentes</h2>
        <button className="add-user-btn" onClick={() => setShowAddForm(v => !v)}>
          {showAddForm ? '❌ Cancelar' : '➕ Nova Recorrente'}
        </button>
      </div>

      {showAddForm && (
        <div className="add-user-form">
          <h3>Nova Despesa Recorrente</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-grid-2">
              <div className="form-group">
                <label>Descrição</label>
                <input type="text" placeholder="Ex: Aluguel, Internet..." value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Valor (R$)</label>
                <input type="number" step="0.01" placeholder="0,00" value={form.value}
                  onChange={e => setForm({ ...form, value: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Categoria</label>
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} required>
                  <option value="">Selecione...</option>
                  {categorias.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Recorrência</label>
                <select value={form.recurrence} onChange={e => setForm({ ...form, recurrence: e.target.value })}>
                  {recurrenceOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Data de início</label>
                <input type="date" value={form.startDate}
                  onChange={e => setForm({ ...form, startDate: e.target.value })} required />
              </div>
            </div>
            <button type="submit" className="submit-btn">✅ Adicionar</button>
          </form>
        </div>
      )}

      <div className="recurring-list">
        {expenses.length === 0 ? (
          <p className="empty-message">Nenhuma despesa recorrente cadastrada</p>
        ) : (
          expenses.map(exp => {
            const dueKey = exp.next_due_date || exp.nextDue;
            const status = getDueStatus(dueKey);
            return (
              <div key={exp.id} className={`recurring-item ${status.cls}`}>
                {editingId === exp.id ? (
                  <form onSubmit={handleUpdate} className="edit-recurring-form">
                    <div className="form-grid-2">
                      <div className="form-group">
                        <label>Descrição</label>
                        <input type="text" value={editForm.description}
                          onChange={e => setEditForm({ ...editForm, description: e.target.value })} required />
                      </div>
                      <div className="form-group">
                        <label>Valor (R$)</label>
                        <input type="number" step="0.01" value={editForm.value}
                          onChange={e => setEditForm({ ...editForm, value: e.target.value })} required />
                      </div>
                      <div className="form-group">
                        <label>Categoria</label>
                        <select value={editForm.category} onChange={e => setEditForm({ ...editForm, category: e.target.value })}>
                          {categorias.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Recorrência</label>
                        <select value={editForm.frequency} onChange={e => setEditForm({ ...editForm, frequency: e.target.value })}>
                          {recurrenceOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Próximo Vencimento</label>
                        <input type="date" value={editForm.next_due_date}
                          onChange={e => setEditForm({ ...editForm, next_due_date: e.target.value })} required />
                      </div>
                    </div>
                    <div className="edit-form-actions">
                      <button type="submit" className="submit-btn">💾 Salvar</button>
                      <button type="button" className="cancel-btn" onClick={() => setEditingId(null)}>❌ Cancelar</button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="recurring-info">
                      <h4>{exp.description}</h4>
                      <p className="recurring-details">
                        <span className="category-badge">{exp.category}</span>
                        <span className="rec-badge">{formatRec(exp.frequency || exp.recurrence)}</span>
                      </p>
                      <span className={`due-badge ${status.cls}`}>{status.label}</span>
                    </div>
                    <div className="recurring-actions">
                      <span className="recurring-value">R$ {parseFloat(exp.value).toFixed(2)}</span>
                      <button className="pay-btn" onClick={() => onPay(exp)} title="Marcar como pago">✅ Pago</button>
                      <button className="edit-btn" onClick={() => startEdit(exp)} title="Editar">✏️</button>
                      <button className="delete-btn" onClick={() => onDelete(exp.id)} title="Excluir">🗑️</button>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}


// Componente Orçamentos
function Orcamentos({ budgets, transactions, categories, onAdd, onDelete }) {
  const [form, setForm] = useState({ category: '', limit_value: '', period: 'monthly' });
  const [showForm, setShowForm] = useState(false);

  // Categorias de despesa disponíveis (padrão + customizadas)
  const categoriasDesp = (categories?.despesa || [
    { id: 'alim', name: 'Alimentação' }, { id: 'trans', name: 'Transporte' },
    { id: 'mor', name: 'Moradia' }, { id: 'sau', name: 'Saúde' },
    { id: 'laz', name: 'Lazer' }, { id: 'out-desp', name: 'Outros' }
  ]);
  const categorias = categoriasDesp.map(c => c.name);
  const periodos = [{ value: 'monthly', label: 'Mensal' }, { value: 'annual', label: 'Anual' }];

  const now = new Date();

  // Retorna os IDs de categoria que correspondem ao nome do orçamento
  const getCatIds = (name) =>
    categoriasDesp.filter(c => c.name.toLowerCase() === name.toLowerCase()).map(c => c.id);

  const getSpent = (catName, period) => {
    const catIds = getCatIds(catName);
    return transactions
      .filter(t => {
        if (t.type !== 'despesa') return false;
        // Transpação armazena category como ID (ex: 'mor'); compara diretamente com os IDs do orçamento
        if (!catIds.includes(t.category)) return false;
        const d = new Date(t.date + (t.date.includes('T') ? '' : 'T00:00:00'));
        if (period === 'monthly') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        return d.getFullYear() === now.getFullYear();
      })
      .reduce((s, t) => s + parseFloat(t.value || 0), 0);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.category || !form.limit_value) { toast.error('Preencha todos os campos!'); return; }
    onAdd({ ...form, limit_value: parseFloat(form.limit_value) });
    setForm({ category: '', limit_value: '', period: 'monthly' });
    setShowForm(false);
  };

  return (
    <div className="orcamentos-section">
      <div className="section-header">
        <h2>📊 Orçamentos</h2>
        <button className="add-user-btn" onClick={() => setShowForm(v => !v)}>
          {showForm ? '❌ Cancelar' : '➕ Novo Orçamento'}
        </button>
      </div>

      {showForm && (
        <div className="add-user-form">
          <h3>Novo Orçamento</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-grid-2">
              <div className="form-group">
                <label>Categoria</label>
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} required>
                  <option value="">Selecione...</option>
                  {categoriasDesp.map(c => <option key={c.id} value={c.name}>{c.icon ? `${c.icon} ${c.name}` : c.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Limite (R$)</label>
                <input type="number" step="0.01" placeholder="0,00" value={form.limit_value}
                  onChange={e => setForm({ ...form, limit_value: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Período</label>
                <select value={form.period} onChange={e => setForm({ ...form, period: e.target.value })}>
                  {periodos.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            </div>
            <button type="submit" className="submit-btn">✅ Adicionar</button>
          </form>
        </div>
      )}

      <div className="budget-list">
        {budgets.length === 0 ? (
          <p className="empty-message">Nenhum orçamento cadastrado</p>
        ) : (
          budgets.map(b => {
            const spent = getSpent(b.category, b.period);
            const limit = parseFloat(b.limit_value);
            const pct = Math.min((spent / limit) * 100, 100);
            const overBudget = spent > limit;
            const catMeta = categoriasDesp.find(c => c.name.toLowerCase() === b.category.toLowerCase());
            return (
              <div key={b.id} className={`budget-card ${overBudget ? 'over-budget' : ''}`}>
                <div className="budget-header">
                  <div>
                    <h4>{catMeta?.icon ? `${catMeta.icon} ` : ''}{b.category}</h4>
                    <span className="period-badge">{periodos.find(p => p.value === b.period)?.label}</span>
                  </div>
                  <button className="delete-btn" onClick={() => onDelete(b.id)}>🗑️</button>
                </div>
                <div className="budget-amounts">
                  <span className={`spent ${overBudget ? 'text-danger' : ''}`}>Gasto: R$ {spent.toFixed(2)}</span>
                  <span className="limit">Limite: R$ {limit.toFixed(2)}</span>
                  <span className={`remaining ${overBudget ? 'text-danger' : 'text-success'}`}>
                    {overBudget ? `Excedido: R$ ${(spent - limit).toFixed(2)}` : `Restante: R$ ${(limit - spent).toFixed(2)}`}
                  </span>
                </div>
                <div className="budget-bar-wrap">
                  <div className="budget-bar" style={{ width: `${pct}%`, background: overBudget ? '#e74c3c' : pct > 80 ? '#f39c12' : '#2ecc71' }} />
                </div>
                <small style={{ color: overBudget ? '#e74c3c' : '#64748b' }}>{pct.toFixed(0)}% utilizado</small>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// Componente Contas (Carteiras)
function Contas({ wallets, onAdd, onUpdate, onDelete }) {
  const [form, setForm] = useState({ name: '', type: 'corrente', balance: '' });
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editBalance, setEditBalance] = useState('');

  const tipos = [
    { value: 'corrente', label: '🏦 Conta Corrente' },
    { value: 'poupanca', label: '💰 Poupança' },
    { value: 'investimento', label: '📈 Investimento' },
    { value: 'carteira', label: '👛 Carteira' }
  ];

  const totalBalance = wallets.reduce((s, w) => s + parseFloat(w.balance || 0), 0);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name) { toast.error('Informe o nome da conta!'); return; }
    onAdd({ ...form, balance: parseFloat(form.balance || 0) });
    setForm({ name: '', type: 'corrente', balance: '' });
    setShowForm(false);
  };

  const handleUpdateBalance = (e) => {
    e.preventDefault();
    onUpdate(editingId, { balance: parseFloat(editBalance) });
    setEditingId(null);
  };

  return (
    <div className="contas-section">
      <div className="section-header">
        <h2>🏦 Contas e Carteiras</h2>
        <button className="add-user-btn" onClick={() => setShowForm(v => !v)}>
          {showForm ? '❌ Cancelar' : '➕ Nova Conta'}
        </button>
      </div>

      <div className="total-balance-card">
        <span>Saldo Total</span>
        <strong className={totalBalance >= 0 ? 'text-success' : 'text-danger'}>R$ {totalBalance.toFixed(2)}</strong>
      </div>

      {showForm && (
        <div className="add-user-form">
          <h3>Nova Conta</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-grid-2">
              <div className="form-group">
                <label>Nome</label>
                <input type="text" placeholder="Ex: Nubank, Caixa..." value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Tipo</label>
                <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                  {tipos.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Saldo Inicial (R$)</label>
                <input type="number" step="0.01" placeholder="0,00" value={form.balance}
                  onChange={e => setForm({ ...form, balance: e.target.value })} />
              </div>
            </div>
            <button type="submit" className="submit-btn">✅ Adicionar</button>
          </form>
        </div>
      )}

      <div className="wallet-list">
        {wallets.length === 0 ? (
          <p className="empty-message">Nenhuma conta cadastrada</p>
        ) : (
          wallets.map(w => (
            <div key={w.id} className="wallet-card">
              <div className="wallet-info">
                <span className="wallet-icon">{tipos.find(t => t.value === w.type)?.label?.split(' ')[0] || '💳'}</span>
                <div>
                  <h4>{w.name}</h4>
                  <small>{tipos.find(t => t.value === w.type)?.label?.split(' ').slice(1).join(' ') || w.type}</small>
                </div>
              </div>
              <div className="wallet-balance">
                {editingId === w.id ? (
                  <form onSubmit={handleUpdateBalance} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input type="number" step="0.01" value={editBalance}
                      onChange={e => setEditBalance(e.target.value)}
                      style={{ width: '100px', padding: '4px 8px', borderRadius: '6px', border: '1px solid #ccc' }} />
                    <button type="submit" className="submit-btn" style={{ padding: '4px 10px' }}>💾</button>
                    <button type="button" className="cancel-btn" style={{ padding: '4px 10px' }} onClick={() => setEditingId(null)}>✕</button>
                  </form>
                ) : (
                  <>
                    <span className={`balance-value ${parseFloat(w.balance) >= 0 ? 'text-success' : 'text-danger'}`}>
                      R$ {parseFloat(w.balance || 0).toFixed(2)}
                    </span>
                    <button className="edit-btn" onClick={() => { setEditingId(w.id); setEditBalance(w.balance); }} title="Editar saldo">✏️</button>
                    <button className="delete-btn" onClick={() => onDelete(w.id)} title="Excluir">🗑️</button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Componente Metas
function Metas({ goals, onAdd, onUpdate, onDelete }) {
  const [form, setForm] = useState({ name: '', target_amount: '', current_amount: '0', deadline: '', category: '' });
  const [showForm, setShowForm] = useState(false);
  const [contributionId, setContributionId] = useState(null);
  const [contribution, setContribution] = useState('');

  const categorias = ['Viagem', 'Reserva de Emergência', 'Imóvel', 'Veículo', 'Educação', 'Outros'];

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name || !form.target_amount) { toast.error('Informe o nome e valor alvo!'); return; }
    onAdd({ ...form, target_amount: parseFloat(form.target_amount), current_amount: parseFloat(form.current_amount || 0) });
    setForm({ name: '', target_amount: '', current_amount: '0', deadline: '', category: '' });
    setShowForm(false);
  };

  const handleContribution = (e, goal) => {
    e.preventDefault();
    const newAmt = parseFloat(goal.current_amount || 0) + parseFloat(contribution || 0);
    onUpdate(goal.id, { ...goal, current_amount: newAmt });
    setContributionId(null);
    setContribution('');
  };

  return (
    <div className="metas-section">
      <div className="section-header">
        <h2>🎯 Metas Financeiras</h2>
        <button className="add-user-btn" onClick={() => setShowForm(v => !v)}>
          {showForm ? '❌ Cancelar' : '➕ Nova Meta'}
        </button>
      </div>

      {showForm && (
        <div className="add-user-form">
          <h3>Nova Meta</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-grid-2">
              <div className="form-group">
                <label>Nome da Meta</label>
                <input type="text" placeholder="Ex: Viagem para Europa" value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Valor Alvo (R$)</label>
                <input type="number" step="0.01" placeholder="0,00" value={form.target_amount}
                  onChange={e => setForm({ ...form, target_amount: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Valor Atual (R$)</label>
                <input type="number" step="0.01" placeholder="0,00" value={form.current_amount}
                  onChange={e => setForm({ ...form, current_amount: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Prazo</label>
                <input type="date" value={form.deadline}
                  onChange={e => setForm({ ...form, deadline: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Categoria</label>
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                  <option value="">Selecione...</option>
                  {categorias.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <button type="submit" className="submit-btn">✅ Criar Meta</button>
          </form>
        </div>
      )}

      <div className="goals-list">
        {goals.length === 0 ? (
          <p className="empty-message">Nenhuma meta cadastrada</p>
        ) : (
          goals.map(g => {
            const current = parseFloat(g.current_amount || 0);
            const target = parseFloat(g.target_amount);
            const pct = Math.min((current / target) * 100, 100);
            const completed = current >= target;
            return (
              <div key={g.id} className={`goal-card ${completed ? 'completed' : ''}`}>
                <div className="goal-header">
                  <div>
                    <h4>{completed ? '✅ ' : ''}{g.name}</h4>
                    {g.category && <span className="period-badge">{g.category}</span>}
                    {g.deadline && <small> • Prazo: {new Date(g.deadline + 'T00:00:00').toLocaleDateString('pt-BR')}</small>}
                  </div>
                  <button className="delete-btn" onClick={() => onDelete(g.id)}>🗑️</button>
                </div>
                <div className="goal-amounts">
                  <span>R$ {current.toFixed(2)} / R$ {target.toFixed(2)}</span>
                  <span className="pct-badge">{pct.toFixed(0)}%</span>
                </div>
                <div className="goal-bar-wrap">
                  <div className="goal-bar" style={{ width: `${pct}%`, background: completed ? '#2ecc71' : pct >= 75 ? '#27ae60' : pct >= 40 ? '#3498db' : '#e67e22' }} />
                </div>
                {!completed && (
                  <div className="contribution-area">
                    {contributionId === g.id ? (
                      <form onSubmit={e => handleContribution(e, g)} style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                        <input type="number" step="0.01" placeholder="Valor contribuição" value={contribution}
                          onChange={e => setContribution(e.target.value)}
                          style={{ flex: 1, padding: '5px 10px', borderRadius: '6px', border: '1px solid #ccc' }} />
                        <button type="submit" className="submit-btn" style={{ padding: '5px 12px' }}>✅</button>
                        <button type="button" className="cancel-btn" style={{ padding: '5px 12px' }} onClick={() => setContributionId(null)}>✕</button>
                      </form>
                    ) : (
                      <button className="pay-btn" style={{ marginTop: '8px' }} onClick={() => { setContributionId(g.id); setContribution(''); }}>
                        ➕ Adicionar Contribuição
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// Formulário de lançamento otimizado
const LancamentoForm = React.memo(({ type, onAdd, title, categories, isApiAvailable }) => {
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

    if (!isApiAvailable) {
      toast.error('Conexão com servidor necessária para adicionar transações!');
      return;
    }

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
  }, [form, type, onAdd, isApiAvailable]);

  return (
    <div className={`lancamento-form ${!isApiAvailable ? 'disabled' : ''}`}>
      <h2>{title}</h2>

      {!isApiAvailable && (
        <div className="offline-warning">
          <p>⚠️ Conexão com servidor necessária para adicionar transações</p>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Descrição:</label>
          <input
            type="text"
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            placeholder="Ex: Salário, Supermercado..."
            disabled={!isApiAvailable}
            required
          />
        </div>

        <div className="form-group">
          <label>Valor:</label>
          <input
            type="number"
            step="0.01"
            value={form.value}
            onChange={e => setForm({ ...form, value: e.target.value })}
            placeholder="0.00"
            disabled={!isApiAvailable}
            required
          />
        </div>

        <div className="form-group">
          <label>Categoria:</label>
          <select
            value={form.category}
            onChange={e => setForm({ ...form, category: e.target.value })}
            disabled={!isApiAvailable}
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
            onChange={e => setForm({ ...form, date: e.target.value })}
            disabled={!isApiAvailable}
            required
          />
        </div>

        <button
          type="submit"
          className="submit-btn"
          disabled={!isApiAvailable}
        >
          {!isApiAvailable
            ? 'Servidor Offline'
            : `Lançar ${type === 'entrada' ? 'Entrada' : 'Despesa'}`
          }
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
const Historico = React.memo(({ transactions, onDelete, onUpdate, isApiAvailable, categories }) => {
  const [filter, setFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ type: '', description: '', category: '', value: '', date: '' });

  // Implementar debounce na busca
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // Categorias disponíveis para o tipo selecionado
  const editCategoryOptions = useMemo(() =>
    (categories?.[editForm.type] || []),
    [categories, editForm.type]
  );

  const startEdit = (transaction) => {
    setEditingId(transaction.id);
    setEditForm({
      type: transaction.type,
      description: transaction.description,
      category: transaction.category,
      value: transaction.value,
      date: transaction.date
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ type: '', description: '', category: '', value: '', date: '' });
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    if (!editForm.description || !editForm.value || !editForm.category || !editForm.date) {
      toast.error('Preencha todos os campos!');
      return;
    }
    const success = await onUpdate(editingId, { ...editForm, value: parseFloat(editForm.value) });
    if (success) cancelEdit();
  };

  // Otimizar filtros com useMemo incluindo busca e validação de usuário
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
            {editingId === transaction.id ? (
              <form onSubmit={handleUpdate} className="edit-transaction-form">
                <div className="edit-transaction-grid">
                  <select
                    value={editForm.type}
                    onChange={e => setEditForm({ ...editForm, type: e.target.value, category: '' })}
                    required
                  >
                    <option value="entrada">Entrada</option>
                    <option value="despesa">Despesa</option>
                  </select>
                  <input
                    type="text"
                    value={editForm.description}
                    onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                    placeholder="Descrição"
                    required
                  />
                  <select
                    value={editForm.category}
                    onChange={e => setEditForm({ ...editForm, category: e.target.value })}
                    required
                  >
                    <option value="">Categoria</option>
                    {editCategoryOptions.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.value}
                    onChange={e => setEditForm({ ...editForm, value: e.target.value })}
                    placeholder="Valor"
                    required
                  />
                  <input
                    type="date"
                    value={editForm.date}
                    onChange={e => setEditForm({ ...editForm, date: e.target.value })}
                    required
                  />
                </div>
                <div className="edit-form-actions">
                  <button type="submit" className="submit-btn">💾 Salvar</button>
                  <button type="button" className="cancel-btn" onClick={cancelEdit}>❌ Cancelar</button>
                </div>
              </form>
            ) : (
              <>
                <div className="transaction-info">
                  <h4>{transaction.description}</h4>
                  <p>{transaction.category}</p>
                  <span className="date">{new Date(transaction.date).toLocaleDateString('pt-BR')}</span>
                </div>
                <div className="transaction-value">
                  <span className={`value ${transaction.type}`}>
                    {transaction.type === 'entrada' ? '+' : '-'}R$ {parseFloat(transaction.value).toFixed(2)}
                  </span>
                  <div className="transaction-btns">
                    {isApiAvailable && (
                      <button
                        onClick={() => startEdit(transaction)}
                        className="edit-btn"
                        title="Editar transação"
                      >
                        ✏️
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (!isApiAvailable) {
                          alert('Conexão com servidor necessária para excluir transações.');
                          return;
                        }
                        if (window.confirm(`Deseja realmente excluir "${transaction.description}"?`)) {
                          onDelete(transaction.id);
                        }
                      }}
                      className={`delete-btn ${!isApiAvailable ? 'disabled' : ''}`}
                      disabled={!isApiAvailable}
                      title={!isApiAvailable ? 'Servidor offline' : `Excluir "${transaction.description}"`}
                    >
                      {!isApiAvailable ? '🚫' : '🗑️'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});

export default App;
