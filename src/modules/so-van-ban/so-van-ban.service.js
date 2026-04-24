const repository = require('./so-van-ban.repository');
const db = require('../../../config/db');

class AppError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
    }
}

class SoVanBanService {
    // ════════════════════════════════════════════
    // SỔ VĂN BẢN
    // ════════════════════════════════════════════
    async getAllBooks(orgId, bookType) {
        return await repository.findAllBooks(orgId, bookType);
    }

    async createBook(data, userId, orgId) {
        // Validation basic
        if (!data.name || !data.book_type) {
            throw new AppError(400, 'Tên sổ và loại sổ là bắt buộc');
        }

        const bookData = {
            ...data,
            agency_id: data.agency_id || null,
            department_id: data.department_id || null,
            current_number: data.current_number || 1,
            auto_increment: data.auto_increment !== undefined ? data.auto_increment : true,
            is_default: data.is_default !== undefined ? data.is_default : false,
            org_id: orgId,
            created_by: userId
        };

        return await repository.createBook(bookData);
    }

    async updateBook(id, data, orgId) {
        const book = await repository.findAllBooks(orgId);
        const existing = book.find(b => b.id === parseInt(id));
        if (!existing) {
            throw new AppError(404, 'Không tìm thấy sổ văn bản');
        }
        return await repository.updateBook(id, data);
    }

    async deleteBook(id, orgId) {
        // Kiểm tra xem đã có văn bản nào dùng sổ này chưa (để sau)
        const deleted = await repository.deleteBook(id, orgId);
        if (!deleted) {
            throw new AppError(404, 'Không tìm thấy sổ văn bản để xóa');
        }
        return { message: 'Xóa sổ văn bản thành công', id };
    }

    // ════════════════════════════════════════════
    // KÝ HIỆU VĂN BẢN
    // ════════════════════════════════════════════
    async getAllSymbols(orgId) {
        return await repository.findAllSymbols(orgId);
    }

    async createSymbol(data, userId, orgId) {
        if (!data.name) {
            throw new AppError(400, 'Tên ký hiệu là bắt buộc');
        }

        const symbolData = {
            name: data.name,
            display_order: data.display_order || 1,
            document_type: data.document_type || null,
            org_id: orgId,
            created_by: userId
        };

        return await repository.createSymbol(symbolData);
    }

    async updateSymbol(id, data, orgId) {
        const symbols = await repository.findAllSymbols(orgId);
        const existing = symbols.find(s => s.id === parseInt(id));
        if (!existing) {
            throw new AppError(404, 'Không tìm thấy ký hiệu văn bản');
        }
        return await repository.updateSymbol(id, data);
    }

    async deleteSymbol(id, orgId) {
        const deleted = await repository.deleteSymbol(id, orgId);
        if (!deleted) {
            throw new AppError(404, 'Không tìm thấy ký hiệu văn bản để xóa');
        }
        return { message: 'Xóa ký hiệu thành công', id };
    }
}

module.exports = new SoVanBanService();
