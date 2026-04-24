const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let io = null;

const SECRET = process.env.JWT_SECRET || 'secret';

const initSocket = (httpServer) => {
    io = new Server(httpServer, {
        cors: { origin: '*', methods: ['GET', 'POST'] },
        path: '/socket.io',
    });

    io.use((socket, next) => {
        const token = socket.handshake.auth?.token
            || socket.handshake.query?.token
            || (socket.handshake.headers?.authorization || '').replace(/^Bearer\s+/i, '');
        if (!token) return next();
        try {
            const decoded = jwt.verify(token, SECRET);
            socket.user = {
                id: decoded.id || decoded.userId || decoded.user_id,
                role: decoded.role,
                fullName: decoded.full_name || decoded.fullName || '',
            };
        } catch (_) {
            // Token invalid — still allow (public events ít dùng), nhưng không có user
        }
        next();
    });

    io.on('connection', (socket) => {
        socket.on('wp:join', (profileId) => {
            const pid = Number(profileId);
            if (!pid) return;
            socket.join(`wp:${pid}`);
        });
        socket.on('wp:leave', (profileId) => {
            const pid = Number(profileId);
            if (!pid) return;
            socket.leave(`wp:${pid}`);
        });
        socket.on('wp:typing', ({ profileId, userName }) => {
            const pid = Number(profileId);
            if (!pid) return;
            socket.to(`wp:${pid}`).emit('wp:typing', {
                userId: socket.user?.id || null,
                userName: userName || socket.user?.fullName || '',
            });
        });
    });

    return io;
};

const getIO = () => io;

const emitToProfile = (profileId, event, payload) => {
    if (!io) return;
    const pid = Number(profileId);
    if (!pid) return;
    io.to(`wp:${pid}`).emit(event, payload);
};

module.exports = { initSocket, getIO, emitToProfile };
