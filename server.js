require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const http = require('http');
const { initSocket } = require('./realtime/socket');

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Database connection
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
});

// Test DB Connection
pool.connect()
    .then(() => console.log('Connected to PostgreSQL successfully!'))
    .catch(err => console.error('Connection error', err.stack));

// Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/so-van-ban', require('./src/modules/so-van-ban/so-van-ban.router'));
app.use('/api/van-thu', require('./routes/vanThuRoutes'));
app.use('/api/lanh-dao', require('./routes/lanhDaoRoutes'));
app.use('/api/nhan-vien', require('./routes/nhanVienRoutes'));
app.use('/api/onlyoffice', require('./routes/onlyOfficeRoutes'));

app.get('/', (req, res) => {
    res.json({ message: 'Welcome to DMS Backend APIs' });
});

// Realtime
initSocket(server);

server.listen(port, () => {
    console.log(`Server is running on port: ${port}`);
    console.log(`Socket.IO listening on path /socket.io`);
});
