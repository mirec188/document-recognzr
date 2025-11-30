import PDFParser from "pdf2json";

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
