const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const app = express();
const port = process.env.PORT || 10000;

// ============ SEGURANÇA ============
const JWT_SECRET = process.env.JWT_SECRET || 'gestor-financeiro-jwt-secret-2026';
const SALT_ROUNDS = 10;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'junior395@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'j991343519*/*';

// Tokens de reset em memória: email → { token, expiry }
const passwordResetTokens = new Map();

// ============ VALIDAÇÃO ============
const MAX_VALUE = 999_999_999;
const VALID_TRANSACTION_TYPES = ['entrada', 'despesa'];
const VALID_RECURRENCES = ['monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual', 'fifth-business-day'];
const VALID_BUDGET_PERIODS = ['monthly', 'annual', 'mensal', 'anual', 'weekly', 'semanal'];
const VALID_WALLET_TYPES = ['corrente', 'poupanca', 'investimento', 'carteira'];

/** Retira espaços e limita tamanho. Retorna string vazia se nulo. */
const sanitize = (val, maxLen = 255) =>
  val == null ? '' : String(val).trim().slice(0, maxLen);

/** Valida formato de data YYYY-MM-DD. */
const isValidDate = (str) => /^\d{4}-\d{2}-\d{2}$/.test(String(str || ''));

/** Valida formato de e-mail básico. */
const isValidEmail = (str) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(str || '').trim());

/** Número positivo finito dentro do limite. */
const isPositiveNum = (val) => { const n = parseFloat(val); return !isNaN(n) && isFinite(n) && n > 0 && n <= MAX_VALUE; };

/** Número não-negativo finito dentro do limite. */
const isNonNegativeNum = (val) => { const n = parseFloat(val); return !isNaN(n) && isFinite(n) && n >= 0 && n <= MAX_VALUE; };

/**
 * Valida os campos de uma transação individual.
 * Retorna array de mensagens de erro (vazio = válido).
 */
const validateTx = ({ type, description, category, value, date }) => {
  const errors = [];
  if (!VALID_TRANSACTION_TYPES.includes(type))
    errors.push('"type" deve ser "entrada" ou "despesa"');
  const desc = sanitize(description, 200);
  if (!desc) errors.push('"description" é obrigatória (máx 200 caracteres)');
  const cat = sanitize(category, 100);
  if (!cat) errors.push('"category" é obrigatória (máx 100 caracteres)');
  if (!isPositiveNum(value))
    errors.push('"value" deve ser um número positivo (máx 999.999.999)');
  if (!isValidDate(date))
    errors.push('"date" deve estar no formato YYYY-MM-DD');
  return errors;
};

/**
 * Constrói um array de erros a partir de regras.
 * Cada regra é [condicao, mensagem]; se condicao === true, o erro é adicionado.
 */
const buildErrors = (rules) => rules.filter(([cond]) => cond).map(([, msg]) => msg);

/** Responde 400 com o primeiro erro e o array completo. */
const badRequest = (res, errors) =>
  res.status(400).json({ error: errors[0], errors });

// ============ CONFIGURAÇÕES ============
/** Lê um parâmetro da tabela configuracoes. Retorna o valor ou o default. */
const getConfig = async (secao, parametro, defaultValue = '') => {
  try {
    const row = await dbGet(
      'SELECT valor FROM configuracoes WHERE secao = ? AND parametro = ?',
      [secao, parametro]
    );
    return (row && row.valor != null) ? row.valor : defaultValue;
  } catch { return defaultValue; }
};

/** Grava/atualiza um parâmetro na tabela configuracoes. */
const setConfig = async (secao, parametro, valor) => {
  await dbRun(
    `INSERT INTO configuracoes (secao, parametro, valor) VALUES (?, ?, ?)
     ON CONFLICT(secao, parametro) DO UPDATE SET valor = excluded.valor`,
    [secao, parametro, String(valor)]
  );
};

/** Monta configurações SMTP (env vars > banco) com timeout e limpeza. */
const getSmtpConfig = async () => {
  const host = process.env.SMTP_HOST || await getConfig('SMTP', 'HOST', 'smtp.gmail.com');
  const port = parseInt(process.env.SMTP_PORT || await getConfig('SMTP', 'PORT', '465'));
  const secure = (process.env.SMTP_SECURE || await getConfig('SMTP', 'SECURE', 'true')) === 'true';
  const user = process.env.SMTP_USER || await getConfig('SMTP', 'USER', '');
  // Remove espaços — senhas de app do Google são exibidas com espaços mas devem ser enviadas sem
  const pass = (process.env.SMTP_PASS || await getConfig('SMTP', 'PASS', '')).replace(/\s/g, '');
  const from = process.env.SMTP_FROM || await getConfig('SMTP', 'FROM', user);
  return { host, port, secure, user, pass, from };
};

/** Cria transporter nodemailer com timeout de 15s. */
const buildTransporter = (cfg) => nodemailer.createTransport({
  host: cfg.host,
  port: cfg.port,
  secure: cfg.secure,
  auth: { user: cfg.user, pass: cfg.pass },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 15000,
});

/**
 * Envia e-mail usando SendGrid HTTP API (porta 443, funciona no Render free).
 * Retorna true se enviou, false se SENDGRID_API_KEY não está configurada.
 * Lança erro se a API retornar falha.
 */
const sendViaSendGrid = async (to, subject, html) => {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) return false; // não configurado, tenta próximo método

  const fromEmail = process.env.SENDGRID_FROM || process.env.SMTP_USER || 'jrinfosistemas@gmail.com';

  const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: fromEmail, name: 'Gestor Financeiro' },
      subject,
      content: [{ type: 'text/html', value: html }],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`SendGrid ${resp.status}: ${body}`);
  }
  return true;
};

/**
 * Função principal de envio: tenta SendGrid (HTTP) → SMTP → lança erro.
 * No Render free, SMTP sempre falha (ETIMEDOUT); use SENDGRID_API_KEY.
 */
const sendEmail = async ({ to, subject, html }) => {
  // 1. Tenta SendGrid (API HTTP — funciona em qualquer hospedagem)
  const sentViaSG = await sendViaSendGrid(to, subject, html);
  if (sentViaSG) {
    console.log(`📧 E-mail enviado via SendGrid para ${to}`);
    return;
  }

  // 2. Tenta SMTP (pode falhar no Render free por bloqueio de porta)
  const smtp = await getSmtpConfig();
  console.log(`[SMTP] tentando ${smtp.user}@${smtp.host}:${smtp.port} secure=${smtp.secure}`);
  const transporter = buildTransporter(smtp);
  await transporter.sendMail({
    from: `"Gestor Financeiro" <${smtp.from}>`,
    to,
    subject,
    html,
  });
  console.log(`📧 E-mail enviado via SMTP para ${to}`);
};

// Middleware de autenticação JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer TOKEN"
  if (!token) return res.status(401).json({ error: 'Token de autenticação necessário' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(401).json({ error: 'Token inválido ou expirado. Faça login novamente.' });
    req.user = user;
    next();
  });
};

// Middleware para bloquear rotas de debug em produção
const devOnly = (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Rota não disponível em produção' });
  }
  next();
};

// ============ CAMADA DE BANCO DE DADOS ============
// Em produção: usa Turso (SQLite na nuvem) via TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
// Em desenvolvimento: usa arquivo SQLite local em ./data/database.db

let dbRun, dbGet, dbAll;

const tursoUrl = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;

if (tursoUrl && tursoUrl.startsWith('libsql://')) {
  // ---- TURSO (produção) ----
  const { createClient } = require('@libsql/client');
  const db = createClient({ url: tursoUrl, authToken: tursoToken || '' });

  console.log('☁️  Banco: Turso (SQLite na nuvem)');

  dbRun = async (sql, params = []) => {
    const r = await db.execute({ sql, args: params });
    return { id: Number(r.lastInsertRowid ?? 0), changes: r.rowsAffected ?? 0 };
  };

  dbGet = async (sql, params = []) => {
    const r = await db.execute({ sql, args: params });
    return r.rows[0] ?? null;
  };

  dbAll = async (sql, params = []) => {
    const r = await db.execute({ sql, args: params });
    return r.rows ?? [];
  };

} else {
  // ---- SQLite local (desenvolvimento) ----
  const sqlite3 = require('sqlite3').verbose();

  let dbPath = './data/database.db';
  if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });

  const db = new sqlite3.Database(dbPath, (err) => {
    if (err) { console.error('❌ Erro ao conectar SQLite:', err); process.exit(1); }
    else console.log(`📂 Banco SQLite local: ${dbPath}`);
  });

  db.run('PRAGMA foreign_keys = ON');

  dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });

  dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row ?? null);
    });
  });

  dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

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

app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json());

// ============ MIDDLEWARE DE LICENÇA ============
// Inicializado aqui para interceptar TODAS as rotas, incluindo /transactions.
// dbGet e dbRun já estão atribuídos (Turso ou SQLite) de forma síncrona acima.
{
  let _validarLicenca = null;
  try {
    const createLicencaMiddleware = require('./middleware/validarLicencaMySQL');
    _validarLicenca = createLicencaMiddleware(dbGet, dbRun).validarLicencaMiddleware;
    console.log('✅ Middleware de licença carregado');
  } catch (e) {
    console.error('⚠️ Erro ao carregar middleware de licença:', e.message);
  }

  if (_validarLicenca) {
    app.use((req, res, next) => {
      // Apenas health check isento — todo o resto exige licença válida,
      // inclusive login. A tabela licenca_local é preenchida por script externo.
      if (req.path === '/api/health' || req.path === '/api/ping') return next();
      return _validarLicenca(req, res, next);
    });
    console.log('✅ Validação de licença ativada (inclusive login)');
  }
}

// Rate limiter para login: máximo 10 tentativas por 15 minutos por IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Aguarde 15 minutos e tente novamente.' }
});

// Rotas públicas (não precisam de autenticação)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Gestor Financeiro API funcionando!',
    timestamp: new Date().toISOString(),
    database: 'SQLite'
  });
});

// Diagnóstico de envio de e-mail (público, sem expor senha)
app.get('/api/smtp-test', async (req, res) => {
  const hasSendGrid = !!process.env.SENDGRID_API_KEY;
  const smtp = await getSmtpConfig().catch(() => ({}));
  const info = {
    sendgrid: hasSendGrid ? '✅ SENDGRID_API_KEY configurada' : '❌ SENDGRID_API_KEY ausente (adicione no Render)',
    smtp: { host: smtp.host, port: smtp.port, secure: smtp.secure, user: smtp.user, passLen: (smtp.pass || '').length },
  };
  if (hasSendGrid) {
    return res.json({ ok: true, method: 'SendGrid HTTP', ...info });
  }
  try {
    const transporter = buildTransporter(smtp);
    await transporter.verify();
    res.json({ ok: true, method: 'SMTP', ...info });
  } catch (err) {
    res.json({ ok: false, method: 'SMTP', error: err.message, code: err.code, ...info });
  }
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
        role TEXT NOT NULL DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Migração: adicionar coluna role se não existir
    await dbRun(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`).catch(() => { });

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
        wallet_id INTEGER,
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
    // Migrações de colunas (executa silenciosamente se já existirem)
    await dbRun(`ALTER TABLE transactions ADD COLUMN wallet_id INTEGER`).catch(() => { });
    await dbRun(`ALTER TABLE transactions ADD COLUMN transfer_ref INTEGER`).catch(() => { });
    await dbRun(`ALTER TABLE transactions ADD COLUMN installment_ref TEXT`).catch(() => { });
    await dbRun(`ALTER TABLE transactions ADD COLUMN installment_num INTEGER`).catch(() => { });
    await dbRun(`ALTER TABLE transactions ADD COLUMN installment_total INTEGER`).catch(() => { });
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_categories_userid ON categories(userId)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_recurring_userid ON recurring_expenses(userId)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_budgets_userid ON budgets(userId)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_wallets_userid ON wallets(userId)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_goals_userid ON goals(userId)`);

    // Criar tabela de configurações
    await dbRun(`
      CREATE TABLE IF NOT EXISTS configuracoes (
        secao TEXT NOT NULL,
        parametro TEXT NOT NULL,
        valor TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (secao, parametro)
      )
    `);

    // Criar tabela de licença local (validação cruzada com banco MySQL central)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS licenca_local (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        CodigoDoCliente INTEGER,
        CodigoDaLicenca INTEGER,
        CodigoDoProduto INTEGER,
        CNPJ TEXT,
        Versao TEXT DEFAULT '1.0',
        Situacao TEXT DEFAULT 'Ativo',
        atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Migração: adiciona coluna atualizado_em caso a tabela já existisse sem ela
    await dbRun(`ALTER TABLE licenca_local ADD COLUMN atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP`).catch(() => { });

    // Seed SMTP — INSERT OR REPLACE força atualização mesmo se já existir
    const smtpDefaults = [
      ['SMTP', 'HOST', 'smtp.gmail.com'],
      ['SMTP', 'PORT', '465'],
      ['SMTP', 'SECURE', 'true'],
      ['SMTP', 'USER', 'jrinfosistemas@gmail.com'],
      ['SMTP', 'PASS', 'lofn zczm bcld emoc'],
      ['SMTP', 'FROM', 'jrinfosistemas@gmail.com'],
    ];
    for (const [secao, parametro, valor] of smtpDefaults) {
      await dbRun(
        `INSERT OR REPLACE INTO configuracoes (secao, parametro, valor) VALUES (?, ?, ?)`,
        [secao, parametro, valor]
      );
    }

    console.log('✅ Banco SQLite inicializado com sucesso!');

    // Migrar senhas em texto puro para bcrypt (executa uma vez)
    try {
      const allUsers = await dbAll('SELECT id, password FROM users');
      let migrated = 0;
      for (const u of allUsers) {
        if (u.password && !u.password.startsWith('$2b$') && !u.password.startsWith('$2a$')) {
          const hashed = await bcrypt.hash(u.password, SALT_ROUNDS);
          await dbRun('UPDATE users SET password = ? WHERE id = ?', [hashed, u.id]);
          migrated++;
        }
      }
      if (migrated > 0) console.log(`🔐 ${migrated} senha(s) migrada(s) para bcrypt`);
    } catch (migErr) {
      console.error('Aviso na migração de senhas:', migErr.message);
    }

    // Criar usuário admin se não existir
    try {
      const adminExists = await dbGet('SELECT id FROM users WHERE email = ?', [ADMIN_EMAIL]);

      if (!adminExists) {
        const hashedAdminPwd = await bcrypt.hash(ADMIN_PASSWORD, SALT_ROUNDS);
        await dbRun(
          "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'admin')",
          ['Administrador', ADMIN_EMAIL, hashedAdminPwd]
        );
        console.log('👑 Usuário admin criado com sucesso!');
      } else {
        // Garante que o admin existente tenha role = 'admin'
        await dbRun("UPDATE users SET role = 'admin' WHERE email = ?", [ADMIN_EMAIL]);
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

// Log de integridade do banco (todos os dados são persistidos automaticamente no Turso/SQLite)
const backupData = async () => {
  try {
    const [users, transactions, wallets, goals, budgets, recurring, categories] = await Promise.all([
      dbAll('SELECT COUNT(*) as n FROM users'),
      dbAll('SELECT COUNT(*) as n FROM transactions'),
      dbAll('SELECT COUNT(*) as n FROM wallets'),
      dbAll('SELECT COUNT(*) as n FROM goals'),
      dbAll('SELECT COUNT(*) as n FROM budgets'),
      dbAll('SELECT COUNT(*) as n FROM recurring_expenses'),
      dbAll('SELECT COUNT(*) as n FROM categories'),
    ]);
    console.log(
      `✅ Banco OK [${new Date().toLocaleString('pt-BR')}]`,
      `| usuários: ${users[0]?.n ?? 0}`,
      `| transações: ${transactions[0]?.n ?? 0}`,
      `| contas: ${wallets[0]?.n ?? 0}`,
      `| metas: ${goals[0]?.n ?? 0}`,
      `| orçamentos: ${budgets[0]?.n ?? 0}`,
      `| recorrentes: ${recurring[0]?.n ?? 0}`,
      `| categorias: ${categories[0]?.n ?? 0}`
    );
  } catch (error) {
    console.error('❌ Erro ao verificar banco:', error);
  }
};

// Inicializar banco de dados e só então subir o servidor
// IMPORTANTE: app.listen fica aqui dentro para garantir que a tabela
// licenca_local já existe no Turso antes de qualquer requisição chegar.
initializeDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`🚀 API do Gestor Financeiro rodando em http://localhost:${port}`);
      console.log(`📊 Backend iniciado com sucesso!`);
    });
  })
  .catch(error => {
    console.error('❌ Falha crítica na inicialização do banco:', error);
    process.exit(1);
  });

// Criar múltiplas transações em lote (parcelamento)
app.post('/transactions/batch', authenticateToken, async (req, res) => {
  const { transactions: batch, wallet_id, userId } = req.body;

  if (!userId) return badRequest(res, ['"userId" é obrigatório']);
  if (!Array.isArray(batch) || batch.length < 2)
    return badRequest(res, ['"transactions" deve ser um array com ao menos 2 itens']);
  if (batch.length > 48)
    return badRequest(res, ['Máximo de 48 parcelas por lançamento']);

  // Validar cada parcela
  for (const tx of batch) {
    const txErrors = validateTx(tx);
    if (txErrors.length)
      return badRequest(res, [`Parcela ${tx.installment_num}: ${txErrors[0]}`]);
  }

  try {
    const ids = [];
    for (const tx of batch) {
      const { type, description, category, value, date,
        installment_ref, installment_num, installment_total } = tx;
      const desc = sanitize(description, 200);
      const cat = sanitize(category, 100);
      const result = await dbRun(
        `INSERT INTO transactions
         (type, description, category, value, date, userId, wallet_id,
          installment_ref, installment_num, installment_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [type, desc, cat, parseFloat(value), date, userId,
          wallet_id || null, installment_ref || null,
          installment_num || null, installment_total || null]
      );
      ids.push(result.id);
    }

    // Débitar saldo da conta se vinculada (valor total do parcelamento)
    if (wallet_id) {
      const totalValue = batch.reduce((s, tx) => s + parseFloat(tx.value), 0);
      const firstType = batch[0].type;
      const delta = firstType === 'entrada' ? totalValue : -totalValue;
      await dbRun('UPDATE wallets SET balance = balance + ? WHERE id = ?', [delta, wallet_id]);
    }

    setTimeout(() => backupData(), 100);
    res.json({ message: `${ids.length} parcela(s) criada(s) com sucesso`, ids });
  } catch (error) {
    console.error('Erro ao criar transações em lote:', error);
    res.status(500).json({ error: error.message });
  }
});

// Importação em lote de extrato CSV
app.post('/transactions/import', authenticateToken, async (req, res) => {
  const { transactions: batch, userId } = req.body;

  if (!userId) return badRequest(res, ['"userId" é obrigatório']);
  if (!Array.isArray(batch) || batch.length === 0)
    return badRequest(res, ['"transactions" deve ser um array não vazio']);
  if (batch.length > 2000)
    return badRequest(res, ['Máximo de 2000 transações por importação']);

  for (let i = 0; i < batch.length; i++) {
    const txErrors = validateTx(batch[i]);
    if (txErrors.length)
      return badRequest(res, [`Linha ${i + 1}: ${txErrors[0]}`]);
  }

  try {
    const ids = [];
    for (const tx of batch) {
      const desc = sanitize(tx.description, 200);
      const cat = sanitize(tx.category, 100);
      const result = await dbRun(
        'INSERT INTO transactions (type, description, category, value, date, userId) VALUES (?, ?, ?, ?, ?, ?)',
        [tx.type, desc, cat, parseFloat(tx.value), tx.date, userId]
      );
      ids.push(result.id);
    }
    setTimeout(() => backupData(), 100);
    res.json({ message: `${ids.length} transação(ões) importada(s) com sucesso`, count: ids.length, ids });
  } catch (error) {
    console.error('Erro ao importar transações:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/transactions', authenticateToken, async (req, res) => {
  const { userId, page, limit } = req.query;

  if (!userId || userId === 'undefined') {
    return res.status(400).json({ error: 'userId é obrigatório' });
  }

  try {
    // Se page e limit forem fornecidos, pagina; caso contrário retorna tudo (retrocompat)
    if (page !== undefined && limit !== undefined) {
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
      const offset = (pageNum - 1) * limitNum;

      const [rows, countRow] = await Promise.all([
        dbAll(
          'SELECT * FROM transactions WHERE userId = ? ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?',
          [userId, limitNum, offset]
        ),
        dbAll('SELECT COUNT(*) as total FROM transactions WHERE userId = ?', [userId])
      ]);

      const total = countRow[0]?.total || 0;
      return res.json({
        data: rows,
        total,
        page: pageNum,
        limit: limitNum,
        hasMore: offset + rows.length < total
      });
    }

    // Retorno completo (sem paginação)
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

app.post('/transactions', authenticateToken, async (req, res) => {
  const { type, description, category, value, date, userId, wallet_id } = req.body;

  const errors = [
    ...(!userId ? ['"userId" é obrigatório'] : []),
    ...validateTx({ type, description, category, value, date })
  ];
  if (errors.length) return badRequest(res, errors);

  const desc = sanitize(description, 200);
  const cat = sanitize(category, 100);

  try {
    const result = await dbRun(
      'INSERT INTO transactions (type, description, category, value, date, userId, wallet_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [type, desc, cat, parseFloat(value), date, userId, wallet_id || null]
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

app.put('/transactions/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { type, description, category, value, date, userId, wallet_id } = req.body;

  const errors = [
    ...(!userId ? ['"userId" é obrigatório'] : []),
    ...validateTx({ type, description, category, value, date })
  ];
  if (errors.length) return badRequest(res, errors);

  const desc = sanitize(description, 200);
  const cat = sanitize(category, 100);

  try {
    const checkResult = await dbGet('SELECT userId FROM transactions WHERE id = ?', [id]);
    if (!checkResult) {
      return res.status(404).json({ error: 'Transação não encontrada' });
    }
    if (checkResult.userId !== userId) {
      return res.status(403).json({ error: 'Sem permissão para editar esta transação' });
    }
    await dbRun(
      'UPDATE transactions SET type = ?, description = ?, category = ?, value = ?, date = ?, wallet_id = ? WHERE id = ?',
      [type, desc, cat, parseFloat(value), date, wallet_id || null, id]
    );
    res.json({ message: 'Transação atualizada com sucesso' });
  } catch (error) {
    console.error('Erro ao atualizar transação:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/transactions/:id', authenticateToken, async (req, res) => {
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

// Rotas de autenticação (públicas)
app.post('/auth/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;

  const errors = buildErrors([
    [!email || !password, 'Email e senha são obrigatórios'],
    [email && !isValidEmail(email), 'Formato de e-mail inválido'],
    [password && String(password).length > 200, 'Senha deve ter no máximo 200 caracteres']
  ]);
  if (errors.length) return badRequest(res, errors);

  try {
    const result = await dbGet(
      'SELECT id, name, email, password, role FROM users WHERE email = ?',
      [email]
    );

    if (!result) {
      return res.status(401).json({ error: 'Email ou senha inválidos' });
    }

    const isPasswordValid = await bcrypt.compare(password, result.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Email ou senha inválidos' });
    }

    const token = jwt.sign(
      { id: result.id, email: result.email, name: result.name, role: result.role || 'user' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login realizado com sucesso',
      token,
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

// ============ RECUPERAÇÃO DE SENHA (rotas públicas) ============
app.post('/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email || !isValidEmail(email)) return badRequest(res, ['E-mail inválido']);

  try {
    const user = await dbGet('SELECT id, name FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (!user) {
      // Não revelar se e-mail existe
      return res.json({ ok: true, message: 'Se o e-mail estiver cadastrado, você receberá o código.' });
    }

    // Código de 6 dígitos, válido por 15 minutos
    const token = String(Math.floor(100000 + Math.random() * 900000));
    const expiry = Date.now() + 15 * 60 * 1000;
    passwordResetTokens.set(email.toLowerCase().trim(), { token, expiry });

    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head><body style="font-family:sans-serif;background:#f8fafc;padding:24px;"><div style="max-width:480px;margin:auto;background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.08);overflow:hidden;"><div style="background:#6366f1;padding:20px 24px;"><h1 style="color:#fff;margin:0;font-size:1.2rem;">💰 Gestor Financeiro</h1><p style="color:#c7d2fe;margin:4px 0 0;font-size:0.9rem;">Recuperação de Senha</p></div><div style="padding:24px;"><p style="color:#475569;">Olá, <strong>${user.name}</strong>!</p><p style="color:#475569;">Use o código abaixo para redefinir sua senha. Ele é válido por <strong>15 minutos</strong>.</p><div style="text-align:center;margin:24px 0;"><span style="font-size:2.5rem;font-weight:800;letter-spacing:8px;color:#6366f1;background:#f0f0ff;padding:12px 24px;border-radius:8px;">${token}</span></div><p style="font-size:0.8rem;color:#94a3b8;">Se você não solicitou a recuperação, ignore este e-mail.</p></div></div></body></html>`;

    try {
      await sendEmail({ to: email, subject: '🔑 Código de recuperação de senha — Gestor Financeiro', html });
      return res.json({ ok: true });
    } catch (emailErr) {
      console.error('Envio de e-mail falhou (forgot-password):', emailErr.message);
      // Fallback demo: devolve o código para não bloquear o usuário
      console.log(`🔑 [RESET DEMO] Código para ${email}: ${token}`);
      return res.json({ ok: true, demo: true, token, message: 'Código retornado (envio de e-mail indisponível).' });
    }
  } catch (err) {
    console.error('Erro em forgot-password:', err.message);
    res.status(500).json({ error: 'Erro ao processar solicitação' });
  }
});

app.post('/auth/reset-password', async (req, res) => {
  const { email, token, newPassword } = req.body;
  if (!email || !token || !newPassword) return badRequest(res, ['Campos obrigatórios ausentes']);
  if (newPassword.length < 6) return badRequest(res, ['Senha deve ter pelo menos 6 caracteres']);
  if (newPassword.length > 200) return badRequest(res, ['Senha deve ter no máximo 200 caracteres']);

  const key = String(email).toLowerCase().trim();
  const stored = passwordResetTokens.get(key);

  if (!stored || stored.token !== String(token).trim() || Date.now() > stored.expiry) {
    return res.status(400).json({ error: 'Código inválido ou expirado. Solicite um novo.' });
  }

  try {
    const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await dbRun('UPDATE users SET password = ? WHERE email = ?', [hashed, key]);
    passwordResetTokens.delete(key);
    console.log(`🔑 Senha redefinida para ${email}`);
    res.json({ ok: true, message: 'Senha alterada com sucesso!' });
  } catch (err) {
    console.error('Erro em reset-password:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============ ROTAS PROTEGIDAS (requerem JWT) ============
app.use(authenticateToken);

// Middleware para proteger rotas administrativas
const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito a administradores.' });
  }
  next();
};
app.use('/admin', requireAdmin);

// ============ ROTAS DE LICENÇA (admin) ============
/** Retorna a licença local cadastrada. */
app.get('/admin/licenca', async (req, res) => {
  try {
    const row = await dbGet('SELECT * FROM licenca_local ORDER BY id DESC LIMIT 1', []);
    return res.json(row || null);
  } catch (e) {
    res.status(500).json({ error: 'Erro ao ler licença local', detalhes: e.message });
  }
});

/** Diagnóstico: mostra todas as colunas e valores do registro de licença no banco (Turso/SQLite). */
app.get('/admin/licenca/debug', async (req, res) => {
  try {
    const row = await dbGet('SELECT * FROM licenca_local ORDER BY id DESC LIMIT 1', []);
    if (!row) return res.json({ encontrado: false, mensagem: 'Nenhum registro em licenca_local' });
    return res.json({ encontrado: true, colunas: Object.keys(row), dados: row });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao consultar licenca_local', detalhes: e.message });
  }
});

/** Cria ou atualiza a licença local (upsert). */
app.post('/admin/licenca', async (req, res) => {
  try {
    const { CodigoDoCliente, CodigoDaLicenca, CodigoDoProduto, CNPJ, Versao, Situacao } = req.body;
    const values = [CodigoDoCliente ?? null, CodigoDaLicenca ?? null, CodigoDoProduto ?? null, CNPJ ?? null, Versao ?? '1.0', Situacao ?? 'Ativo'];
    const existing = await dbGet('SELECT id FROM licenca_local ORDER BY id DESC LIMIT 1', []);
    if (existing) {
      // Tenta atualizar com atualizado_em; se coluna não existir, atualiza sem ela
      try {
        await dbRun(
          'UPDATE licenca_local SET CodigoDoCliente=?,CodigoDaLicenca=?,CodigoDoProduto=?,CNPJ=?,Versao=?,Situacao=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?',
          [...values, existing.id]
        );
      } catch (_) {
        await dbRun(
          'UPDATE licenca_local SET CodigoDoCliente=?,CodigoDaLicenca=?,CodigoDoProduto=?,CNPJ=?,Versao=?,Situacao=? WHERE id=?',
          [...values, existing.id]
        );
      }
      return res.json({ ok: true, updated: true });
    } else {
      await dbRun(
        'INSERT INTO licenca_local (CodigoDoCliente,CodigoDaLicenca,CodigoDoProduto,CNPJ,Versao,Situacao) VALUES (?,?,?,?,?,?)',
        values
      );
      return res.json({ ok: true, inserted: true });
    }
  } catch (e) {
    res.status(500).json({ error: 'Erro ao salvar licença local', detalhes: e.message });
  }
});

// ============ ROTAS DE CONFIGURAÇÕES (admin) ============
/** Lista todas as configurações de uma seção (ou todas). */
app.get('/admin/config', async (req, res) => {
  const { secao } = req.query;
  try {
    const rows = secao
      ? await dbAll('SELECT secao, parametro, valor FROM configuracoes WHERE secao = ? ORDER BY secao, parametro', [secao])
      : await dbAll('SELECT secao, parametro, valor FROM configuracoes ORDER BY secao, parametro');
    // Oculta senhas da resposta
    const safe = rows.map(r => ({
      ...r,
      valor: r.parametro === 'PASS' ? '••••••••' : r.valor
    }));
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Atualiza (ou cria) um parâmetro. */
app.put('/admin/config', async (req, res) => {
  const { secao, parametro, valor } = req.body;
  if (!secao || !parametro || valor == null)
    return badRequest(res, ['secao, parametro e valor são obrigatórios']);
  const secaoClean = sanitize(secao, 30).toUpperCase();
  const paramClean = sanitize(parametro, 30).toUpperCase();
  try {
    await setConfig(secaoClean, paramClean, valor);
    res.json({ ok: true, message: `${secaoClean}.${paramClean} atualizado com sucesso` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Deleta um parâmetro individual. */
app.delete('/admin/config', async (req, res) => {
  const { secao, parametro } = req.body;
  if (!secao || !parametro)
    return badRequest(res, ['secao e parametro são obrigatórios']);
  try {
    await dbRun('DELETE FROM configuracoes WHERE secao = ? AND parametro = ?', [secao, parametro]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rotas administrativas
app.post('/admin/register-user', async (req, res) => {
  const { name, email, password } = req.body;
  const nameClean = sanitize(name, 100);

  const errors = buildErrors([
    [!nameClean, '"name" é obrigatório (máx 100 caracteres)'],
    [!email, '"email" é obrigatório'],
    [email && !isValidEmail(email), 'Formato de e-mail inválido'],
    [!password, '"password" é obrigatória'],
    [password && password.length < 6, 'Senha deve ter pelo menos 6 caracteres'],
    [password && password.length > 200, 'Senha deve ter no máximo 200 caracteres']
  ]);
  if (errors.length) return badRequest(res, errors);

  try {
    // Verificar se email já existe
    const checkResult = await dbGet('SELECT id FROM users WHERE email = ?', [email]);

    if (checkResult) {
      return res.status(400).json({ error: 'Email já cadastrado' });
    }

    // Criar usuário com senha hasheada
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await dbRun(
      'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      [nameClean, sanitize(email, 200).toLowerCase(), hashedPassword]
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

app.put('/admin/users/:id', async (req, res) => {
  const { id } = req.params;
  const { name, email, password } = req.body;
  const nameClean = sanitize(name, 100);

  const errors = buildErrors([
    [!nameClean, '"name" é obrigatório (máx 100 caracteres)'],
    [!email, '"email" é obrigatório'],
    [email && !isValidEmail(email), 'Formato de e-mail inválido'],
    [password && password.length > 0 && password.length < 6, 'Senha deve ter pelo menos 6 caracteres'],
    [password && password.length > 200, 'Senha deve ter no máximo 200 caracteres']
  ]);
  if (errors.length) return badRequest(res, errors);

  const emailClean = sanitize(email, 200).toLowerCase();

  try {
    const userExists = await dbGet('SELECT id FROM users WHERE id = ?', [id]);
    if (!userExists) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    // Verificar se o novo email já pertence a outro usuário
    const emailConflict = await dbGet('SELECT id FROM users WHERE email = ? AND id != ?', [emailClean, id]);
    if (emailConflict) {
      return res.status(400).json({ error: 'Email já está em uso por outro usuário' });
    }

    if (password && password.length > 0) {
      const hashedPwd = await bcrypt.hash(password, SALT_ROUNDS);
      await dbRun('UPDATE users SET name = ?, email = ?, password = ? WHERE id = ?', [nameClean, emailClean, hashedPwd, id]);
    } else {
      await dbRun('UPDATE users SET name = ?, email = ? WHERE id = ?', [nameClean, emailClean, id]);
    }

    res.json({ message: 'Usuário atualizado com sucesso' });
  } catch (error) {
    console.error('Erro ao atualizar usuário:', error);
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

// Rota para verificar usuários cadastrados (debug - apenas desenvolvimento)
app.get('/debug/users', devOnly, async (req, res) => {
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

// Rota para inicializar/recriar usuário admin (debug - apenas desenvolvimento)
app.post('/debug/init-admin', devOnly, async (req, res) => {
  try {
    await dbRun('DELETE FROM users WHERE email = ?', [ADMIN_EMAIL]);
    const hashedPwd = await bcrypt.hash(ADMIN_PASSWORD, SALT_ROUNDS);
    await dbRun(
      'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      ['Administrador', ADMIN_EMAIL, hashedPwd]
    );
    console.log('👑 Usuário admin reiniciado com sucesso!');
    res.json({
      message: 'Usuário admin criado com sucesso',
      user: { email: ADMIN_EMAIL }
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
  const nameClean = sanitize(name, 50);
  const errors = buildErrors([
    [!userId, '"userId" é obrigatório'],
    [!nameClean, '"name" é obrigatório (máx 50 caracteres)'],
    [!VALID_TRANSACTION_TYPES.includes(type), '"type" deve ser "entrada" ou "despesa"']
  ]);
  if (errors.length) return badRequest(res, errors);
  try {
    const result = await dbRun(
      'INSERT INTO categories (userId, name, type, icon, color) VALUES (?, ?, ?, ?, ?)',
      [userId, nameClean, type, sanitize(icon, 10) || '💰', sanitize(color, 20) || '#6b7280']
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
  const nameClean = sanitize(name, 50);
  if (!nameClean) return badRequest(res, ['"name" é obrigatório (máx 50 caracteres)']);
  try {
    await dbRun('UPDATE categories SET name = ?, icon = ?, color = ? WHERE id = ?',
      [nameClean, sanitize(icon, 10), sanitize(color, 20), id]);
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
  const desc = sanitize(description, 200);
  const errors = buildErrors([
    [!userId, '"userId" é obrigatório'],
    [!desc, '"description" é obrigatória (máx 200 caracteres)'],
    [!sanitize(category, 100), '"category" é obrigatória'],
    [!isPositiveNum(value), '"value" deve ser um número positivo (máx 999.999.999)'],
    [!VALID_RECURRENCES.includes(frequency), `"frequency" inválida. Use: ${VALID_RECURRENCES.join(', ')}`],
    [!isValidDate(next_due_date), '"next_due_date" deve estar no formato YYYY-MM-DD']
  ]);
  if (errors.length) return badRequest(res, errors);
  try {
    const result = await dbRun(
      'INSERT INTO recurring_expenses (userId, description, category, value, frequency, next_due_date) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, desc, sanitize(category, 100), parseFloat(value), frequency, next_due_date]
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
  const desc = sanitize(description, 200);
  const errors = buildErrors([
    [!desc, '"description" é obrigatória (máx 200 caracteres)'],
    [value != null && !isPositiveNum(value), '"value" deve ser um número positivo'],
    [frequency && !VALID_RECURRENCES.includes(frequency), `"frequency" inválida`],
    [next_due_date && !isValidDate(next_due_date), '"next_due_date" deve estar no formato YYYY-MM-DD']
  ]);
  if (errors.length) return badRequest(res, errors);
  try {
    await dbRun(
      'UPDATE recurring_expenses SET description = ?, category = ?, value = ?, frequency = ?, next_due_date = ?, is_active = ? WHERE id = ?',
      [desc, sanitize(category, 100), value != null ? parseFloat(value) : value, frequency, next_due_date, is_active ?? 1, id]
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
  const errors = buildErrors([
    [!userId, '"userId" é obrigatório'],
    [!sanitize(category, 100), '"category" é obrigatória'],
    [!isPositiveNum(limit_value), '"limit_value" deve ser um número positivo'],
    [!VALID_BUDGET_PERIODS.includes(period), `"period" inválido. Use: ${VALID_BUDGET_PERIODS.join(', ')}`]
  ]);
  if (errors.length) return badRequest(res, errors);
  try {
    const result = await dbRun(
      'INSERT INTO budgets (userId, category, limit_value, period, period_month) VALUES (?, ?, ?, ?, ?)',
      [userId, sanitize(category, 100), parseFloat(limit_value), period, period_month || null]
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
  const errors = buildErrors([
    [limit_value != null && !isPositiveNum(limit_value), '"limit_value" deve ser um número positivo'],
    [period && !VALID_BUDGET_PERIODS.includes(period), '"period" inválido']
  ]);
  if (errors.length) return badRequest(res, errors);
  try {
    await dbRun(
      'UPDATE budgets SET limit_value = ?, period = ?, period_month = ?, is_active = ? WHERE id = ?',
      [limit_value != null ? parseFloat(limit_value) : limit_value, period, period_month, is_active ?? 1, id]
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
  const nameClean = sanitize(name, 50);
  const errors = buildErrors([
    [!userId, '"userId" é obrigatório'],
    [!nameClean, '"name" é obrigatório (máx 50 caracteres)'],
    [!VALID_WALLET_TYPES.includes(type), `"type" inválido. Use: ${VALID_WALLET_TYPES.join(', ')}`],
    [balance != null && !isNonNegativeNum(balance), '"balance" deve ser um número não-negativo']
  ]);
  if (errors.length) return badRequest(res, errors);
  try {
    const result = await dbRun(
      'INSERT INTO wallets (userId, name, type, balance, currency) VALUES (?, ?, ?, ?, ?)',
      [userId, nameClean, type, parseFloat(balance || 0), sanitize(currency, 10) || 'BRL']
    );
    res.json({ id: result.id, message: 'Carteira criada com sucesso' });
  } catch (error) {
    console.error('Erro ao criar carteira:', error);
    if (error.message && error.message.includes('UNIQUE')) {
      return res.status(409).json({ error: `Você já possui uma conta com o nome "${nameClean}". Use um nome diferente.` });
    }
    res.status(500).json({ error: error.message });
  }
});

app.put('/wallets/:id', async (req, res) => {
  const { id } = req.params;
  const { name, balance, is_active } = req.body;
  try {
    // COALESCE mantém o valor existente quando o campo não é enviado
    await dbRun(
      'UPDATE wallets SET name = COALESCE(?, name), balance = COALESCE(?, balance), is_active = COALESCE(?, is_active) WHERE id = ?',
      [name ?? null, balance ?? null, is_active ?? null, id]
    );
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

// Recalcular saldo de uma conta a partir das transações vinculadas
app.post('/wallets/:id/recalculate', async (req, res) => {
  const { id } = req.params;
  try {
    const rows = await dbAll(
      "SELECT type, value FROM transactions WHERE wallet_id = ?",
      [id]
    );
    const balance = rows.reduce((sum, t) => {
      return sum + (t.type === 'entrada' ? parseFloat(t.value) : -parseFloat(t.value));
    }, 0);
    await dbRun('UPDATE wallets SET balance = ? WHERE id = ?', [balance, id]);
    res.json({ balance, message: 'Saldo recalculado com sucesso' });
  } catch (error) {
    console.error('Erro ao recalcular saldo:', error);
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
  const nameClean = sanitize(name, 100);
  const errors = buildErrors([
    [!userId, '"userId" é obrigatório'],
    [!nameClean, '"name" é obrigatório (máx 100 caracteres)'],
    [!isPositiveNum(target_amount), '"target_amount" deve ser um número positivo'],
    [current_amount != null && !isNonNegativeNum(current_amount), '"current_amount" deve ser não-negativo'],
    [deadline && !isValidDate(deadline), '"deadline" deve estar no formato YYYY-MM-DD']
  ]);
  if (errors.length) return badRequest(res, errors);
  try {
    const result = await dbRun(
      'INSERT INTO goals (userId, name, target_amount, current_amount, deadline, category) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, nameClean, parseFloat(target_amount), parseFloat(current_amount || 0), deadline || null, sanitize(category, 100) || null]
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
  const nameClean = sanitize(name, 100);
  const errors = buildErrors([
    [!nameClean, '"name" é obrigatório (máx 100 caracteres)'],
    [target_amount != null && !isPositiveNum(target_amount), '"target_amount" deve ser um número positivo'],
    [current_amount != null && !isNonNegativeNum(current_amount), '"current_amount" deve ser não-negativo'],
    [deadline && !isValidDate(deadline), '"deadline" deve estar no formato YYYY-MM-DD']
  ]);
  if (errors.length) return badRequest(res, errors);
  try {
    await dbRun(
      'UPDATE goals SET name = ?, target_amount = ?, current_amount = ?, deadline = ?, category = ?, is_active = ? WHERE id = ?',
      [nameClean, target_amount, current_amount, deadline, category, is_active ?? 1, id]
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

// ============ ROTAS DE TRANSFERÊNCIAS ============
app.post('/transfers', async (req, res) => {
  const { userId, fromWalletId, toWalletId, amount, description, date } = req.body;

  if (!userId || !fromWalletId || !toWalletId || !amount || !date) {
    return res.status(400).json({ error: 'userId, fromWalletId, toWalletId, amount e date são obrigatórios' });
  }
  if (fromWalletId === toWalletId) {
    return res.status(400).json({ error: 'Contas de origem e destino devem ser diferentes' });
  }

  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) {
    return res.status(400).json({ error: 'Valor deve ser positivo' });
  }

  try {
    const fromWallet = await dbGet('SELECT id, name, balance FROM wallets WHERE id = ? AND userId = ?', [fromWalletId, userId]);
    const toWallet = await dbGet('SELECT id, name, balance FROM wallets WHERE id = ? AND userId = ?', [toWalletId, userId]);

    if (!fromWallet) return res.status(404).json({ error: 'Conta de origem não encontrada' });
    if (!toWallet) return res.status(404).json({ error: 'Conta de destino não encontrada' });
    if (parseFloat(fromWallet.balance) < amt) {
      return res.status(400).json({ error: 'Saldo insuficiente na conta de origem' });
    }

    const desc = description || `Transferência`;
    const descSaida = `${desc} → ${toWallet.name}`;
    const descEntrada = `${desc} ← ${fromWallet.name}`;

    // 1. Criar transação de saída (debita da origem)
    const txSaida = await dbRun(
      'INSERT INTO transactions (type, description, category, value, date, userId, wallet_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['despesa', descSaida, 'transferencia', amt, date, userId, fromWalletId]
    );

    // 2. Criar transação de entrada (credita no destino)
    const txEntrada = await dbRun(
      'INSERT INTO transactions (type, description, category, value, date, userId, wallet_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['entrada', descEntrada, 'transferencia', amt, date, userId, toWalletId]
    );

    // 3. Vincular as duas transações com transfer_ref
    await dbRun('UPDATE transactions SET transfer_ref = ? WHERE id = ?', [txEntrada.id, txSaida.id]);
    await dbRun('UPDATE transactions SET transfer_ref = ? WHERE id = ?', [txSaida.id, txEntrada.id]);

    // 4. Atualizar saldos
    await dbRun('UPDATE wallets SET balance = balance - ? WHERE id = ?', [amt, fromWalletId]);
    await dbRun('UPDATE wallets SET balance = balance + ? WHERE id = ?', [amt, toWalletId]);

    setTimeout(() => backupData(), 100);

    res.json({
      message: 'Transferência realizada com sucesso',
      txSaidaId: txSaida.id,
      txEntradaId: txEntrada.id,
      from: fromWallet.name,
      to: toWallet.name,
      amount: amt
    });
  } catch (error) {
    console.error('Erro na transferência:', error);
    res.status(500).json({ error: error.message });
  }
});

// Buscar histórico de transferências do usuário
app.get('/transfers', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId é obrigatório' });
  try {
    const result = await dbAll(
      `SELECT * FROM transactions WHERE userId = ? AND category = 'transferencia' ORDER BY date DESC, created_at DESC`,
      [userId]
    );
    res.json(result);
  } catch (error) {
    console.error('Erro ao buscar transferências:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ EXCHANGE RATES ============
// Cache de câmbio: atualiza a cada 6 horas
let ratesCache = null;
let ratesCacheTime = 0;
const RATES_TTL_MS = 6 * 60 * 60 * 1000; // 6h

app.get('/exchange-rates', async (req, res) => {
  const now = Date.now();
  if (ratesCache && (now - ratesCacheTime < RATES_TTL_MS)) {
    return res.json({ ...ratesCache, cached: true });
  }
  try {
    // API pública gratuita sem chave — base: BRL
    const fetch = (await import('node-fetch')).default;
    const apiRes = await fetch('https://open.er-api.com/v6/latest/BRL');
    if (!apiRes.ok) throw new Error('upstream error');
    const data = await apiRes.json();
    if (data.result !== 'success') throw new Error('API retornou erro');
    ratesCache = { base: 'BRL', rates: data.rates, time_last_update: data.time_last_update_utc };
    ratesCacheTime = now;
    res.json(ratesCache);
  } catch (err) {
    // Fallback com taxas aproximadas (atualizadas manualmente)
    console.warn('exchange-rates fallback:', err.message);
    const fallback = {
      base: 'BRL',
      rates: { BRL: 1, USD: 0.175, EUR: 0.162, GBP: 0.138, ARS: 178, JPY: 26.5, CLP: 163, COP: 705, MXN: 3.05, PYG: 1268, UYU: 7.1 },
      time_last_update: 'Fallback (offline)',
      cached: false,
    };
    res.json(fallback);
  }
});

// ============ SEND EMAIL SUMMARY ============
app.post('/send-email-summary', authenticateToken, async (req, res) => {
  const { email, notifications } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ message: 'E-mail inválido.' });
  }
  if (!Array.isArray(notifications) || notifications.length === 0) {
    return res.status(400).json({ message: 'Nenhuma notificação para enviar.' });
  }

  // Monta HTML do resumo
  const rows = notifications.map(n => `
    <tr>
      <td style="padding:8px 12px;font-size:14px;">${n.icon}</td>
      <td style="padding:8px 12px;font-size:14px;font-weight:600;color:#1e293b;">${n.title}</td>
      <td style="padding:8px 12px;font-size:13px;color:#475569;">${n.body}</td>
      <td style="padding:8px 12px;font-size:12px;color:#94a3b8;">${n.date || ''}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<title>Resumo de Notificações — Gestor Financeiro</title></head>
<body style="font-family:sans-serif;background:#f8fafc;padding:24px;">
  <div style="max-width:600px;margin:auto;background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.08);overflow:hidden;">
    <div style="background:#6366f1;padding:20px 24px;">
      <h1 style="color:#fff;margin:0;font-size:1.3rem;">💰 Gestor Financeiro</h1>
      <p style="color:#c7d2fe;margin:4px 0 0;font-size:0.9rem;">Resumo de Notificações</p>
    </div>
    <div style="padding:20px 24px;">
      <p style="color:#475569;font-size:0.9rem;margin-top:0;">
        Você possui <strong>${notifications.length}</strong> notificação(ões) ativa(s):
      </p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #f1f5f9;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:8px 12px;text-align:left;font-size:12px;color:#94a3b8;width:32px;"></th>
            <th style="padding:8px 12px;text-align:left;font-size:12px;color:#94a3b8;">Tipo</th>
            <th style="padding:8px 12px;text-align:left;font-size:12px;color:#94a3b8;">Detalhe</th>
            <th style="padding:8px 12px;text-align:left;font-size:12px;color:#94a3b8;">Data</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:20px;font-size:0.8rem;color:#94a3b8;">
        Enviado em ${new Date().toLocaleString('pt-BR')} · Gestor Financeiro
      </p>
    </div>
  </div>
</body></html>`;

  try {
    await sendEmail({
      to: email,
      subject: `🔔 Resumo de Notificações — Gestor Financeiro (${notifications.length})`,
      html,
    });
    console.log(`📧 E-mail enviado para ${email}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao enviar e-mail:', err.message);
    res.status(500).json({ message: 'Erro ao enviar e-mail: ' + err.message });
  }
});

