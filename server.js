const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const app = express();
const port = process.env.PORT || 10000;

// Inicializar banco SQLite
const db = new sqlite3.Database(process.env.DATABASE_URL || './database.db', (err) => {
  if (err) {
    console.error('❌ Erro ao conectar ao banco de dados:', err);
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

    // Criar índices para melhor performance
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_transactions_userid ON transactions(userId)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date)`);

    console.log('✅ Banco SQLite inicializado com sucesso!');
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

// Função para criar usuário admin
async function createAdminUser() {
  try {
    const result = await dbGet('SELECT id FROM users WHERE email = ?', ['junior395@gmail.com']);

    if (!result) {
      await dbRun(
        'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
        ['Administrador', 'junior395@gmail.com', 'j991343519*/*']
      );
      console.log('👑 Usuário admin criado com sucesso!');
    } else {
      console.log('👑 Usuário admin já existe');
    }
  } catch (error) {
    console.error('Erro ao verificar/criar admin:', error);
  }
}

// Criar usuário admin após inicialização
setTimeout(() => createAdminUser(), 2000);

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
    const result = await dbAll('SELECT id, name, email FROM users');
    res.json(result);
  } catch (error) {
    console.error('Erro ao buscar usuários:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`🚀 API do Gestor Financeiro rodando em http://localhost:${port}`);
  console.log(`📊 Backend iniciado com sucesso!`);
});
