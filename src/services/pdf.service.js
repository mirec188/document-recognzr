import PDFParser from "pdf2json";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { exec } from "child_process";
import util from "util";

const execPromise = util.promisify(exec);

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
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-convert-"));
    const inputPath = path.join(tempDir, "input.pdf");
    const outputPattern = path.join(tempDir, "output-%d.jpg");

    try {
        await fs.writeFile(inputPath, buffer);

        // Get page count
        const { stdout: pageCountOut } = await execPromise(`identify -format "%n" "${inputPath}"`);
        const totalPages = parseInt(pageCountOut.trim(), 10);
        if (isNaN(totalPages)) throw new Error("Failed to determine PDF page count");

        const count = Math.min(totalPages, maxPages);
        const pageRange = `[0-${count - 1}]`;

        // Convert to JPEGs
        const cmd = `convert -density ${density} "${inputPath}${pageRange}" -quality ${quality} "${outputPattern}"`;
        await execPromise(cmd);

        // Read output files
        const files = await fs.readdir(tempDir);
        const jpegFiles = files.filter(f => f.startsWith("output-") && f.endsWith(".jpg"));

        // Sort by page number
        jpegFiles.sort((a, b) => {
            const numA = parseInt(a.match(/output-(\d+)\.jpg/)[1], 10);
            const numB = parseInt(b.match(/output-(\d+)\.jpg/)[1], 10);
            return numA - numB;
        });

        const outputs = [];
        for (const file of jpegFiles) {
            const content = await fs.readFile(path.join(tempDir, file));
            outputs.push(content);
        }

        return outputs;
    } catch (error) {
        console.error("PDF to JPEG conversion failed:", error);
        throw new Error("Failed to convert PDF to images.");
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}
