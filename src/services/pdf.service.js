import PDFParser from "pdf2json";
import sharp from "sharp";

export async function extractTextFromPdf(buffer) {
    try {
        const pdfParser = new PDFParser(this, 1);

        return await new Promise((resolve, reject) => {
            pdfParser.on("pdfParser_dataError", errData => reject(errData.parserError));
            pdfParser.on("pdfParser_dataReady", pdfData => {
                resolve(pdfParser.getRawTextContent());
            });
            pdfParser.parseBuffer(buffer);
        });
    } catch (pdfError) {
        console.error("PDF parsing error:", pdfError);
        throw new Error("Failed to parse PDF file.");
    }
}

export async function pdfToJpegs(buffer, { density = 200, quality = 80, maxPages = 10 } = {}) {
    const meta = await sharp(buffer, { density }).metadata();
    const pages = meta.pages || 1;
    const count = Math.min(pages, maxPages);
    const outputs = [];
    for (let i = 0; i < count; i++) {
        const jpegBuffer = await sharp(buffer, { density, page: i }).jpeg({ quality }).toBuffer();
        outputs.push(jpegBuffer);
    }
    return outputs;
}
