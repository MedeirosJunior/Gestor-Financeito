import React, { useState, useEffect } from 'react';

function App() {
  const [tab, setTab] = useState('lancamentos');
  return (
    <div>
      <h1>Controle Financeiro</h1>
      <nav>
        <button onClick={() => setTab('lancamentos')}>Lançamentos</button>
        <button onClick={() => setTab('faturamento')}>Faturamento</button>
        <button onClick={() => setTab('relatorio')}>Relatório</button>
      </nav>
      {tab === 'lancamentos' && <Lancamentos />}
      {tab === 'faturamento' && <Faturamento />}
      {tab === 'relatorio' && <Relatorio />}
    </div>
  );
}

// Componente de lançamentos
function Lancamentos() {
  const [transactions, setTransactions] = useState([]);
  const [form, setForm] = useState({ type: 'entrada', description: '', value: '', date: '' });

  useEffect(() => {
    fetch('http://localhost:3001/transactions')
      .then(res => res.json())
      .then(setTransactions);
  }, []);

  function handleSubmit(e) {
    e.preventDefault();
    fetch('http://localhost:3001/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    }).then(() => window.location.reload());
  }

  return (
    <div>
      <h2>Lançamentos</h2>
      <form onSubmit={handleSubmit}>
        <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
          <option value="entrada">Entrada</option>
          <option value="saida">Saída</option>
        </select>
        <input placeholder="Descrição" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
        <input type="number" placeholder="Valor" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} />
        <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
        <button type="submit">Cadastrar</button>
      </form>
      <ul>
        {transactions.map(t => (
          <li key={t.id}>{t.date} - {t.type} - {t.description} - R$ {t.value}</li>
        ))}
      </ul>
    </div>
  );
}

// Componente de faturamento
function Faturamento() {
  const [faturamento, setFaturamento] = useState([]);
  const [form, setForm] = useState({ month: '', value: '' });

  useEffect(() => {
    fetch('http://localhost:3001/faturamento')
      .then(res => res.json())
      .then(setFaturamento);
  }, []);

  function handleSubmit(e) {
    e.preventDefault();
    fetch('http://localhost:3001/faturamento', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    }).then(() => window.location.reload());
  }

  return (
    <div>
      <h2>Faturamento Mensal</h2>
      <form onSubmit={handleSubmit}>
        <input type="month" value={form.month} onChange={e => setForm({ ...form, month: e.target.value })} />
        <input type="number" placeholder="Valor" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} />
        <button type="submit">Cadastrar</button>
      </form>
      <ul>
        {faturamento.map(f => (
          <li key={f.id}>{f.month} - R$ {f.value}</li>
        ))}
      </ul>
    </div>
  );
}

// Componente de relatório
function Relatorio() {
  const [relatorio, setRelatorio] = useState([]);

  useEffect(() => {
    fetch('http://localhost:3001/relatorio')
      .then(res => res.json())
      .then(setRelatorio);
  }, []);

  return (
    <div>
      <h2>Relatório</h2>
      <ul>
        {relatorio.map(r => (
          <li key={r.type}>{r.type}: R$ {r.total}</li>
        ))}
      </ul>
      {/* Projeção simples */}
      <h3>Projeção</h3>
      {relatorio.length === 2 && (
        <div>
          Saldo: R$ {relatorio[0].total - relatorio[1].total}
        </div>
      )}
    </div>
  );
}

export default App;