const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function runMigration() {
    try {
        const sqlPath = path.join(__dirname, '005_document_book_entries.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Running migration 005_document_book_entries.sql...');
        await pool.query(sql);
        console.log('Migration 005 completed successfully.');
    } catch (err) {
        console.error('Migration failed:', err.message);
    } finally {
        await pool.end();
    }
}

runMigration();
