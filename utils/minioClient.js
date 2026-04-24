const Minio = require('minio');

const endpoint = process.env.MINIO_ENDPOINT || 'localhost';
const port = Number(process.env.MINIO_PORT || 9000);
const useSSL = String(process.env.MINIO_USE_SSL || 'false').toLowerCase() === 'true';
const accessKey = process.env.MINIO_ACCESS_KEY || 'minioadmin';
const secretKey = process.env.MINIO_SECRET_KEY || 'minioadmin';
const bucket = process.env.MINIO_BUCKET || 'dms-assets';

const client = new Minio.Client({
    endPoint: endpoint,
    port,
    useSSL,
    accessKey,
    secretKey,
});

let ensured = false;
const ensureBucket = async () => {
    if (ensured) return;
    const exists = await client.bucketExists(bucket).catch(() => false);
    if (!exists) {
        await client.makeBucket(bucket, 'us-east-1');
    }
    ensured = true;
};

const uploadBuffer = async (objectName, buffer, meta = {}) => {
    await ensureBucket();
    await client.putObject(bucket, objectName, buffer, buffer.length, meta);
    return { bucket, objectName };
};

const getObjectBuffer = async (objectName) => {
    await ensureBucket();
    const stream = await client.getObject(bucket, objectName);
    const chunks = [];
    await new Promise((resolve, reject) => {
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', resolve);
        stream.on('error', reject);
    });
    return Buffer.concat(chunks);
};

const removeObject = async (objectName) => {
    await ensureBucket();
    await client.removeObject(bucket, objectName);
};

module.exports = {
    minioClient: client,
    minioBucket: bucket,
    uploadBuffer,
    getObjectBuffer,
    removeObject,
};
