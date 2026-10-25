const test = require("node:test");
const assert = require("node:assert/strict");
const { getMediaDefinition, hasValidSignature, sanitizeOriginalName } = require("../server/utils/mediaTypes");

test("recognizes an allowed JPEG and validates its file signature", () => {
    const file = { originalname: "photo.jpeg", mimetype: "image/jpeg" };
    const definition = getMediaDefinition(file);
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    assert.equal(definition.type, "image");
    assert.equal(hasValidSignature(bytes, definition), true);
});

test("rejects a filename and MIME type that disagree", () => {
    assert.equal(getMediaDefinition({ originalname: "photo.jpg", mimetype: "image/png" }), null);
});

test("rejects a supported extension with unrelated file contents", () => {
    const definition = getMediaDefinition({ originalname: "file.pdf", mimetype: "application/pdf" });
    assert.equal(hasValidSignature(Buffer.from("<html>not a PDF</html>"), definition), false);
});

test("normalizes aliases and strips path components and control characters from names", () => {
    const definition = getMediaDefinition({ originalname: "voice.wav", mimetype: "audio/x-wav" });
    assert.equal(definition.mimeType, "audio/wav");
    assert.equal(sanitizeOriginalName("..\\private\\report\n.docx"), "report.docx");
});
