import { ProxyAgent } from "undici";
import { BaseProvider } from './BaseProvider.js';
import { getProviderConfig } from '../../config/index.js';
import { logAPICall } from '../../services/api-logger.service.js';

/**
 * Azure OpenAI Provider - Uses Azure's Chat Completions API.
 */
export class AzureProvider extends BaseProvider {
    constructor() {
        super('AzureProvider');
        this.config = getProviderConfig('azure-openai');
    }

    isConfigured() {
        return !!(this.config.apiKey && this.config.resourceName && this.config.deploymentName);
    }

    /**
     * Extract data from images using Azure Chat Completions API.
     */
    async extract(params) {
        const { images, instructions, docType, schema, enforceSchema, options = {} } = params;

        if (!this.isConfigured()) {
            throw new Error('Azure OpenAI environment is not fully configured');
        }

        const { resourceName, deploymentName, apiKey, apiVersion } = this.config;

        // Build request body
        const requestBody = {
            model: deploymentName,
            messages: [
                { role: "system", content: instructions },
                { role: "user", content: images }  // images are already in correct format
            ]
        };

        // Add structured output if schema enforcement enabled
        if (enforceSchema && schema) {
            requestBody.response_format = {
                type: "json_schema",
                json_schema: {
                    name: docType,
                    strict: true,
                    schema: schema
                }
            };
        }

        const imageCount = images.filter(c => c.type === 'image_url').length;
        console.log(`[${this.name}] Request: deployment=${deploymentName}, images=${imageCount}, structuredOutput=${!!enforceSchema}`);

        // Make request with appropriate timeout
        const timeout = options.useTileTimeout ? this.config.tileTimeout : this.config.timeout;
        const startTime = Date.now();

        const endpoint = `https://${resourceName}.openai.azure.com/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;

        // Log request
        logAPICall({
            service: 'AzureOpenAI',
            operation: 'extract',
            endpoint: endpoint,
            model: deploymentName,
            request: {
                systemPrompt: instructions,
                userContent: images,
                response_format: requestBody.response_format,
                imageCount,
                enforceSchema: !!enforceSchema,
                timeout
            }
        });

        const response = await this.makeRequest(requestBody, timeout);
        const duration = Date.now() - startTime;

        // Parse response
        const content = response?.choices?.[0]?.message?.content || "";

        // Log response
        logAPICall({
            service: 'AzureOpenAI',
            operation: 'extract-response',
            model: deploymentName,
            response: {
                id: response.id,
                usage: response.usage,
                content: content,
                finishReason: response?.choices?.[0]?.finish_reason
            },
            duration
        });

        console.log(`[${this.name}] Response: contentLength=${content.length}`);

        try {
            const parsed = JSON.parse(content);
            return { data: parsed, responseId: null };  // Azure doesn't support response IDs
        } catch (e) {
            console.error(`[${this.name}] Failed to parse response:`, content.substring(0, 500));
            throw new Error("Failed to parse document from Azure OpenAI");
        }
    }

    /**
     * Make HTTP request to Azure Chat Completions API.
     */
    async makeRequest(body, timeout) {
        const { resourceName, deploymentName, apiKey, apiVersion } = this.config;
        const baseUrl = `https://${resourceName}.openai.azure.com/openai/deployments/${deploymentName}`;
        const url = `${baseUrl}/chat/completions?api-version=${apiVersion}`;

        const proxyUrl = this.config.proxy;
        const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

        const signal = AbortSignal.timeout(timeout);

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "api-key": apiKey
            },
            body: JSON.stringify(body),
            signal,
            cache: 'no-store',
            dispatcher
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => "");
            throw new Error(`Azure HTTP ${response.status}: ${errText}`);
        }

        return await response.json();
    }
}
