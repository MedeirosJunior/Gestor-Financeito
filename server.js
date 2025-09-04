const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const app = express();
const port = process.env.PORT || 3001;

// Configurar CORS para permitir frontend separado
const corsOptions = {
  origin: [
    'http://localhost:3000',
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
    database: process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite (fallback)'
  });
});

// Configurar conexão com PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Inicializar banco de dados PostgreSQL
const initializeDatabase = async () => {
  try {
    console.log('🔄 Inicializando banco PostgreSQL...');
    
    // Criar tabela de usuários
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Criar tabela de transações
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        type VARCHAR(50) NOT NULL,
        description TEXT NOT NULL,
        category VARCHAR(100) NOT NULL,
        value DECIMAL(10,2) NOT NULL,
        date DATE NOT NULL,
        "userId" VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Criar índices para melhor performance
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_transactions_userid ON transactions("userId")`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date)`);
    
    console.log('✅ Banco PostgreSQL inicializado com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao inicializar banco:', error);
    throw error;
  }
};

// Backup automático para PostgreSQL
const backupData = async () => {
  try {
    const users = await pool.query('SELECT * FROM users');
    const transactions = await pool.query('SELECT * FROM transactions');
    
    const backup = {
      timestamp: new Date().toISOString(),
      users: users.rows,
      transactions: transactions.rows
    };
    
    console.log('✅ Backup PostgreSQL criado:', new Date().toLocaleString(), 
                `- ${backup.users.length} usuários, ${backup.transactions.length} transações`);
  } catch (error) {
    console.error('❌ Erro no backup PostgreSQL:', error);
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
    const result = await pool.query('SELECT id FROM users WHERE email = $1', ['admin@gestor.com']);
    
    if (result.rows.length === 0) {
      await pool.query(
        'INSERT INTO users (name, email, password) VALUES ($1, $2, $3)',
        ['Administrador', 'admin@gestor.com', 'j92953793*/*']
      );
      console.log('👑 Usuário admin criado com sucesso!');
      console.log('📧 Email: admin@gestor.com');
      console.log('🔑 Senha: j92953793*/*');
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
    const result = await pool.query(
      'SELECT * FROM transactions WHERE "userId" = $1 ORDER BY date DESC, created_at DESC', 
      [userId]
    );
    res.json(result.rows);
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
    const result = await pool.query(
      'INSERT INTO transactions (type, description, category, value, date, "userId") VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [type, description, category, value, date, userId]
    );
    
    // Fazer backup após inserção
    setTimeout(() => backupData(), 100);
    
    res.json({ 
      id: result.rows[0].id,
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
    const checkResult = await pool.query(
      'SELECT "userId" FROM transactions WHERE id = $1', 
      [id]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Transação não encontrada' });
    }
    
    if (checkResult.rows[0].userId !== userId) {
      return res.status(403).json({ error: 'Você não tem permissão para deletar esta transação' });
    }
    
    // Deletar a transação
    const deleteResult = await pool.query('DELETE FROM transactions WHERE id = $1', [id]);
    
    if (deleteResult.rowCount === 0) {
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
    const result = await pool.query(
      'SELECT id, name, email FROM users WHERE email = $1 AND password = $2',
      [email, password]
    );
    
    console.log('Resultado da consulta:', result.rows); // Log para debug
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Email ou senha inválidos' });
    }
    
    const user = result.rows[0];
    
    res.json({
      message: 'Login realizado com sucesso',
      user: {
        id: user.id,
        name: user.name,
        email: user.email
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
    const checkResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    
    if (checkResult.rows.length > 0) {
      return res.status(400).json({ error: 'Email já cadastrado' });
    }
    
    // Criar usuário
    const result = await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id',
      [name, email, password]
    );
    
    res.json({ 
      message: 'Usuário criado com sucesso',
      userId: result.rows[0].id 
    });
  } catch (error) {
    console.error('Erro ao criar usuário:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/admin/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email, created_at FROM users ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar usuários:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/admin/users/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    // Verificar se usuário existe
    const checkResult = await pool.query('SELECT id FROM users WHERE id = $1', [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    
    // Deletar o usuário
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    
    res.json({ message: 'Usuário deletado com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar usuário:', error);
    res.status(500).json({ error: error.message });
  }
});

// Rota para administradores verem todas as transações
app.get('/admin/all-transactions', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        t.*,
        u.name as userName,
        u.email as userEmail
      FROM transactions t
      JOIN users u ON t."userId" = u.email
      ORDER BY t.date DESC, t.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar todas as transações:', error);
    res.status(500).json({ error: error.message });
  }
});

// Rota para estatísticas gerais (admin)
app.get('/admin/stats', async (req, res) => {
  try {
    const [usersResult, transactionsResult, totalsResult] = await Promise.all([
      pool.query('SELECT COUNT(*) as totalUsers FROM users'),
      pool.query('SELECT COUNT(*) as totalTransactions FROM transactions'),
      pool.query('SELECT type, SUM(value) as total FROM transactions GROUP BY type')
    ]);
    
    const totals = {};
    totalsResult.rows.forEach(row => {
      totals[row.type] = parseFloat(row.total);
    });
    
    const stats = {
      totalUsers: parseInt(usersResult.rows[0].totalusers),
      totalTransactions: parseInt(transactionsResult.rows[0].totaltransactions),
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
    const result = await pool.query('SELECT id, name, email FROM users');
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar usuários:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`🚀 API do Gestor Financeiro rodando em http://localhost:${port}`);
  console.log(`📊 Backend iniciado com sucesso!`);
});
