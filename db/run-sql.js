const fs = require('fs');
const { Client } = require('pg');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Manual env parser
const envContent = fs.readFileSync('.env.local', 'utf8');
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
        let val = match[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        process.env[match[1].trim()] = val;
    }
});

async function runSql() {
    const sqlFile = process.argv[2] || 'db/update-team-limit.sql';
    console.log(`Running SQL from: ${sqlFile}`);
    const sql = fs.readFileSync(sqlFile, 'utf8');

    const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL;
    const client = new Client({
        connectionString: connectionString.replace(/sslmode=[^&]+&?/, '').replace(/\?$/, '').replace(/\?&/, '?'),
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        await client.query(sql);
        console.log('SQL executed successfully.');
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}

runSql();
