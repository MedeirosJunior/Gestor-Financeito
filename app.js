const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

const db = new sqlite3.Database('./finance.db');

// Criação das tabelas
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT, -- 'entrada' ou 'saida'
    description TEXT,
    value REAL,
    date TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS faturamento (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month TEXT,
    value REAL
  )`);
});

// Rotas
app.get('/transactions', (req, res) => {
  db.all('SELECT * FROM transactions', [], (err, rows) => {
    res.json(rows);
  });
});

app.post('/transactions', (req, res) => {
  const { type, description, value, date } = req.body;
  db.run(
    'INSERT INTO transactions (type, description, value, date) VALUES (?, ?, ?, ?)',
    [type, description, value, date],
    function () {
      res.json({ id: this.lastID });
    }
  );
});

app.get('/faturamento', (req, res) => {
  db.all('SELECT * FROM faturamento', [], (err, rows) => {
    res.json(rows);
  });
});

app.post('/faturamento', (req, res) => {
  const { month, value } = req.body;
  db.run(
    'INSERT INTO faturamento (month, value) VALUES (?, ?)',
    [month, value],
    function () {
      res.json({ id: this.lastID });
    }
  );
});

// Relatório simples
app.get('/relatorio', (req, res) => {
  db.all('SELECT type, SUM(value) as total FROM transactions GROUP BY type', [], (err, rows) => {
    res.json(rows);
  });
});

app.listen(3001, () => console.log('Backend rodando na porta 3001'));
