const multer = require("multer");
const { getMediaDefinition } = require("../utils/mediaTypes");

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!getMediaDefinition(file)) {
            const error = new Error("Choose a supported image, video, audio, PDF, DOC or DOCX file");
            error.status = 415;
            return cb(error);
        }
        cb(null, true);
    }
});

module.exports = upload;
