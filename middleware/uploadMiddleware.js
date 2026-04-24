
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Storage config
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Fix encoding for Vietnamese filenames
        file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
        
        // Unique filename: timestamp-originalname
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

// File filter (Optional: Restrict types)
const fileFilter = (req, file, cb) => {
    // Allow PDF, Word, Excel, Images
    // const allowedTypes = /pdf|doc|docx|xls|xlsx|jpg|jpeg|png/;
    // const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    // if (extname) return cb(null, true);
    // cb(new Error('File type not supported'));
    cb(null, true); // Allow all for now
};

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 20 * 1024 * 1024 } // 20MB limit
});

module.exports = upload;
