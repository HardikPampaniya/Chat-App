const errorHandler = (error, req, res, next) => {
    if (res.headersSent) return next(error);

    let status = Number(error.status) || 500;
    let message = status < 500 ? error.message : "Internal server error";
    if (error.name === "MulterError" && error.code === "LIMIT_FILE_SIZE") {
        status = 413;
        message = "Files must be 50 MB or smaller";
    }
    if (error.name === "ValidationError" || error.name === "CastError") {
        status = 400;
        message = "Invalid request data";
    }

    if (status >= 500) {
        console.error("Request failed", { method: req.method, path: req.path, name: error.name || "Error" });
    }

    res.status(status).json({ message });
};

module.exports = errorHandler;
