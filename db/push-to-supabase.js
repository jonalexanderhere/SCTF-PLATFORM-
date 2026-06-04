const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
// Manual env parser to avoid external dependency
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


async function pushToSupabase() {
    let connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL;
    
    if (connectionString) {
        // Remove sslmode from connection string to avoid overriding our explicit config
        connectionString = connectionString.replace(/sslmode=[^&]+&?/, '').replace(/\?$/, '').replace(/\?&/, '?');
    }

    console.log('Connecting to Supabase...');
    const client = new Client({
        connectionString: connectionString,
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        await client.connect();
        console.log('Connected successfully.');

        const sqlPath = path.join(__dirname, 'init.sql');
        if (!fs.existsSync(sqlPath)) {
            console.error('Error: db/init.sql not found. Run npm run setup first.');
            process.exit(1);
        }

        const sql = fs.readFileSync(sqlPath, 'utf8');
        console.log('Executing SQL from db/init.sql...');
        
        // Split by a custom marker if needed, but usually Client.query handles multiple statements
        // However, Supabase/Postgres might have issues with very large scripts in one go.
        // We'll try the whole thing first.
        await client.query(sql);

        console.log('Successfully pushed all SQL to Supabase!');
    } catch (err) {
        console.error('Error executing SQL:');
        console.error(err.message);
        if (err.detail) console.error('Detail:', err.detail);
        if (err.where) console.error('Where:', err.where);
        process.exit(1);
    } finally {
        await client.end();
    }
}

pushToSupabase();
