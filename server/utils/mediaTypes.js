const definitions = [
    { type: "image", mimeType: "image/jpeg", extensions: [".jpg", ".jpeg"] },
    { type: "image", mimeType: "image/png", extensions: [".png"] },
    { type: "image", mimeType: "image/webp", extensions: [".webp"] },
    { type: "image", mimeType: "image/gif", extensions: [".gif"] },
    { type: "video", mimeType: "video/mp4", extensions: [".mp4"] },
    { type: "video", mimeType: "video/webm", extensions: [".webm"] },
    { type: "video", mimeType: "video/quicktime", extensions: [".mov"] },
    { type: "audio", mimeType: "audio/mpeg", extensions: [".mp3"] },
    { type: "audio", mimeType: "audio/mp4", extensions: [".m4a"] },
    { type: "audio", mimeType: "audio/aac", extensions: [".aac"] },
    { type: "audio", mimeType: "audio/wav", extensions: [".wav", ".wave"] },
    { type: "audio", mimeType: "audio/ogg", extensions: [".ogg", ".oga"] },
    { type: "audio", mimeType: "audio/webm", extensions: [".weba"] },
    { type: "document", mimeType: "application/pdf", extensions: [".pdf"] },
    { type: "document", mimeType: "application/msword", extensions: [".doc"] },
    {
        type: "document",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        extensions: [".docx"]
    }
];

const mimeAliases = new Map([
    ["image/jpg", "image/jpeg"],
    ["audio/x-wav", "audio/wav"],
    ["audio/wave", "audio/wav"],
    ["audio/x-m4a", "audio/mp4"],
    ["audio/mp3", "audio/mpeg"],
    ["video/x-m4v", "video/mp4"],
    ["application/x-pdf", "application/pdf"]
]);

const getMediaDefinition = file => {
    const extension = require("path").extname(file.originalname || "").toLowerCase();
    const definition = definitions.find(item => item.extensions.includes(extension));
    if (!definition) return null;

    const suppliedMime = String(file.mimetype || "").toLowerCase();
    const normalizedMime = mimeAliases.get(suppliedMime) || suppliedMime;
    if (normalizedMime && normalizedMime !== definition.mimeType) return null;

    return { ...definition, extension };
};

const startsWith = (buffer, values) => values.some(value =>
    buffer.subarray(0, value.length).equals(Buffer.from(value))
);

const hasValidSignature = (buffer, definition) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;

    switch (definition.extension) {
        case ".jpg":
        case ".jpeg":
            return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
        case ".png":
            return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        case ".gif":
            return startsWith(buffer, ["GIF87a", "GIF89a"]);
        case ".webp":
            return buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
        case ".mp4":
        case ".m4a":
        case ".mov":
            return buffer.toString("ascii", 4, 8) === "ftyp";
        case ".webm":
        case ".weba":
            return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
        case ".mp3":
            return buffer.toString("ascii", 0, 3) === "ID3" || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
        case ".aac":
            return buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0;
        case ".wav":
        case ".wave":
            return buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WAVE";
        case ".ogg":
        case ".oga":
            return buffer.toString("ascii", 0, 4) === "OggS";
        case ".pdf":
            return buffer.toString("ascii", 0, 5) === "%PDF-";
        case ".doc":
            return buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
        case ".docx":
            return buffer[0] === 0x50 && buffer[1] === 0x4b && [0x03, 0x05, 0x07].includes(buffer[2]);
        default:
            return false;
    }
};

const sanitizeOriginalName = value => {
    const path = require("path");
    const base = path.basename(String(value || "attachment")).replace(/[\u0000-\u001f\u007f]/g, "");
    return base.slice(0, 180) || "attachment";
};

module.exports = { getMediaDefinition, hasValidSignature, sanitizeOriginalName };
