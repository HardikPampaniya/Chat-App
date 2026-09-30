const errorHandler = (error, req, res, next) => {
    console.error(error);

    if (res.headersSent) return next(error);

    res.status(error.status || 500).json({
        message: error.status ? error.message : "Internal server error"
    });
};

module.exports = errorHandler;
