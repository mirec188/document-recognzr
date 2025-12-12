import { Stage } from '../Stage.js';
import { getProvider } from '../providers/index.js';
import { enforceStrictSchema } from '../../services/schema.service.js';

/**
 * OCROnlyExtractionStage - Sends ONLY OCR text to OpenAI (no images).
 *
 * Pipeline Mode: "ocr-only" or "text-only"
 *
 * This stage:
 * 1. Takes OCR text from AzureOCRStage (context.metadata.ocrText)
 * 2. Sends ONLY the text to OpenAI (no images)
 * 3. AI extracts structured data from text alone
 *
 * Benefits:
 * - Much faster (no image processing)
 * - Much cheaper (text tokens vs image tokens)
 * - Works well when OCR quality is high
 *
 * Drawbacks:
 * - Loses layout/structure information
 * - May struggle to match values that belong together
 */
export class OCROnlyExtractionStage extends Stage {
    constructor() {
        super('OCROnlyExtractionStage');
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

        const ocrText = context.metadata.ocrText;
        console.log(`[${this.name}] OCR-only extraction (${ocrText.length} chars, no images)`);

        // Build instructions for text-only extraction
        const enforceSchema = context.options.enforceJsonSchema !== false;
        const strictSchema = enforceSchema ? enforceStrictSchema({ ...context.schema }) : null;

        const instructions = this.buildTextOnlyInstructions(context);

        try {
            // Single extraction from combined OCR text
            const result = await this.extractFromText(context, provider, ocrText, instructions, strictSchema, enforceSchema);
            context.extractions = [result];
        } catch (err) {
            context.error = `OCR-only extraction failed: ${err.message}`;
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
     * Build instructions for text-only extraction.
     */
    buildTextOnlyInstructions(context) {
        const schemaStr = JSON.stringify(context.schema, null, 2);

        return `You are an expert document parser extracting structured data from OCR text.

The text below was extracted from a ${context.docType} document using Azure Computer Vision OCR.
The OCR is highly accurate but the text may not preserve the original table structure.

## Your Task:
Parse the OCR text and extract data according to this JSON schema:
${schemaStr}

## Hints for ${context.docType}:
- Each row typically has: invoice number, variable symbol, IBAN, and amount
- Slovak IBANs start with "SK" followed by 22 characters (24 total)
- IBANs may have spaces (e.g., "SK36 1111 0000 0066 2049 4002")
- Amounts may use comma as decimal separator (e.g., "1 234,56")
- Invoice numbers and variable symbols are often the same or similar
- Values appearing close together in the text likely belong to the same row

## Important:
- Trust the OCR text - it's highly accurate
- Match IBANs with their corresponding invoice numbers and amounts
- If you see the same invoice number multiple times, it's likely one entry
- Return ONLY valid JSON matching the schema`;
    }

    /**
     * Extract structured data from OCR text only.
     */
    async extractFromText(context, provider, ocrText, instructions, strictSchema, enforceSchema) {
        // For text-only, we send the OCR text as user content (no images)
        const content = [
            {
                type: "text",
                text: `## OCR Extracted Text:\n\n${ocrText}\n\n---\n\nExtract the structured data from the text above.`
            }
        ];

        const result = await provider.extract({
            images: content,  // "images" is a misnomer here - it's just the content array
            instructions,
            docType: context.docType,
            schema: strictSchema,
            enforceSchema,
            options: { useTileTimeout: false }  // Text is fast, use normal timeout
        });

        return result;
    }
}
