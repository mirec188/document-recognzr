import PDFParser from "pdf2json";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { exec } from "child_process";
import util from "util";

const execPromise = util.promisify(exec);

// Maximum width for converted images (optimized for Vision API)
const MAX_IMAGE_WIDTH = 1600;

// Debug output directory - set via environment variable
// Example: DEBUG_OUTPUT_DIR=./debug-output npm run dev
const DEBUG_OUTPUT_DIR = process.env.DEBUG_OUTPUT_DIR || null;

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

/**
 * Converts PDF pages to optimized JPEG images.
 *
 * @param {Buffer} buffer - PDF file buffer
 * @param {Object} options - Conversion options
 * @param {number} options.density - Render density in DPI (default: 150)
 * @param {number} options.quality - JPEG quality 1-100 (default: 85)
 * @param {number} options.maxPages - Maximum pages to process (default: 10)
 * @param {number} options.maxWidth - Maximum image width in pixels (default: 1600)
 * @param {boolean} options.grayscale - Convert to grayscale for better OCR (default: true)
 * @param {boolean} options.normalize - Normalize contrast (default: true)
 * @returns {Promise<Buffer[]>} Array of JPEG buffers
 */
export async function pdfToJpegs(buffer, {
    density = 200,
    quality = 80,
    maxPages = 10,
    maxWidth = MAX_IMAGE_WIDTH,
    grayscale = true,
    normalize = true
} = {}) {
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

        // Build optimized ImageMagick command
        // Key optimizations:
        // 1. Lower density (150 vs 200) - sufficient for text, saves memory
        // 2. Grayscale - removes color noise, smaller files
        // 3. Auto-level + normalize - improves contrast for OCR
        // 4. Resize to max width - prevents massive images from phone scans
        const cmdParts = [
            'convert',
            `-density ${density}`,
            `"${inputPath}${pageRange}"`,
        ];

        // Optional grayscale conversion (better for text extraction)
        if (grayscale) {
            cmdParts.push('-colorspace Gray');
        }

        // Optional contrast normalization (helps with scanned documents)
        if (normalize) {
            cmdParts.push('-auto-level -normalize');
        }

        // Resize to max width (critical for large scans)
        // The 'x' suffix means "max width, preserve aspect ratio"
        cmdParts.push(`-resize ${maxWidth}x\\>`);

        // Output quality and path
        cmdParts.push(`-quality ${quality}`);
        cmdParts.push(`"${outputPattern}"`);

        const cmd = cmdParts.join(' ');
        console.log(`[PDF] Converting ${count} pages with maxWidth=${maxWidth}px, grayscale=${grayscale}`);
        console.log(`[PDF] Command: ${cmd}`);

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

        // Log resulting sizes
        if (outputs.length > 0) {
            const totalSize = outputs.reduce((sum, buf) => sum + buf.length, 0);
            console.log(`[PDF] Generated ${outputs.length} images, total size: ${Math.round(totalSize / 1024)}KB`);
        }

        // Debug: Save copies to debug directory if enabled
        if (DEBUG_OUTPUT_DIR) {
            await saveDebugFiles(outputs, 'page', DEBUG_OUTPUT_DIR);
        }

        return outputs;
    } catch (error) {
        console.error("PDF to JPEG conversion failed:", error);
        throw new Error("Failed to convert PDF to images.");
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

/**
 * Saves buffers to debug directory for inspection.
 * @param {Buffer[]} buffers - Array of image buffers
 * @param {string} prefix - Filename prefix (e.g., 'page', 'tile', 'header')
 * @param {string} outputDir - Directory to save files
 */
export async function saveDebugFiles(buffers, prefix, outputDir = DEBUG_OUTPUT_DIR) {
    if (!outputDir) return;

    try {
        // Ensure directory exists
        await fs.mkdir(outputDir, { recursive: true });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

        for (let i = 0; i < buffers.length; i++) {
            const filename = `${timestamp}_${prefix}-${i.toString().padStart(3, '0')}.jpg`;
            const filepath = path.join(outputDir, filename);
            await fs.writeFile(filepath, buffers[i]);
        }

        console.log(`[DEBUG] Saved ${buffers.length} ${prefix} files to ${outputDir}`);
    } catch (err) {
        console.error(`[DEBUG] Failed to save debug files:`, err.message);
    }
}

/**
 * Gets the debug output directory if set.
 * @returns {string|null}
 */
export function getDebugOutputDir() {
    return DEBUG_OUTPUT_DIR;
}
