const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand,
    HeadObjectCommand
} = require("@aws-sdk/client-s3");

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

const sendStorageCommand = async (operation, command) => {
    try {
        return await s3.send(command);
    } catch (error) {
        error.storageOperation = operation;
        throw error;
    }
};

const putMedia = async ({ key, body, contentType, metadata }) => {
    requireStorage();
    const result = await sendStorageCommand("PutObject", new PutObjectCommand({
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

const createMultipartMediaUpload = async ({ key, contentType, metadata }) => {
    requireStorage();
    const result = await sendStorageCommand("CreateMultipartUpload", new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
        Metadata: metadata,
        ServerSideEncryption: process.env.S3_SERVER_SIDE_ENCRYPTION || undefined
    }));
    return result.UploadId;
};

const uploadMediaPart = async ({ key, uploadId, partNumber, body }) => {
    requireStorage();
    const result = await sendStorageCommand("UploadPart", new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: body,
        ContentLength: body.length
    }));
    return result.ETag;
};

const completeMultipartMediaUpload = async ({ key, uploadId, parts }) => {
    requireStorage();
    return sendStorageCommand("CompleteMultipartUpload", new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
            Parts: parts.map(part => ({ PartNumber: part.partNumber, ETag: part.etag }))
        }
    }));
};

const abortMultipartMediaUpload = async ({ key, uploadId }) => {
    if (!key || !uploadId || !bucket || !s3) return;
    await sendStorageCommand("AbortMultipartUpload", new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
};

const getMedia = async (key, range) => {
    requireStorage();
    return sendStorageCommand("GetObject", new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }));
};

const getMediaMetadata = async key => {
    requireStorage();
    return sendStorageCommand("HeadObject", new HeadObjectCommand({ Bucket: bucket, Key: key }));
};

const deleteMedia = async key => {
    if (!key || !bucket || !s3) return;
    await sendStorageCommand("DeleteObject", new DeleteObjectCommand({ Bucket: bucket, Key: key }));
};

module.exports = {
    putMedia,
    createMultipartMediaUpload,
    uploadMediaPart,
    completeMultipartMediaUpload,
    abortMultipartMediaUpload,
    getMedia,
    getMediaMetadata,
    deleteMedia
};
