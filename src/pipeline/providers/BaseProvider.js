/**
 * Base class for AI providers.
 * Defines the interface that all providers must implement.
 */
export class BaseProvider {
    constructor(name) {
        this.name = name;
    }

    /**
     * Extract data from images using this provider.
     *
     * @param {Object} params - Extraction parameters
     * @param {Array} params.images - Array of image content objects (base64 or buffers)
     * @param {string} params.instructions - System instructions/prompt
     * @param {string} params.docType - Document type
     * @param {Object} params.schema - JSON schema for structured output
     * @param {boolean} params.enforceSchema - Whether to enforce strict schema
     * @param {Object} params.options - Additional provider-specific options
     * @returns {Promise<{data: Object, responseId?: string}>} - Extracted data
     */
    async extract(params) {
        throw new Error(`${this.name}.extract() not implemented`);
    }

    /**
     * Check if this provider is properly configured (has API keys, etc.).
     * @returns {boolean}
     */
    isConfigured() {
        throw new Error(`${this.name}.isConfigured() not implemented`);
    }

    /**
     * Build instructions from prompt and schema.
     * @param {string} customPrompt - Custom prompt (optional)
     * @param {string} docType - Document type
     * @param {Object} schema - JSON schema
     * @param {boolean} enforceSchema - Whether schema is enforced via API
     * @returns {string}
     */
    buildInstructions(customPrompt, docType, schema, enforceSchema) {
        const defaultPrompt = `You are an expert document parser. You are extracting data about list of drawdowns (invoice number, variable symbol, amount and iban (bank account) to where money will be sent). Focus, do not make mistakes. This is a scan. IBANS have to be valid. Be careful with errors like 8-6, 5-3 similar numbers etc. Extract information from this ${docType}.`;

        if (customPrompt) {
            if (customPrompt.includes("{{schema}}")) {
                return customPrompt.replace("{{schema}}", JSON.stringify(schema));
            } else if (!enforceSchema) {
                return `${customPrompt} Return the output as a valid JSON object adhering to this schema: ${JSON.stringify(schema)}`;
            }
            return customPrompt;
        }

        if (!enforceSchema) {
            return `${defaultPrompt} Return the output as a valid JSON object adhering to this schema: ${JSON.stringify(schema)}`;
        }

        return defaultPrompt;
    }
}
