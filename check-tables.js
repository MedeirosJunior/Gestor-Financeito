const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const dbPath = './data/database.db';

if (!fs.existsSync(dbPath)) {
    console.error(`❌ Banco de dados não encontrado em ${dbPath}`);
    process.exit(1);
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Erro ao conectar:', err);
        process.exit(1);
    }

    console.log('✅ Conectado ao banco de dados');

    // Listar todas as tabelas
    db.all(
        "SELECT name FROM sqlite_master WHERE type='table'",
        (err, tables) => {
            if (err) {
                console.error('❌ Erro ao buscar tabelas:', err);
                process.exit(1);
            }

            if (tables.length === 0) {
                console.log('❌ Nenhuma tabela encontrada!');
                process.exit(1);
            }

            console.log('\n📊 Tabelas encontradas:');
            tables.forEach(table => {
                console.log(`  - ${table.name}`);
            });

            // Verificar estrutura de cada tabela
            console.log('\n📋 Detalhes das tabelas:\n');

            tables.forEach(table => {
                db.all(`PRAGMA table_info(${table.name})`, (err, cols) => {
                    if (err) {
                        console.error(`❌ Erro ao buscar colunas de ${table.name}:`, err);
                        return;
                    }

                    console.log(`${table.name}:`);
                    cols.forEach(col => {
                        console.log(`  - ${col.name} (${col.type}) ${col.notnull ? 'NOT NULL' : ''}`);
                    });

                    // Contar registros
                    db.get(`SELECT COUNT(*) as count FROM ${table.name}`, (err, result) => {
                        if (err) {
                            console.error(`  ❌ Erro ao contar linhas:`, err);
                            return;
                        }
                        console.log(`  📈 Registros: ${result.count}\n`);
                    });
                });
            });

            // Fechar conexão após 2 segundos
            setTimeout(() => {
                db.close(() => {
                    console.log('✅ Conexão fechada');
                    process.exit(0);
                });
            }, 2000);
        }
    );
});
