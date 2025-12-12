import { AzureKeyCredential } from "@azure/core-auth";
import { logAPICall } from './api-logger.service.js';

/**
 * Azure Computer Vision Service - OCR text extraction from images.
 *
 * Uses Azure AI Vision Image Analysis REST API with the "Read" feature
 * to extract printed and handwritten text from images.
 *
 * Required environment variables:
 * - AZURE_VISION_ENDPOINT: Azure Computer Vision endpoint URL
 * - AZURE_VISION_KEY: Azure Computer Vision API key
 */

const AZURE_VISION_ENDPOINT = process.env.AZURE_VISION_ENDPOINT;
const AZURE_VISION_KEY = process.env.AZURE_VISION_KEY;

// Cache the client instance and module
let clientInstance = null;
let azureModule = null;

/**
 * Get or create the Azure Vision client.
 * Uses dynamic import to handle ESM/CJS interop.
 */
async function getClient() {
    if (!clientInstance) {
        if (!AZURE_VISION_ENDPOINT || !AZURE_VISION_KEY) {
            throw new Error("Azure Vision not configured. Set AZURE_VISION_ENDPOINT and AZURE_VISION_KEY environment variables.");
        }

        // Dynamic import to handle module interop
        if (!azureModule) {
            const imported = await import("@azure-rest/ai-vision-image-analysis");
            // Handle double-nested default export (ESM interop quirk)
            azureModule = imported.default?.default ? imported.default : imported;
        }

        const createClient = azureModule.default;
        const credential = new AzureKeyCredential(AZURE_VISION_KEY);
        clientInstance = createClient(AZURE_VISION_ENDPOINT, credential);
    }
    return clientInstance;
}

/**
 * Check if response is an error.
 */
async function checkUnexpected(response) {
    if (!azureModule) {
        azureModule = await import("@azure-rest/ai-vision-image-analysis");
    }
    const isUnexpected = azureModule.isUnexpected;
    return isUnexpected ? isUnexpected(response) : response.status !== "200";
}

/**
 * Check if Azure Vision is configured.
 * @returns {boolean}
 */
export function isAzureVisionConfigured() {
    return !!(AZURE_VISION_ENDPOINT && AZURE_VISION_KEY);
}

/**
 * Extract text from an image buffer using Azure Computer Vision OCR.
 *
 * @param {Buffer} imageBuffer - Image buffer (JPEG, PNG, etc.)
 * @param {Object} options - Optional settings
 * @param {string} options.language - Language hint (e.g., 'en', 'sk')
 * @returns {Promise<OCRResult>} - Extracted text with structure
 *
 * @typedef {Object} OCRResult
 * @property {string} text - Full extracted text (all blocks concatenated)
 * @property {Block[]} blocks - Array of text blocks
 * @property {number} confidence - Average confidence score (0-1)
 *
 * @typedef {Object} Block
 * @property {Line[]} lines - Array of text lines
 *
 * @typedef {Object} Line
 * @property {string} text - Line text
 * @property {Word[]} words - Array of words
 * @property {number[]} boundingPolygon - Bounding coordinates
 *
 * @typedef {Object} Word
 * @property {string} text - Word text
 * @property {number} confidence - Confidence score (0-1)
 * @property {number[]} boundingPolygon - Bounding coordinates
 */
export async function extractTextFromImage(imageBuffer, options = {}) {
    const client = await getClient();
    const startTime = Date.now();

    console.log(`[AzureVision] Analyzing image (${Math.round(imageBuffer.length / 1024)}KB)...`);

    const requestParams = {
        features: ["Read"],
        ...(options.language && { language: options.language })
    };

    // Log request
    logAPICall({
        service: 'AzureVision',
        operation: 'ocr',
        endpoint: `${AZURE_VISION_ENDPOINT}/imageanalysis:analyze`,
        request: {
            imageSize: imageBuffer.length,
            imageSizeKB: Math.round(imageBuffer.length / 1024),
            queryParameters: requestParams,
            contentType: 'application/octet-stream'
        }
    });

    const response = await client.path("/imageanalysis:analyze").post({
        body: imageBuffer,
        queryParameters: requestParams,
        contentType: "application/octet-stream"
    });

    const duration = Date.now() - startTime;

    if (await checkUnexpected(response)) {
        const errorBody = response.body;

        // Log error
        logAPICall({
            service: 'AzureVision',
            operation: 'ocr-error',
            error: {
                status: response.status,
                body: errorBody
            },
            duration
        });

        throw new Error(`Azure Vision API error: ${response.status} - ${JSON.stringify(errorBody)}`);
    }

    const result = response.body;

    if (!result.readResult) {
        // Log empty result
        logAPICall({
            service: 'AzureVision',
            operation: 'ocr-response',
            response: {
                text: '',
                blocks: 0,
                lines: 0,
                words: 0,
                confidence: 0
            },
            duration
        });

        console.log("[AzureVision] No text detected in image");
        return {
            text: "",
            blocks: [],
            confidence: 0
        };
    }

    // Process blocks and extract text
    const blocks = result.readResult.blocks || [];
    const allLines = [];
    let totalConfidence = 0;
    let wordCount = 0;

    for (const block of blocks) {
        for (const line of block.lines || []) {
            allLines.push(line.text);

            for (const word of line.words || []) {
                totalConfidence += word.confidence || 0;
                wordCount++;
            }
        }
    }

    const fullText = allLines.join("\n");
    const avgConfidence = wordCount > 0 ? totalConfidence / wordCount : 0;

    // Log response
    logAPICall({
        service: 'AzureVision',
        operation: 'ocr-response',
        response: {
            text: fullText,
            blocks: blocks.length,
            lines: allLines.length,
            words: wordCount,
            confidence: avgConfidence,
            modelVersion: result.modelVersion,
            metadata: result.metadata
        },
        duration
    });

    console.log(`[AzureVision] Extracted ${allLines.length} lines, ${wordCount} words (avg confidence: ${(avgConfidence * 100).toFixed(1)}%)`);

    return {
        text: fullText,
        blocks: blocks,
        confidence: avgConfidence,
        lineCount: allLines.length,
        wordCount: wordCount
    };
}

/**
 * Extract text from multiple images in parallel.
 *
 * @param {Buffer[]} imageBuffers - Array of image buffers
 * @param {Object} options - Optional settings
 * @param {number} options.maxConcurrency - Max parallel requests (default: 3)
 * @param {string} options.language - Language hint
 * @returns {Promise<OCRResult[]>} - Array of OCR results (same order as input)
 */
export async function extractTextFromImages(imageBuffers, options = {}) {
    const maxConcurrency = options.maxConcurrency || 3;

    console.log(`[AzureVision] Processing ${imageBuffers.length} images (concurrency: ${maxConcurrency})...`);

    const results = [];
    const batches = [];

    // Create batches
    for (let i = 0; i < imageBuffers.length; i += maxConcurrency) {
        batches.push(imageBuffers.slice(i, i + maxConcurrency));
    }

    // Process batches
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        console.log(`[AzureVision] Batch ${batchIndex + 1}/${batches.length} (${batch.length} images)`);

        const batchPromises = batch.map(async (buffer, idx) => {
            try {
                return await extractTextFromImage(buffer, { language: options.language });
            } catch (err) {
                console.error(`[AzureVision] Image ${batchIndex * maxConcurrency + idx} failed:`, err.message);
                return {
                    text: "",
                    blocks: [],
                    confidence: 0,
                    error: err.message
                };
            }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
    }

    return results;
}

/**
 * Combine OCR results from multiple images into a single text.
 *
 * @param {OCRResult[]} ocrResults - Array of OCR results
 * @param {string} separator - Separator between pages (default: "\n\n---\n\n")
 * @returns {string} - Combined text
 */
export function combineOCRResults(ocrResults, separator = "\n\n---\n\n") {
    return ocrResults
        .map(r => r.text)
        .filter(text => text && text.trim())
        .join(separator);
}
