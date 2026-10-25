const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");

const bucket = process.env.MEDIA_BUCKET;
const s3 = bucket
    ? new S3Client({
        region: process.env.AWS_REGION || "us-east-1",
        endpoint: process.env.S3_ENDPOINT || undefined,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true"
    })
    : null;

const requireStorage = () => {
    if (!bucket || !s3) {
        const error = new Error("Media storage is not configured");
        error.status = 503;
        throw error;
    }
};

const putMedia = async ({ key, body, contentType, metadata }) => {
    requireStorage();
    const result = await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.length,
        Metadata: metadata,
        ServerSideEncryption: process.env.S3_SERVER_SIDE_ENCRYPTION || undefined
    }));
    return result.ETag;
};

const getMedia = async key => {
    requireStorage();
    return s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
};

const deleteMedia = async key => {
    if (!key || !bucket || !s3) return;
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
};

module.exports = { putMedia, getMedia, deleteMedia };
