const errorHandler = (error, req, res, next) => {
    if (res.headersSent) return next(error);

    let status = Number(error.status) || 500;
    let message = status < 500 ? error.message : "Internal server error";
    const storageStatus = Number(error.$metadata?.httpStatusCode || error.statusCode);
    const storageCode = error.Code || error.code || error.name;
    const storageCodeText = String(storageCode || "");
    const isStorageError = Boolean(error.storageOperation);
    const isStorageCredentialsError = [
        "CredentialsProviderError",
        "InvalidAccessKeyId",
        "InvalidClientTokenId",
        "SignatureDoesNotMatch",
        "ExpiredToken",
        "UnrecognizedClientException"
    ].includes(storageCodeText);

    if (isStorageError) {
        status = 503;
        message = "Media storage request failed. Check the Render logs for the storage error code.";
        if (storageStatus === 403 || storageCodeText === "AccessDenied") {
            message = "Media storage denied access. Check the bucket name, credentials, region, bucket permissions, and encryption key permissions.";
        } else if (isStorageCredentialsError) {
            message = "Media storage credentials could not be loaded or were rejected. Check the Render AWS/S3 credentials.";
        } else if (["NoSuchBucket", "NotFound"].includes(storageCodeText)) {
            message = "The configured media bucket was not found. Check MEDIA_BUCKET, AWS_REGION, and the S3 endpoint.";
        } else if (["PermanentRedirect", "AuthorizationHeaderMalformed", "IncorrectEndpoint"].includes(storageCodeText)) {
            message = "The media storage region or endpoint is incorrect. Check AWS_REGION and S3_ENDPOINT in Render.";
        } else if (storageCodeText === "NoSuchKey") {
            status = 404;
            message = "The media file was not found in storage.";
        }
        console.error("Object storage request failed", {
            method: req.method,
            path: req.path,
            code: storageCodeText || undefined,
            status: storageStatus || undefined,
            operation: error.storageOperation,
            requestId: error.$metadata?.requestId,
            stack: error.stack?.split("\n").slice(1, 6).map(frame => frame.trim())
        });
    }
    if (error.message === "Media storage is not configured") {
        status = 503;
        message = "Media storage is not configured. Set the bucket name and S3-compatible credentials in Render.";
    }
    if (error.name === "MulterError" && error.code === "LIMIT_FILE_SIZE") {
        status = 413;
        message = "Files must be 50 MB or smaller";
    }
    if (error.name === "ValidationError" || error.name === "CastError") {
        status = 400;
        message = "Invalid request data";
    }

    if (status >= 500 && !isStorageError) {
        console.error("Request failed", {
            method: req.method,
            path: req.path,
            name: error.name || "Error",
            code: error.code || error.errno || undefined,
            stage: error.mediaStage,
            stack: error.stack?.split("\n").slice(1, 6).map(frame => frame.trim())
        });
    }

    res.status(status).json({ message });
};

module.exports = errorHandler;
