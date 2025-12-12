import { Stage } from '../Stage.js';
import { getProvider } from '../providers/index.js';
import { enforceStrictSchema } from '../../services/schema.service.js';

/**
 * OCREnhancedExtractionStage - Sends OCR text + Image to OpenAI.
 *
 * Pipeline Mode: "ocr-enhanced" or "ocr+image"
 *
 * This stage:
 * 1. Takes OCR text from AzureOCRStage (context.metadata.ocrText)
 * 2. Combines it with the original image
 * 3. Sends both to OpenAI for structured extraction
 *
 * Benefits:
 * - AI can cross-reference OCR text with visual layout
 * - Better accuracy for hard-to-read characters
 * - OCR provides "ground truth" text, AI provides structure
 */
export class OCREnhancedExtractionStage extends Stage {
    constructor() {
        super('OCREnhancedExtractionStage');
    }

    async shouldRun(context) {
        // Only run if OCR was performed and we have results
        return context.metadata.ocrText && context.isOpenAIProvider();
    }

    async process(context) {
        const provider = getProvider(context.getProvider());

        if (!provider.isConfigured()) {
            context.error = `Provider ${context.getProvider()} is not configured`;
            return context;
        }

        console.log(`[${this.name}] OCR-enhanced extraction (OCR text + images)`);

        // Build enhanced instructions with OCR context
        const enforceSchema = context.options.enforceJsonSchema !== false;
        const strictSchema = enforceSchema ? enforceStrictSchema({ ...context.schema }) : null;

        const ocrText = context.metadata.ocrText;
        const instructions = this.buildEnhancedInstructions(context, ocrText);

        try {
            // Process each image with its corresponding OCR text
            const results = await this.extractWithOCRContext(context, provider, instructions, strictSchema, enforceSchema);
            context.extractions = results;
        } catch (err) {
            context.error = `OCR-enhanced extraction failed: ${err.message}`;
            context.errors.push({
                stage: this.name,
                message: err.message,
                stack: err.stack
            });
        }

        context.completeStage(this.name);
        return context;
    }

    /**
     * Build instructions that incorporate OCR text.
     */
    buildEnhancedInstructions(context, ocrText) {
        const schemaStr = JSON.stringify(context.schema, null, 2);

        return `You are an expert document parser extracting structured data from a ${context.docType}.

I'm providing you with:
1. The original document IMAGE for visual reference
2. OCR-extracted TEXT from Azure Computer Vision (high accuracy)

Use the OCR text as your PRIMARY source for text values (especially IBANs, numbers, invoice numbers).
Use the image to understand the document STRUCTURE and LAYOUT. The OCR may have minor issues, but still trust it for text accuracy more.
If you see 2 similiar IBANs and one of them is from the OCR text, prefer the OCR one. 

## OCR Extracted Text:
\`\`\`
${ocrText}
\`\`\`

## Your Task:
Extract the data according to this JSON schema:
${schemaStr}

## Important:
- IBANs from OCR are highly accurate - trust them over your visual reading
- Match invoice numbers, amounts, and IBANs from the OCR text
- Use the image to understand which values belong together (same row)
- Slovak IBANs start with "SK" and have 24 characters

Return ONLY valid JSON matching the schema.`;
    }

    /**
     * Extract data using OCR text + images.
     */
    async extractWithOCRContext(context, provider, instructions, strictSchema, enforceSchema) {
        const results = [];

        // If we have per-image OCR, use it; otherwise use combined text
        const ocrByImage = context.metadata.ocrByImage || [];

        for (let i = 0; i < context.images.length; i++) {
            const imageBuffer = context.images[i];
            const imageOCR = ocrByImage[i]?.text || context.metadata.ocrText;

            // Build content with OCR text prefix + image
            const content = [
                {
                    type: "text",
                    text: `Page ${i + 1} OCR Text:\n${imageOCR}\n\nNow extract structured data from this page:`
                },
                {
                    type: "image_url",
                    image_url: {
                        url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`,
                        detail: "high"
                    }
                }
            ];

            console.log(`[${this.name}] Processing page ${i + 1}/${context.images.length} (OCR: ${imageOCR.length} chars)`);

            try {
                const result = await provider.extract({
                    images: content,
                    instructions,
                    docType: context.docType,
                    schema: strictSchema,
                    enforceSchema,
                    options: { useTileTimeout: true }
                });

                // Tag results with page index
                if (result.data?.drawdowns) {
                    for (const row of result.data.drawdowns) {
                        row._pageIndex = i;
                    }
                }

                results.push(result);
            } catch (err) {
                console.error(`[${this.name}] Page ${i + 1} failed:`, err.message);
                context.addWarning(this.name, `Page ${i + 1} extraction failed: ${err.message}`);
            }
        }

        return results;
    }
}
