import { ProxyAgent } from "undici";
import { BaseProvider } from './BaseProvider.js';
import { getProviderConfig } from '../../config/index.js';
import { logAPICall } from '../../services/api-logger.service.js';

/**
 * OpenAI Provider - Uses OpenAI Responses API for document extraction.
 */
export class OpenAIProvider extends BaseProvider {
    constructor() {
        super('OpenAIProvider');
        this.config = getProviderConfig('openai');
    }

    isConfigured() {
        return !!this.config.apiKey;
    }

    /**
     * Extract data from images using OpenAI Responses API.
     */
    async extract(params) {
        const { images, instructions, docType, schema, enforceSchema, options = {} } = params;

        if (!this.isConfigured()) {
            throw new Error('OpenAI API key not configured');
        }

        // Convert images to Responses API format
        const inputContent = this.convertToResponsesFormat(images);

        // Build request body
        const requestBody = {
            model: this.config.model,
            instructions: instructions,
            input: [
                {
                    role: "user",
                    content: inputContent
                }
            ],
            store: false
        };

        // Add structured output if schema enforcement enabled
        if (enforceSchema && schema) {
            requestBody.text = {
                format: {
                    type: "json_schema",
                    name: docType,
                    strict: true,
                    schema: schema
                }
            };
        }

        const imageCount = inputContent.filter(c => c.type === 'input_image').length;
        console.log(`[${this.name}] Request: model=${this.config.model}, images=${imageCount}, structuredOutput=${!!enforceSchema}`);

        // Make request with appropriate timeout
        const timeout = options.useTileTimeout ? this.config.tileTimeout : this.config.timeout;
        const startTime = Date.now();

        // Log request
        logAPICall({
            service: 'OpenAI',
            operation: 'extract',
            endpoint: 'https://api.openai.com/v1/responses',
            model: this.config.model,
            request: {
                instructions: instructions,
                input: requestBody.input,
                text: requestBody.text,
                store: requestBody.store,
                imageCount,
                enforceSchema: !!enforceSchema,
                timeout
            }
        });

        const response = await this.makeRequest(requestBody, timeout);
        const duration = Date.now() - startTime;

        // Parse response
        const content = this.extractContent(response);

        // Log response
        logAPICall({
            service: 'OpenAI',
            operation: 'extract-response',
            model: this.config.model,
            response: {
                id: response.id,
                status: response.status,
                usage: response.usage,
                content: content
            },
            duration
        });

        console.log(`[${this.name}] Response: status=${response.status}, tokens=${response.usage?.input_tokens}+${response.usage?.output_tokens}`);

        try {
            const parsed = JSON.parse(content);
            return { data: parsed, responseId: response.id };
        } catch (e) {
            console.error(`[${this.name}] Failed to parse response:`, content.substring(0, 500));
            throw new Error("Failed to parse document from OpenAI");
        }
    }

    /**
     * Convert Chat Completions format to Responses API format.
     */
    convertToResponsesFormat(userContent) {
        return userContent.map(item => {
            if (item.type === "image_url") {
                return {
                    type: "input_image",
                    image_url: item.image_url.url,
                    detail: item.image_url.detail || "high"
                };
            } else if (item.type === "text") {
                return {
                    type: "input_text",
                    text: item.text
                };
            }
            return item;
        });
    }

    /**
     * Extract text content from Responses API response.
     */
    extractContent(response) {
        let content = "";
        if (response.output && Array.isArray(response.output)) {
            for (const outputItem of response.output) {
                if (outputItem.type === "message" && outputItem.content) {
                    for (const contentItem of outputItem.content) {
                        if (contentItem.type === "output_text") {
                            content += contentItem.text;
                        }
                    }
                }
            }
        }
        return content;
    }

    /**
     * Make HTTP request to OpenAI Responses API.
     */
    async makeRequest(body, timeout) {
        const proxyUrl = this.config.proxy;
        const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

        const signal = AbortSignal.timeout(timeout);

        const response = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.config.apiKey}`
            },
            body: JSON.stringify(body),
            signal,
            cache: 'no-store',
            dispatcher
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => "");
            throw new Error(`OpenAI Responses API HTTP ${response.status}: ${errText}`);
        }

        return await response.json();
    }
}
