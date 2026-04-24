const db = require('../../../config/db');

class SoVanBanRepository {
    // ════════════════════════════════════════════
    // QUẢN LÝ SỔ VĂN BẢN (document_books)
    // ════════════════════════════════════════════
    async findAllBooks(orgId, bookType = null) {
        let query = `
            SELECT b.*, 
                   un_dept.name as department_name,
                   un_agency.name as agency_name,
                   u.full_name as creator_name
            FROM document_books b
            LEFT JOIN organizations o_dept ON b.org_id = o_dept.id
            LEFT JOIN org_unit_names un_dept ON o_dept.name_id = un_dept.id
            LEFT JOIN organizations o_agency ON o_dept.parent_id = o_agency.id
            LEFT JOIN org_unit_names un_agency ON o_agency.name_id = un_agency.id
            LEFT JOIN users u ON b.created_by = u.id
            WHERE b.org_id = $1
        `;
        const params = [orgId];
        if (bookType) {
            query += ` AND b.book_type = $2`;
            params.push(bookType);
        }
        query += ` ORDER BY b.id DESC`;

        const { rows } = await db.query(query, params);
        return rows;
    }

    async createBook(data) {
        const { name, book_type, agency_id, department_id, current_number, auto_increment, is_default, org_id, created_by, document_type, symbol } = data;
        const query = `
            INSERT INTO document_books (name, book_type, agency_id, department_id, current_number, auto_increment, is_default, org_id, created_by, document_type, symbol)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
        `;
        const params = [name, book_type, agency_id, department_id, current_number, auto_increment, is_default, org_id, created_by, document_type, symbol];
        const { rows } = await db.query(query, params);
        return rows[0];
    }

    async updateBook(id, data) {
        const fields = [];
        const params = [];
        let i = 1;
        for (const [key, value] of Object.entries(data)) {
            if (value !== undefined) {
                fields.push(`${key} = $${i}`);
                params.push(value);
                i++;
            }
        }
        params.push(id);
        const query = `UPDATE document_books SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`;
        const { rows } = await db.query(query, params);
        return rows[0];
    }

    async deleteBook(id, orgId) {
        const query = `DELETE FROM document_books WHERE id = $1 AND org_id = $2 RETURNING id`;
        const { rows } = await db.query(query, [id, orgId]);
        return rows[0];
    }

    // ════════════════════════════════════════════
    // QUẢN LÝ KÝ HIỆU VĂN BẢN (document_symbols)
    // ════════════════════════════════════════════
    async findAllSymbols(orgId) {
        const query = `
            SELECT s.*, u.full_name as creator_name
            FROM document_symbols s
            LEFT JOIN users u ON s.created_by = u.id
            WHERE s.org_id = $1
            ORDER BY s.display_order ASC, s.id DESC
        `;
        const { rows } = await db.query(query, [orgId]);
        return rows;
    }

    async createSymbol(data) {
        const { name, display_order, org_id, created_by, document_type } = data;
        const query = `
            INSERT INTO document_symbols (name, display_order, org_id, created_by, document_type)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `;
        const { rows } = await db.query(query, [name, display_order, org_id, created_by, document_type]);
        return rows[0];
    }

    async updateSymbol(id, data) {
        const fields = [];
        const params = [];
        let i = 1;
        for (const [key, value] of Object.entries(data)) {
            if (value !== undefined) {
                fields.push(`${key} = $${i}`);
                params.push(value);
                i++;
            }
        }
        params.push(id);
        const query = `UPDATE document_symbols SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`;
        const { rows } = await db.query(query, params);
        return rows[0];
    }

    async deleteSymbol(id, orgId) {
        const query = `DELETE FROM document_symbols WHERE id = $1 AND org_id = $2 RETURNING id`;
        const { rows } = await db.query(query, [id, orgId]);
        return rows[0];
    }
}

module.exports = new SoVanBanRepository();
