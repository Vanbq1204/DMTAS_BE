const { Client } = require('pg');
const fs = require('fs');

async function run() {
    const client = new Client({
        user: 'vanbui',
        host: 'localhost',
        database: 'dms_db',
        password: '',
        port: 5432,
    });

    try {
        await client.connect();

        const users = await client.query("SELECT id, email, full_name, department_id FROM users WHERE role='van_thu'");
        const orgs = await client.query("SELECT * FROM organizations");
        const org_unit_names = await client.query("SELECT * FROM org_unit_names");

        fs.writeFileSync('db_dump.json', JSON.stringify({
            users: users.rows,
            orgs: orgs.rows,
            org_unit_names: org_unit_names.rows
        }, null, 2));

    } catch (err) {
        fs.writeFileSync('db_dump.json', JSON.stringify({ error: err.stack }));
    } finally {
        await client.end();
    }
}

run();
