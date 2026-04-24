const db = require('./config/db');

async function migrate() {
    try {
        await db.query(`BEGIN`);

        // Add name_id column
        await db.query(`ALTER TABLE position_titles ADD COLUMN name_id INTEGER;`);

        // Map existing org_id to name_id
        await db.query(`
            UPDATE position_titles pt 
            SET name_id = o.name_id 
            FROM organizations o 
            WHERE pt.org_id = o.id;
        `);

        // Drop old org_id constraints
        await db.query(`ALTER TABLE position_titles DROP CONSTRAINT IF EXISTS position_titles_org_id_title_key;`);
        await db.query(`ALTER TABLE position_titles DROP CONSTRAINT IF EXISTS position_titles_org_id_fkey;`);

        // Drop org_id column
        await db.query(`ALTER TABLE position_titles DROP COLUMN org_id;`);

        // Make name_id not null and add constraints
        await db.query(`ALTER TABLE position_titles ALTER COLUMN name_id SET NOT NULL;`);
        await db.query(`
            ALTER TABLE position_titles 
            ADD CONSTRAINT position_titles_name_id_fkey 
            FOREIGN KEY (name_id) REFERENCES org_unit_names(id) ON DELETE CASCADE;
        `);
        await db.query(`
            ALTER TABLE position_titles 
            ADD CONSTRAINT position_titles_name_id_title_key 
            UNIQUE (name_id, title);
        `);

        await db.query(`COMMIT`);
        console.log("Migration successful: position_titles now links to org_unit_names!");
    } catch (e) {
        await db.query(`ROLLBACK`);
        console.error("Migration failed:", e.message);
    }
    process.exit();
}

migrate();
