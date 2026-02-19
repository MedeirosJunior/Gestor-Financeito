const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 10000;

// Determinar caminho do banco de dados
let dbPath;
const databaseUrl = process.env.DATABASE_URL;

// Verificar se DATABASE_URL é uma URL de banco de dados (PostgreSQL, MySQL, etc) ou caminho local
const isExternalDbUrl = databaseUrl && (databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://') || databaseUrl.includes('://'));

if (isExternalDbUrl) {
  // DATABASE_URL contém URL de banco externo, usar SQLite em /tmp
  dbPath = '/tmp/database.db';
} else if (databaseUrl) {
  // DATABASE_URL contém caminho local
  dbPath = databaseUrl;
} else if (process.env.NODE_ENV === 'production') {
  // Em produção sem DATABASE_URL, usar /tmp
  dbPath = '/tmp/database.db';
} else {
  // Em desenvolvimento, usar ./data
  dbPath = './data/database.db';
  // Criar diretório data se não existir
  if (!fs.existsSync('./data')) {
    fs.mkdirSync('./data', { recursive: true });
  }
}

console.log(`📂 Banco SQLite será armazenado em: ${dbPath}`);

// Inicializar banco SQLite
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Erro ao conectar ao banco de dados:', err);
    process.exit(1);
  } else {
    console.log('✅ Conectado ao banco SQLite com sucesso!');
  }
});

// Habilitar foreign keys no SQLite
db.run('PRAGMA foreign_keys = ON');

// Wrappers para Promise-based queries
const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

// Configurar CORS
const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    'https://gestor-financeito.netlify.app',
    'https://gestor-financeito.vercel.app',
    'https://spiffy-bonbon-c3c559.netlify.app',
    process.env.FRONTEND_URL
  ].filter(Boolean),
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());

// Rota de health check para API
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Gestor Financeiro API funcionando!',
    timestamp: new Date().toISOString(),
    database: 'SQLite'
  });
});

// Inicializar banco de dados SQLite
const initializeDatabase = async () => {
  try {
    console.log('🔄 Inicializando banco SQLite...');

    // Criar tabela de usuários
    await dbRun(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Criar tabela de transações
    await dbRun(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        value REAL NOT NULL,
        date DATE NOT NULL,
        userId TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Criar tabela de categorias personalizadas
    await dbRun(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        icon TEXT,
        color TEXT,
        custom INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(userId, name, type)
      )
    `);

    // Criar tabela de despesas recorrentes
    await dbRun(`
      CREATE TABLE IF NOT EXISTS recurring_expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        value REAL NOT NULL,
        frequency TEXT NOT NULL,
        next_due_date DATE NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Criar tabela de orçamentos
    await dbRun(`
      CREATE TABLE IF NOT EXISTS budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT NOT NULL,
        category TEXT NOT NULL,
        limit_value REAL NOT NULL,
        period TEXT NOT NULL,
        period_month TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(userId, category, period, period_month)
      )
    `);

    // Criar tabela de contas/carteiras
    await dbRun(`
      CREATE TABLE IF NOT EXISTS wallets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        balance REAL DEFAULT 0,
        currency TEXT DEFAULT 'BRL',
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(userId, name)
      )
    `);

    // Criar tabela de metas financeiras
    await dbRun(`
      CREATE TABLE IF NOT EXISTS goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT NOT NULL,
        name TEXT NOT NULL,
        target_amount REAL NOT NULL,
        current_amount REAL DEFAULT 0,
        deadline DATE,
        category TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Criar índices para melhor performance
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_transactions_userid ON transactions(userId)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_categories_userid ON categories(userId)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_recurring_userid ON recurring_expenses(userId)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_budgets_userid ON budgets(userId)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_wallets_userid ON wallets(userId)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_goals_userid ON goals(userId)`);

    console.log('✅ Banco SQLite inicializado com sucesso!');

    // Criar usuário admin se não existir
    try {
      const adminExists = await dbGet('SELECT id FROM users WHERE email = ?', ['junior395@gmail.com']);

      if (!adminExists) {
        await dbRun(
          'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
          ['Administrador', 'junior395@gmail.com', 'j991343519*/*']
        );
        console.log('👑 Usuário admin criado com sucesso!');
      } else {
        console.log('👑 Usuário admin já existe');
      }
    } catch (adminError) {
      console.error('Erro ao criar/verificar admin:', adminError.message);
    }

  } catch (error) {
    console.error('❌ Erro ao inicializar banco:', error);
    throw error;
  }
};

// Backup automático para SQLite
const backupData = async () => {
  try {
    const users = await dbAll('SELECT * FROM users');
    const transactions = await dbAll('SELECT * FROM transactions');

    const backup = {
      timestamp: new Date().toISOString(),
      users: users,
      transactions: transactions
    };

    console.log('✅ Backup SQLite criado:', new Date().toLocaleString(),
      `- ${backup.users.length} usuários, ${backup.transactions.length} transações`);
  } catch (error) {
    console.error('❌ Erro no backup SQLite:', error);
  }
};

// Inicializar banco de dados
initializeDatabase().catch(error => {
  console.error('❌ Falha crítica na inicialização do banco:', error);
  process.exit(1);
});

// Rotas para transações
app.get('/transactions', async (req, res) => {
  const { userId } = req.query;

  if (!userId || userId === 'undefined') {
    return res.status(400).json({ error: 'userId é obrigatório' });
  }

  try {
    const result = await dbAll(
      'SELECT * FROM transactions WHERE userId = ? ORDER BY date DESC, created_at DESC',
      [userId]
    );
    res.json(result);
  } catch (error) {
    console.error('Erro ao buscar transações:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/transactions', async (req, res) => {
  const { type, description, category, value, date, userId } = req.body;

  if (!type || !description || !category || !value || !date || !userId) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }

  try {
    const result = await dbRun(
      'INSERT INTO transactions (type, description, category, value, date, userId) VALUES (?, ?, ?, ?, ?, ?)',
      [type, description, category, value, date, userId]
    );

    // Fazer backup após inserção
    setTimeout(() => backupData(), 100);

    res.json({
      id: result.id,
      message: 'Transação criada com sucesso'
    });
  } catch (error) {
    console.error('Erro ao criar transação:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/transactions/:id', async (req, res) => {
  const { id } = req.params;
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'ID do usuário é obrigatório' });
  }

  try {
    // Verificar se a transação pertence ao usuário
    const checkResult = await dbGet(
      'SELECT userId FROM transactions WHERE id = ?',
      [id]
    );

    if (!checkResult) {
      return res.status(404).json({ error: 'Transação não encontrada' });
    }

    if (checkResult.userId !== userId) {
      return res.status(403).json({ error: 'Você não tem permissão para deletar esta transação' });
    }

    // Deletar a transação
    const deleteResult = await dbRun('DELETE FROM transactions WHERE id = ?', [id]);

    if (deleteResult.changes === 0) {
      return res.status(404).json({ error: 'Transação não encontrada' });
    }

    // Fazer backup após exclusão
    setTimeout(() => backupData(), 100);

    res.json({ message: 'Transação deletada com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar transação:', error);
    res.status(500).json({ error: error.message });
  }
});

// Rotas de autenticação
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios' });
  }

  console.log('Tentativa de login:', { email, password }); // Log para debug

  try {
    const result = await dbGet(
      'SELECT id, name, email FROM users WHERE email = ? AND password = ?',
      [email, password]
    );

    console.log('Resultado da consulta:', result); // Log para debug

    if (!result) {
      return res.status(401).json({ error: 'Email ou senha inválidos' });
    }

    res.json({
      message: 'Login realizado com sucesso',
      user: {
        id: result.id,
        name: result.name,
        email: result.email
      }
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: error.message });
  }
});

// Rotas administrativas
app.post('/admin/register-user', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
  }

  try {
    // Verificar se email já existe
    const checkResult = await dbGet('SELECT id FROM users WHERE email = ?', [email]);

    if (checkResult) {
      return res.status(400).json({ error: 'Email já cadastrado' });
    }

    // Criar usuário
    const result = await dbRun(
      'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      [name, email, password]
    );

    res.json({
      message: 'Usuário criado com sucesso',
      userId: result.id
    });
  } catch (error) {
    console.error('Erro ao criar usuário:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/admin/users', async (req, res) => {
  try {
    const result = await dbAll('SELECT id, name, email, created_at FROM users ORDER BY created_at DESC');
    res.json(result);
  } catch (error) {
    console.error('Erro ao buscar usuários:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/admin/users/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Verificar se usuário existe
    const checkResult = await dbGet('SELECT id FROM users WHERE id = ?', [id]);

    if (!checkResult) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    // Deletar o usuário
    await dbRun('DELETE FROM users WHERE id = ?', [id]);

    res.json({ message: 'Usuário deletado com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar usuário:', error);
    res.status(500).json({ error: error.message });
  }
});

// Rota para administradores verem todas as transações
app.get('/admin/all-transactions', async (req, res) => {
  try {
    const result = await dbAll(`
      SELECT 
        t.*,
        u.name as userName,
        u.email as userEmail
      FROM transactions t
      JOIN users u ON t.userId = u.email
      ORDER BY t.date DESC, t.created_at DESC
    `);
    res.json(result);
  } catch (error) {
    console.error('Erro ao buscar todas as transações:', error);
    res.status(500).json({ error: error.message });
  }
});

// Rota para estatísticas gerais (admin)
app.get('/admin/stats', async (req, res) => {
  try {
    const usersResult = await dbGet('SELECT COUNT(*) as totalUsers FROM users');
    const transactionsResult = await dbGet('SELECT COUNT(*) as totalTransactions FROM transactions');
    const totalsResult = await dbAll('SELECT type, SUM(value) as total FROM transactions GROUP BY type');

    const totals = {};
    totalsResult.forEach(row => {
      totals[row.type] = parseFloat(row.total);
    });

    const stats = {
      totalUsers: usersResult.totalUsers,
      totalTransactions: transactionsResult.totalTransactions,
      ...totals
    };

    res.json(stats);
  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    res.status(500).json({ error: error.message });
  }
});

// Rota para verificar usuários cadastrados (debug)
app.get('/debug/users', async (req, res) => {
  try {
    const result = await dbAll('SELECT id, name, email, password FROM users');
    res.json({
      total: result.length,
      users: result
    });
  } catch (error) {
    console.error('Erro ao buscar usuários:', error);
    res.status(500).json({ error: error.message });
  }
});

// Rota para inicializar/recriar usuário admin (debug)
app.post('/debug/init-admin', async (req, res) => {
  try {
    // Deletar usuário admin existente
    await dbRun('DELETE FROM users WHERE email = ?', ['junior395@gmail.com']);

    // Criar novo usuário admin
    await dbRun(
      'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      ['Administrador', 'junior395@gmail.com', 'j991343519*/*']
    );

    console.log('👑 Usuário admin reiniciado com sucesso!');
    res.json({
      message: 'Usuário admin criado com sucesso',
      user: {
        email: 'junior395@gmail.com',
        password: 'j991343519*/*'
      }
    });
  } catch (error) {
    console.error('Erro ao criar admin:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ ROTAS DE CATEGORIAS ============
app.get('/categories', async (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'userId é obrigatório' });
  }
  try {
    const result = await dbAll('SELECT * FROM categories WHERE userId = ? ORDER BY type, name', [userId]);
    res.json(result);
  } catch (error) {
    console.error('Erro ao buscar categorias:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/categories', async (req, res) => {
  const { userId, name, type, icon, color } = req.body;
  if (!userId || !name || !type) {
    return res.status(400).json({ error: 'userId, name e type são obrigatórios' });
  }
  try {
    const result = await dbRun(
      'INSERT INTO categories (userId, name, type, icon, color) VALUES (?, ?, ?, ?, ?)',
      [userId, name, type, icon || '💰', color || '#6b7280']
    );
    res.json({ id: result.id, message: 'Categoria criada com sucesso' });
  } catch (error) {
    console.error('Erro ao criar categoria:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/categories/:id', async (req, res) => {
  const { id } = req.params;
  const { name, icon, color } = req.body;
  try {
    await dbRun('UPDATE categories SET name = ?, icon = ?, color = ? WHERE id = ?', [name, icon, color, id]);
    res.json({ message: 'Categoria atualizada com sucesso' });
  } catch (error) {
    console.error('Erro ao atualizar categoria:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/categories/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun('DELETE FROM categories WHERE id = ?', [id]);
    res.json({ message: 'Categoria deletada com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar categoria:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ ROTAS DE DESPESAS RECORRENTES ============
app.get('/recurring-expenses', async (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'userId é obrigatório' });
  }
  try {
    const result = await dbAll('SELECT * FROM recurring_expenses WHERE userId = ? AND is_active = 1 ORDER BY next_due_date', [userId]);
    res.json(result);
  } catch (error) {
    console.error('Erro ao buscar despesas recorrentes:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/recurring-expenses', async (req, res) => {
  const { userId, description, category, value, frequency, next_due_date } = req.body;
  if (!userId || !description || !category || !value || !frequency || !next_due_date) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }
  try {
    const result = await dbRun(
      'INSERT INTO recurring_expenses (userId, description, category, value, frequency, next_due_date) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, description, category, value, frequency, next_due_date]
    );
    res.json({ id: result.id, message: 'Despesa recorrente criada com sucesso' });
  } catch (error) {
    console.error('Erro ao criar despesa recorrente:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/recurring-expenses/:id', async (req, res) => {
  const { id } = req.params;
  const { description, category, value, frequency, next_due_date, is_active } = req.body;
  try {
    await dbRun(
      'UPDATE recurring_expenses SET description = ?, category = ?, value = ?, frequency = ?, next_due_date = ?, is_active = ? WHERE id = ?',
      [description, category, value, frequency, next_due_date, is_active ?? 1, id]
    );
    res.json({ message: 'Despesa recorrente atualizada com sucesso' });
  } catch (error) {
    console.error('Erro ao atualizar despesa recorrente:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/recurring-expenses/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun('DELETE FROM recurring_expenses WHERE id = ?', [id]);
    res.json({ message: 'Despesa recorrente deletada com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar despesa recorrente:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ ROTAS DE ORÇAMENTOS ============
app.get('/budgets', async (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'userId é obrigatório' });
  }
  try {
    const result = await dbAll('SELECT * FROM budgets WHERE userId = ? AND is_active = 1 ORDER BY category', [userId]);
    res.json(result);
  } catch (error) {
    console.error('Erro ao buscar orçamentos:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/budgets', async (req, res) => {
  const { userId, category, limit_value, period, period_month } = req.body;
  if (!userId || !category || !limit_value || !period) {
    return res.status(400).json({ error: 'userId, category, limit_value e period são obrigatórios' });
  }
  try {
    const result = await dbRun(
      'INSERT INTO budgets (userId, category, limit_value, period, period_month) VALUES (?, ?, ?, ?, ?)',
      [userId, category, limit_value, period, period_month || null]
    );
    res.json({ id: result.id, message: 'Orçamento criado com sucesso' });
  } catch (error) {
    console.error('Erro ao criar orçamento:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/budgets/:id', async (req, res) => {
  const { id } = req.params;
  const { limit_value, period, period_month, is_active } = req.body;
  try {
    await dbRun(
      'UPDATE budgets SET limit_value = ?, period = ?, period_month = ?, is_active = ? WHERE id = ?',
      [limit_value, period, period_month, is_active ?? 1, id]
    );
    res.json({ message: 'Orçamento atualizado com sucesso' });
  } catch (error) {
    console.error('Erro ao atualizar orçamento:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/budgets/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun('DELETE FROM budgets WHERE id = ?', [id]);
    res.json({ message: 'Orçamento deletado com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar orçamento:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ ROTAS DE CARTEIRAS ============
app.get('/wallets', async (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'userId é obrigatório' });
  }
  try {
    const result = await dbAll('SELECT * FROM wallets WHERE userId = ? AND is_active = 1 ORDER BY name', [userId]);
    res.json(result);
  } catch (error) {
    console.error('Erro ao buscar carteiras:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/wallets', async (req, res) => {
  const { userId, name, type, balance, currency } = req.body;
  if (!userId || !name || !type) {
    return res.status(400).json({ error: 'userId, name e type são obrigatórios' });
  }
  try {
    const result = await dbRun(
      'INSERT INTO wallets (userId, name, type, balance, currency) VALUES (?, ?, ?, ?, ?)',
      [userId, name, type, balance || 0, currency || 'BRL']
    );
    res.json({ id: result.id, message: 'Carteira criada com sucesso' });
  } catch (error) {
    console.error('Erro ao criar carteira:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/wallets/:id', async (req, res) => {
  const { id } = req.params;
  const { name, balance, is_active } = req.body;
  try {
    await dbRun('UPDATE wallets SET name = ?, balance = ?, is_active = ? WHERE id = ?', [name, balance, is_active ?? 1, id]);
    res.json({ message: 'Carteira atualizada com sucesso' });
  } catch (error) {
    console.error('Erro ao atualizar carteira:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/wallets/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun('DELETE FROM wallets WHERE id = ?', [id]);
    res.json({ message: 'Carteira deletada com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar carteira:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ ROTAS DE METAS ============
app.get('/goals', async (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'userId é obrigatório' });
  }
  try {
    const result = await dbAll('SELECT * FROM goals WHERE userId = ? AND is_active = 1 ORDER BY deadline', [userId]);
    res.json(result);
  } catch (error) {
    console.error('Erro ao buscar metas:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/goals', async (req, res) => {
  const { userId, name, target_amount, current_amount, deadline, category } = req.body;
  if (!userId || !name || !target_amount) {
    return res.status(400).json({ error: 'userId, name e target_amount são obrigatórios' });
  }
  try {
    const result = await dbRun(
      'INSERT INTO goals (userId, name, target_amount, current_amount, deadline, category) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, name, target_amount, current_amount || 0, deadline || null, category || null]
    );
    res.json({ id: result.id, message: 'Meta criada com sucesso' });
  } catch (error) {
    console.error('Erro ao criar meta:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/goals/:id', async (req, res) => {
  const { id } = req.params;
  const { name, target_amount, current_amount, deadline, category, is_active } = req.body;
  try {
    await dbRun(
      'UPDATE goals SET name = ?, target_amount = ?, current_amount = ?, deadline = ?, category = ?, is_active = ? WHERE id = ?',
      [name, target_amount, current_amount, deadline, category, is_active ?? 1, id]
    );
    res.json({ message: 'Meta atualizada com sucesso' });
  } catch (error) {
    console.error('Erro ao atualizar meta:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/goals/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun('DELETE FROM goals WHERE id = ?', [id]);
    res.json({ message: 'Meta deletada com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar meta:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`🚀 API do Gestor Financeiro rodando em http://localhost:${port}`);
  console.log(`📊 Backend iniciado com sucesso!`);
});
