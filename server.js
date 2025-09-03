const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Servir arquivos estáticos do React build (apenas em produção)
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'gestor-financeiro-frontend/build')));
}

// Criar/conectar ao banco de dados
const db = new sqlite3.Database('./financeiro.db');

// Criar e migrar tabelas
db.serialize(() => {
  // Verificar se a tabela users existe e tem a coluna role
  db.all("PRAGMA table_info(users)", (err, columns) => {
    if (err) {
      console.error('Erro ao verificar tabela users:', err);
      return;
    }
    
    const hasRoleColumn = columns.some(col => col.name === 'role');
    
    if (columns.length === 0) {
      // Tabela não existe, criar nova
      db.run(`CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, (err) => {
        if (err) {
          console.error('Erro ao criar tabela users:', err);
        } else {
          console.log('✅ Tabela users criada com sucesso');
          createAdminUser();
        }
      });
    } else if (!hasRoleColumn) {
      // Tabela existe mas não tem coluna role, adicionar
      db.run("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'", (err) => {
        if (err) {
          console.error('Erro ao adicionar coluna role:', err);
        } else {
          console.log('✅ Coluna role adicionada à tabela users');
          createAdminUser();
        }
      });
    } else {
      console.log('✅ Tabela users já existe e está atualizada');
      createAdminUser();
    }
  });

  // Verificar se a tabela transactions existe e tem a coluna userId
  db.all("PRAGMA table_info(transactions)", (err, columns) => {
    if (err) {
      console.error('Erro ao verificar tabela transactions:', err);
      return;
    }
    
    const hasUserIdColumn = columns.some(col => col.name === 'userId');
    
    if (columns.length === 0) {
      // Tabela não existe, criar nova
      db.run(`CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        value REAL NOT NULL,
        date TEXT NOT NULL,
        userId INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users (id)
      )`, (err) => {
        if (err) {
          console.error('Erro ao criar tabela transactions:', err);
        } else {
          console.log('✅ Tabela transactions criada com sucesso');
        }
      });
    } else if (!hasUserIdColumn) {
      // Tabela existe mas não tem coluna userId, adicionar
      db.run("ALTER TABLE transactions ADD COLUMN userId INTEGER DEFAULT 1", (err) => {
        if (err) {
          console.error('Erro ao adicionar coluna userId:', err);
        } else {
          console.log('✅ Coluna userId adicionada à tabela transactions');
        }
      });
    } else {
      console.log('✅ Tabela transactions já existe e está atualizada');
    }
  });
});

// Função para criar usuário admin
function createAdminUser() {
  db.get('SELECT id FROM users WHERE email = ?', ['admin@gestor.com'], (err, row) => {
    if (err) {
      console.error('Erro ao verificar admin:', err);
      return;
    }
    
    if (!row) {
      db.run(
        'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
        ['Administrador', 'admin@gestor.com', 'j92953793*/*', 'admin'],
        function(err) {
          if (err) {
            console.error('Erro ao criar admin:', err);
          } else {
            console.log('👑 Usuário admin criado com sucesso!');
            console.log('📧 Email: admin@gestor.com');
            console.log('🔑 Senha: j92953793*/*');
          }
        }
      );
    } else {
      console.log('👑 Usuário admin já existe');
    }
  });
}

// Rotas para transações
app.get('/transactions', (req, res) => {
  const { userId } = req.query;
  
  if (!userId || userId === 'undefined') {
    return res.status(400).json({ error: 'ID do usuário é obrigatório' });
  }
  
  db.all(
    'SELECT * FROM transactions WHERE userId = ? ORDER BY date DESC, created_at DESC', 
    [userId], 
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
      }
      res.json(rows);
    }
  );
});

app.post('/transactions', (req, res) => {
  const { type, description, category, value, date, userId } = req.body;
  
  if (!type || !description || !category || !value || !date || !userId) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }
  
  db.run(
    'INSERT INTO transactions (type, description, category, value, date, userId) VALUES (?, ?, ?, ?, ?, ?)',
    [type, description, category, value, date, userId], 
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
      }
      res.json({ 
        id: this.lastID,
        message: 'Transação criada com sucesso'
      });
    }
  );
});

app.delete('/transactions/:id', (req, res) => {
  const { id } = req.params;
  const { userId } = req.query;
  
  if (!userId) {
    return res.status(400).json({ error: 'ID do usuário é obrigatório' });
  }
  
  // Verificar se a transação pertence ao usuário
  db.get(
    'SELECT userId FROM transactions WHERE id = ?', 
    [id], 
    (err, row) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
      }
      
      if (!row) {
        return res.status(404).json({ error: 'Transação não encontrada' });
      }
      
      if (row.userId !== parseInt(userId)) {
        return res.status(403).json({ error: 'Você não tem permissão para deletar esta transação' });
      }
      
      db.run('DELETE FROM transactions WHERE id = ?', [id], function(err) {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: err.message });
        }
        
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Transação não encontrada' });
        }
        
        res.json({ message: 'Transação deletada com sucesso' });
      });
    }
  );
});

// Rotas de autenticação
app.post('/auth/login', (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios' });
  }
  
  console.log('Tentativa de login:', { email, password }); // Log para debug
  
  db.get(
    'SELECT id, name, email, role FROM users WHERE email = ? AND password = ?',
    [email, password],
    (err, row) => {
      if (err) {
        console.error('Erro no banco:', err);
        return res.status(500).json({ error: err.message });
      }
      
      console.log('Resultado da consulta:', row); // Log para debug
      
      if (!row) {
        return res.status(401).json({ error: 'Email ou senha inválidos' });
      }
      
      res.json({
        message: 'Login realizado com sucesso',
        user: {
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role
        }
      });
    }
  );
});

// Rotas administrativas
app.post('/admin/register-user', (req, res) => {
  const { name, email, password, role = 'user' } = req.body;
  
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }
  
  if (password.length < 6) {
    return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
  }
  
  // Verificar se email já existe
  db.get('SELECT id FROM users WHERE email = ?', [email], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (row) {
      return res.status(400).json({ error: 'Email já cadastrado' });
    }
    
    // Criar usuário
    db.run(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [name, email, password, role],
      function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        
        res.json({ 
          message: 'Usuário criado com sucesso',
          userId: this.lastID 
        });
      }
    );
  });
});

app.get('/admin/users', (req, res) => {
  db.all('SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.delete('/admin/users/:id', (req, res) => {
  const { id } = req.params;
  
  // Não permitir deletar admin
  db.get('SELECT role FROM users WHERE id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (!row) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    
    if (row.role === 'admin') {
      return res.status(403).json({ error: 'Não é possível deletar administradores' });
    }
    
    db.run('DELETE FROM users WHERE id = ?', [id], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      res.json({ message: 'Usuário deletado com sucesso' });
    });
  });
});

// Rota para administradores verem todas as transações
app.get('/admin/all-transactions', (req, res) => {
  db.all(
    `SELECT 
      t.*,
      u.name as userName,
      u.email as userEmail
    FROM transactions t
    JOIN users u ON t.userId = u.id
    ORDER BY t.date DESC, t.created_at DESC`,
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
      }
      res.json(rows);
    }
  );
});

// Rota para estatísticas gerais (admin)
app.get('/admin/stats', (req, res) => {
  const queries = [
    // Total de usuários
    new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as totalUsers FROM users', (err, row) => {
        if (err) reject(err);
        else resolve({ totalUsers: row.totalUsers });
      });
    }),
    
    // Total de transações
    new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as totalTransactions FROM transactions', (err, row) => {
        if (err) reject(err);
        else resolve({ totalTransactions: row.totalTransactions });
      });
    }),
    
    // Total geral de entradas e despesas
    new Promise((resolve, reject) => {
      db.all(
        'SELECT type, SUM(value) as total FROM transactions GROUP BY type',
        (err, rows) => {
          if (err) reject(err);
          else {
            const totals = {};
            rows.forEach(row => {
              totals[row.type] = row.total;
            });
            resolve(totals);
          }
        }
      );
    })
  ];
  
  Promise.all(queries)
    .then(results => {
      const stats = Object.assign({}, ...results);
      res.json(stats);
    })
    .catch(err => {
      console.error(err);
      res.status(500).json({ error: err.message });
    });
});

// Rota para verificar usuários cadastrados (debug)
app.get('/debug/users', (req, res) => {
  db.all('SELECT id, name, email, role FROM users', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Servir o React app para todas as outras rotas (SPA routing)
if (process.env.NODE_ENV === 'production') {
  app.get('/*', (req, res) => {
    res.sendFile(path.join(__dirname, 'gestor-financeiro-frontend/build/index.html'));
  });
}

app.listen(port, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${port}`);
  console.log(`📊 API do Gestor Financeiro iniciada com sucesso!`);
  
  if (process.env.NODE_ENV !== 'production') {
    console.log(`🎯 Frontend será iniciado em: http://localhost:3000`);
  }
});
