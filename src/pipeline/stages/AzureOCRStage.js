import { Stage } from '../Stage.js';
import {
    extractTextFromImages,
    combineOCRResults,
    isAzureVisionConfigured
} from '../../services/azure-vision.service.js';

/**
 * AzureOCRStage - Pre-processes images with Azure Computer Vision OCR.
 *
 * This stage extracts text from images BEFORE sending to the AI provider.
 * The extracted text can be:
 * 1. Used to supplement the AI's visual analysis
 * 2. Used for validation/verification of extracted data
 * 3. Stored in metadata for debugging
 *
 * Enable via options.useAzureOCR = true
 */
export class AzureOCRStage extends Stage {
    constructor() {
        super('AzureOCRStage');
    }

    async shouldRun(context) {
        // Only run if explicitly enabled and Azure Vision is configured
        if (!context.options.useAzureOCR) {
            return false;
        }

        if (!isAzureVisionConfigured()) {
            context.addWarning(this.name, 'Azure Vision not configured - skipping OCR stage');
            return false;
        }

        // Need images to process
        return context.images && context.images.length > 0;
    }

    async process(context) {
        console.log(`[${this.name}] Processing ${context.images.length} images with Azure OCR...`);

        const startTime = Date.now();

        try {
            // Extract text from all images
            const ocrResults = await extractTextFromImages(context.images, {
                maxConcurrency: context.options.ocrConcurrency || 3,
                language: context.options.ocrLanguage || 'sk'  // Default Slovak for this project
            });

            // Store results in context metadata
            context.metadata.ocrResults = ocrResults;
            context.metadata.ocrText = combineOCRResults(ocrResults);

            // Calculate stats
            const totalWords = ocrResults.reduce((sum, r) => sum + (r.wordCount || 0), 0);
            const avgConfidence = ocrResults.length > 0
                ? ocrResults.reduce((sum, r) => sum + (r.confidence || 0), 0) / ocrResults.length
                : 0;

            const duration = Date.now() - startTime;

            console.log(`[${this.name}] OCR complete: ${totalWords} words, ${(avgConfidence * 100).toFixed(1)}% confidence, ${duration}ms`);

            // Store OCR text per image for tile-level access
            context.metadata.ocrByImage = ocrResults.map((r, idx) => ({
                imageIndex: idx,
                text: r.text,
                confidence: r.confidence,
                wordCount: r.wordCount
            }));

            context.completeStage(this.name);
            return context;

        } catch (err) {
            console.error(`[${this.name}] OCR failed:`, err.message);
            context.addWarning(this.name, `OCR failed: ${err.message}`);

            // Don't fail the pipeline - OCR is supplementary
            context.metadata.ocrError = err.message;
            context.completeStage(this.name);
            return context;
        }
    }
}
