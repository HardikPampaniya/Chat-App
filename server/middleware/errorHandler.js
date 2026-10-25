const errorHandler = (error, req, res, next) => {
    if (res.headersSent) return next(error);

    let status = Number(error.status) || 500;
    let message = status < 500 ? error.message : "Internal server error";
    const storageStatus = Number(error.$metadata?.httpStatusCode || error.statusCode);
    const storageCode = error.Code || error.code || error.name;
    if (storageStatus === 403 || ["AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch", "ExpiredToken"].includes(storageCode)) {
        status = 503;
        message = "Media storage denied access. Check the Render bucket name, storage credentials, region, and bucket permissions.";
        console.error("Object storage authorization failed", {
            method: req.method,
            path: req.path,
            code: storageCode,
            status: storageStatus || undefined,
            operation: error.name || "StorageError"
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

    if (status >= 500 && storageStatus !== 403 && !["AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch", "ExpiredToken"].includes(storageCode)) {
        console.error("Request failed", { method: req.method, path: req.path, name: error.name || "Error" });
    }

    res.status(status).json({ message });
};

module.exports = errorHandler;
