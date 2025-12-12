import { Stage } from '../Stage.js';
import { pdfToJpegs } from '../../services/pdf.service.js';
import { config } from '../../config/index.js';

/**
 * PreprocessingStage - Converts input files to processable image format.
 *
 * - PDFs are converted to JPEG images
 * - Images are passed through (already processable)
 * - Future: Azure OCR preprocessing could be added here
 */
export class PreprocessingStage extends Stage {
    constructor() {
        super('PreprocessingStage');
    }

    async process(context) {
        const { file, mimeType } = context;

        if (context.isPDF()) {
            console.log(`[${this.name}] Converting PDF to JPEG images...`);
            const pdfConfig = config.pdf;

            try {
                const jpegBuffers = await pdfToJpegs(file, {
                    density: pdfConfig.density,
                    quality: pdfConfig.quality,
                    maxPages: pdfConfig.maxPages,
                    maxWidth: pdfConfig.maxWidth,
                    grayscale: pdfConfig.grayscale,
                    normalize: pdfConfig.normalize
                });

                context.images = jpegBuffers;
                console.log(`[${this.name}] Converted PDF to ${jpegBuffers.length} images`);
            } catch (err) {
                context.error = `PDF conversion failed: ${err.message}`;
                context.errors.push({
                    stage: this.name,
                    message: err.message,
                    stack: err.stack
                });
                return context;
            }
        } else if (this.isImage(mimeType)) {
            // Already an image - just wrap in array
            context.images = [file];
            console.log(`[${this.name}] Using input image directly`);
        } else {
            context.error = `Unsupported file type: ${mimeType}`;
            return context;
        }

        context.completeStage(this.name);
        return context;
    }

    /**
     * Check if MIME type is a supported image format.
     * @param {string} mimeType
     * @returns {boolean}
     */
    isImage(mimeType) {
        const supportedTypes = [
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/gif',
            'image/webp'
        ];
        return supportedTypes.includes(mimeType);
    }
}
