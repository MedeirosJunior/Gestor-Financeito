/**
 * Middleware de Validação de Licença - MySQL Central
 * Arquivo: middleware/validarLicencaMySQL.js
 *
 * Padrão idêntico ao transporte-escolar.
 *
 * Fluxo:
 * 1. Busca licença LOCAL na tabela licenca_local (Turso/SQLite via dbGet)
 * 2. Compara campo-a-campo com o banco CENTRAL MySQL (controle_clientes)
 * 3. Se tudo bater → acesso liberado; caso contrário → 403
 *
 * Uso (em server.js, após dbGet/dbRun estarem definidos):
 *   const { validarLicencaMiddleware } = require('./middleware/validarLicencaMySQL')(dbGet, dbRun);
 *   app.use((req, res, next) => {
 *     if (req.path.startsWith('/auth') || req.path.startsWith('/admin/licenca')) return next();
 *     validarLicencaMiddleware(req, res, next);
 *   });
 */

const mysql = require('mysql2/promise');

// ── Configuração MySQL (banco central de licenças) ──────────────────────────
const mysqlConfigured = !!(
    process.env.MYSQL_HOST &&
    process.env.MYSQL_USER &&
    process.env.MYSQL_PASSWORD &&
    process.env.MYSQL_DATABASE
);

const dbConfig = mysqlConfigured ? {
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    connectTimeout: 10000,
    enableKeepAlive: true,
    ...(process.env.MYSQL_SSL === 'true' ? { ssl: { rejectUnauthorized: true } } : {}),
} : null;

if (mysqlConfigured) {
    console.log(`📦 Licenças MySQL: ✅ ATIVADO (${process.env.MYSQL_USER}@${process.env.MYSQL_HOST}:${process.env.MYSQL_PORT || 3306}/${process.env.MYSQL_DATABASE})`);
} else {
    console.warn('🔒 Licenças MySQL: ❌ NÃO CONFIGURADO — TODAS as rotas protegidas serão BLOQUEADAS.');
}

// ── Cache em memória (5 minutos) ─────────────────────────────────────────────
const cache = new Map();
const CACHE_DURATION = 5 * 60 * 1000;

// ── Consulta ao banco CENTRAL MySQL ──────────────────────────────────────────
async function consultarLicencaCentral(cnpj, codigoDoCliente = null) {
    if (!mysqlConfigured || !dbConfig) {
        return { _naoConfigurado: true };
    }

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);

        let sql = `
            SELECT
                l.CodigoDaLicenca,
                l.CodigoDoCliente,
                l.CodigoDoProduto,
                l.CNPJ,
                l.Versao,
                l.Situacao,
                l.DataLiberacao,
                l.DataExpiracao,
                l.Observacoes,
                c.RazaoSocial
            FROM licencas l
            LEFT JOIN clientes c ON l.CodigoDoCliente = c.CodigoDoCliente
            WHERE l.CNPJ = ?
        `;
        const params = [cnpj];
        if (codigoDoCliente != null) {
            sql += ' AND l.CodigoDoCliente = ?';
            params.push(codigoDoCliente);
        }
        sql += ' ORDER BY l.DataExpiracao DESC LIMIT 1';

        const [rows] = await connection.execute(sql, params);
        if (rows.length === 0) return null;

        console.log(`✅ Licença encontrada no MySQL: ${rows[0].RazaoSocial || rows[0].CNPJ}`);
        return rows[0];
    } catch (error) {
        console.error('❌ Erro ao consultar licença central MySQL:', error.message);
        return { _erroConexao: true, mensagem: error.message };
    } finally {
        if (connection) await connection.end();
    }
}

// ── Registrar acesso (log no MySQL, opcional) ─────────────────────────────────
async function registrarAcesso(cnpj, valida, mensagem) {
    if (!mysqlConfigured || !dbConfig) return;

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS logs_validacao (
                id INT AUTO_INCREMENT PRIMARY KEY,
                cnpj VARCHAR(20) NOT NULL,
                data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                valida BOOLEAN NOT NULL,
                mensagem TEXT,
                INDEX idx_cnpj (cnpj),
                INDEX idx_data (data_hora)
            )
        `);
        await connection.execute(
            'INSERT INTO logs_validacao (cnpj, valida, mensagem) VALUES (?, ?, ?)',
            [cnpj, valida ? 1 : 0, mensagem]
        );
    } catch (_) {
        // Falha no log não deve impedir a operação
    } finally {
        if (connection) await connection.end();
    }
}

// ── Validação das regras de negócio ──────────────────────────────────────────
function validarLicenca(licenca) {
    if (!licenca) {
        return { valida: false, mensagem: 'Licença não encontrada no banco central' };
    }

    if (licenca._naoConfigurado) {
        return { valida: false, mensagem: 'Banco de licenças não configurado. Contate o administrador.' };
    }

    if (licenca._erroConexao) {
        console.error(`❌ MySQL indisponível: ${licenca.mensagem}`);
        return { valida: false, mensagem: 'Serviço de licenças indisponível. Tente novamente mais tarde.' };
    }

    const situacao = String(licenca.Situacao || '').toLowerCase();
    if (situacao !== 'ativo') {
        return { valida: false, mensagem: `Licença ${licenca.Situacao || 'desconhecida'}. Contate o administrador.` };
    }

    if (licenca.DataExpiracao) {
        const agora = new Date();
        const exp = new Date(licenca.DataExpiracao);
        const expFimDoDia = new Date(exp.getFullYear(), exp.getMonth(), exp.getDate(), 23, 59, 59, 999);
        if (expFimDoDia < agora) {
            return { valida: false, mensagem: 'Licença expirada. Renove sua licença.' };
        }
    }

    return { valida: true, mensagem: 'Licença válida', licenca };
}

// ── Cache helper ──────────────────────────────────────────────────────────────
async function obterLicenca(cnpj) {
    const cached = cache.get(cnpj);
    if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
        console.log('📦 Licença obtida do cache');
        return cached.data;
    }
    console.log('🔍 Consultando licença no banco central MySQL...');
    const licenca = await consultarLicencaCentral(cnpj);
    cache.set(cnpj, { timestamp: Date.now(), data: licenca });
    return licenca;
}

function limparCache(cnpj = null) {
    if (cnpj) { cache.delete(cnpj); }
    else { cache.clear(); }
}

// ── Factory: recebe dbGet/dbRun do server.js ──────────────────────────────────
module.exports = function createLicencaMiddleware(dbGet, dbRun) {

    /**
     * Middleware Express — use APÓS definir as rotas de auth.
     */
    async function validarLicencaMiddleware(req, res, next) {
        try {
            // 1. Buscar licença local na tabela licenca_local
            const local = await dbGet(
                'SELECT * FROM licenca_local ORDER BY id DESC LIMIT 1', []
            );

            // Sem licença local cadastrada → bloquear sempre
            if (!local) {
                return res.status(403).json({
                    error: 'Acesso negado',
                    motivo: 'Licença não configurada neste sistema.',
                    detalhes: 'Contate o administrador para ativar a licença.',
                    bloqueado: true,
                });
            }

            // 2. Há licença local → comparar campo-a-campo com banco central
            const central = await consultarLicencaCentral(
                local.CNPJ,
                local.CodigoDoCliente || null
            );

            // Verificar sentinelas antes de comparar campos
            if (!central || central._naoConfigurado || central._erroConexao) {
                const motivo = !central
                    ? 'Licença não encontrada no banco central'
                    : central._naoConfigurado
                        ? 'Banco de licenças não configurado'
                        : `Serviço de licenças indisponível: ${central.mensagem}`;
                await registrarAcesso(local.CNPJ, false, motivo);
                return res.status(403).json({
                    error: 'Acesso negado',
                    motivo,
                    detalhes: 'Contate o administrador.',
                });
            }

            // 3. Comparar campos locais com campos do central
            const fields = [
                { local: 'CodigoDoCliente', central: 'CodigoDoCliente' },
                { local: 'CodigoDaLicenca', central: 'CodigoDaLicenca' },
                { local: 'CodigoDoProduto', central: 'CodigoDoProduto' },
                { local: 'CNPJ', central: 'CNPJ' },
                { local: 'Versao', central: 'Versao' },
                { local: 'Situacao', central: 'Situacao' },
            ];

            const diffs = [];
            for (const f of fields) {
                const l = local[f.local] == null ? null : String(local[f.local]).trim();
                const c = central[f.central] == null ? null : String(central[f.central]).trim();

                const normalizar = (v) => (v || '').toLowerCase();
                if (f.local === 'Situacao' || f.local === 'Versao') {
                    if (normalizar(l) !== normalizar(c)) diffs.push(f.local);
                } else {
                    if (l !== c) diffs.push(f.local);
                }
            }

            if (diffs.length > 0) {
                const msg = `Licença divergente nos campos: ${diffs.join(', ')}`;
                await registrarAcesso(local.CNPJ, false, msg);
                return res.status(403).json({
                    error: 'Acesso negado',
                    motivo: 'Licença divergente',
                    detalhes: msg,
                });
            }

            // 4. Verificar Situacao e expiração no central
            const validacao = validarLicenca(central);
            if (!validacao.valida) {
                await registrarAcesso(local.CNPJ, false, validacao.mensagem);
                return res.status(403).json({
                    error: 'Licença inválida',
                    mensagem: validacao.mensagem,
                    bloqueado: true,
                });
            }

            await registrarAcesso(local.CNPJ, true, 'Licença validada com sucesso');
            req.licenca = central;
            return next();

        } catch (error) {
            console.error('❌ Erro ao validar licença:', error);
            return res.status(500).json({
                error: 'Erro interno ao verificar licença. Tente novamente.',
            });
        }
    }

    return {
        validarLicencaMiddleware,
        consultarLicencaCentral,
        limparCache,
        mysqlConfigured,
    };
};
