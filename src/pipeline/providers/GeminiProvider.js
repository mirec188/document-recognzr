import { GoogleGenerativeAI } from "@google/generative-ai";
import { BaseProvider } from './BaseProvider.js';
import { getProviderConfig } from '../../config/index.js';
import { logAPICall } from '../../services/api-logger.service.js';

/**
 * Gemini Provider - Uses Google's Generative AI for document extraction.
 *
 * Note: Gemini has native multimodal support for PDFs and images,
 * so it doesn't require tiling like OpenAI.
 */
export class GeminiProvider extends BaseProvider {
    constructor() {
        super('GeminiProvider');
        this.config = getProviderConfig('gemini');
        this.client = null;
    }

    isConfigured() {
        return !!this.config.apiKey;
    }

    /**
     * Get or create the Gemini client.
     */
    getClient() {
        if (!this.client) {
            this.client = new GoogleGenerativeAI(this.config.apiKey);
        }
        return this.client;
    }

    /**
     * Extract data from file using Gemini.
     *
     * Note: Gemini works differently - it takes the raw file buffer and MIME type
     * rather than base64 image arrays.
     */
    async extract(params) {
        const { file, mimeType, instructions, docType, schema, enforceSchema } = params;

        if (!this.isConfigured()) {
            throw new Error('Gemini API key not configured');
        }

        const client = this.getClient();
        const model = client.getGenerativeModel({ model: this.config.model });

        // Build prompt with schema
        const schemaString = JSON.stringify(schema, null, 2);
        let prompt;

        // Gemini doesn't support structured output API, so we always include schema in prompt
        if (instructions.includes("{{schema}}")) {
            prompt = instructions.replace("{{schema}}", schemaString);
        } else if (!enforceSchema || !instructions.includes(schemaString)) {
            prompt = `${instructions}

Strictly follow this JSON schema:
${schemaString}

Return ONLY the JSON object. No markdown formatting, no backticks.`;
        } else {
            prompt = instructions;
        }

        console.log(`[${this.name}] Request: model=${this.config.model}, mimeType=${mimeType}`);

        // Convert file to base64
        const base64Data = file.toString("base64");
        const startTime = Date.now();

        // Log request
        logAPICall({
            service: 'Gemini',
            operation: 'extract',
            endpoint: 'generativelanguage.googleapis.com',
            model: this.config.model,
            request: {
                prompt: prompt,
                mimeType: mimeType,
                fileSize: file.length,
                enforceSchema: !!enforceSchema
            }
        });

        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    data: base64Data,
                    mimeType: mimeType
                }
            }
        ]);
        const duration = Date.now() - startTime;

        const responseText = result.response.text();

        // Log response
        logAPICall({
            service: 'Gemini',
            operation: 'extract-response',
            model: this.config.model,
            response: {
                content: responseText,
                usageMetadata: result.response.usageMetadata,
                promptFeedback: result.response.promptFeedback
            },
            duration
        });

        console.log(`[${this.name}] Response: length=${responseText.length}`);

        // Clean response (remove markdown code blocks if present)
        const cleanedResponse = responseText
            .replace(/```json/g, "")
            .replace(/```/g, "")
            .trim();

        try {
            const parsed = JSON.parse(cleanedResponse);
            return { data: parsed, responseId: null };
        } catch (e) {
            console.error(`[${this.name}] Failed to parse response:`, cleanedResponse.substring(0, 500));
            throw new Error("Failed to parse document from Gemini");
        }
    }
}
