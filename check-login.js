const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/database.db', (err) => {
    if (err) {
        console.error('Erro:', err);
        process.exit(1);
    }

    db.all('SELECT * FROM users', (err, rows) => {
        if (err) {
            console.error('Erro ao buscar:', err);
            process.exit(1);
        }

        console.log('\n📊 Usuários no banco:');
        console.log(JSON.stringify(rows, null, 2));

        // Tentar fazer login
        if (rows.length > 0) {
            const adminRow = rows.find(r => r.email === 'junior395@gmail.com');
            console.log('\n🔍 Tentando login com admin:');
            console.log('Email: junior395@gmail.com');
            console.log('Senha esperada: j991343519*/*');
            console.log('Senha no BD:', adminRow ? adminRow.password : 'NÃO ENCONTRADO');
            console.log('Match:', adminRow && adminRow.password === 'j991343519*/*' ? '✅ SIM' : '❌ NÃO');
        }

        db.close();
    });
});
