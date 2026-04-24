const service = require('./so-van-ban.service');

class SoVanBanController {
    // ════════════════════════════════════════════
    // SỔ VĂN BẢN
    // ════════════════════════════════════════════
    async getAllBooks(req, res, next) {
        try {
            const orgId = req.user.orgId;
            const bookType = req.query.book_type;
            const books = await service.getAllBooks(orgId, bookType);
            res.json({
                status: 'success',
                data: books
            });
        } catch (error) {
            next(error);
        }
    }

    async createBook(req, res, next) {
        try {
            const userId = req.user.id;
            const orgId = req.user.orgId;
            const newBook = await service.createBook(req.body, userId, orgId);
            res.status(201).json({
                status: 'success',
                data: newBook
            });
        } catch (error) {
            console.error('Lỗi khi tạo sổ:', error);
            res.status(error.statusCode || 500).json({ message: error.message, error });
        }
    }

    async updateBook(req, res, next) {
        try {
            const orgId = req.user.orgId;
            const updatedBook = await service.updateBook(req.params.id, req.body, orgId);
            res.json({
                status: 'success',
                data: updatedBook
            });
        } catch (error) {
            next(error);
        }
    }

    async deleteBook(req, res, next) {
        try {
            const orgId = req.user.orgId;
            const result = await service.deleteBook(req.params.id, orgId);
            res.json({
                status: 'success',
                data: result
            });
        } catch (error) {
            next(error);
        }
    }

    // ════════════════════════════════════════════
    // KÝ HIỆU VĂN BẢN
    // ════════════════════════════════════════════
    async getAllSymbols(req, res, next) {
        try {
            const orgId = req.user.orgId;
            const symbols = await service.getAllSymbols(orgId);
            res.json({
                status: 'success',
                data: symbols
            });
        } catch (error) {
            next(error);
        }
    }

    async createSymbol(req, res, next) {
        try {
            const userId = req.user.id;
            const orgId = req.user.orgId;
            const newSymbol = await service.createSymbol(req.body, userId, orgId);
            res.status(201).json({
                status: 'success',
                data: newSymbol
            });
        } catch (error) {
            console.error('Lỗi khi tạo ký hiệu:', error);
            res.status(error.statusCode || 500).json({ message: error.message, error });
        }
    }

    async updateSymbol(req, res, next) {
        try {
            const orgId = req.user.orgId;
            const updatedSymbol = await service.updateSymbol(req.params.id, req.body, orgId);
            res.json({
                status: 'success',
                data: updatedSymbol
            });
        } catch (error) {
            next(error);
        }
    }

    async deleteSymbol(req, res, next) {
        try {
            const orgId = req.user.orgId;
            const result = await service.deleteSymbol(req.params.id, orgId);
            res.json({
                status: 'success',
                data: result
            });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new SoVanBanController();
