/**
 * Centralized configuration for document-recognizer.
 * All environment variables and defaults are defined here.
 */

// Proxy configuration
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || null;

export const config = {
    // AI Provider configurations
    providers: {
        openai: {
            apiKey: process.env.OPENAI_API_KEY,
            model: process.env.OPENAI_MODEL || 'gpt-5.1',
            timeout: Number(process.env.OPENAI_TIMEOUT_MS) || 300000,
            tileTimeout: Number(process.env.TILE_TIMEOUT_MS) || 120000,
            proxy: proxyUrl
        },
        azure: {
            apiKey: process.env.AZURE_OPENAI_API_KEY,
            resourceName: process.env.AZURE_OPENAI_RESOURCE_NAME,
            deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT,
            apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview',
            timeout: Number(process.env.OPENAI_TIMEOUT_MS) || 300000,
            tileTimeout: Number(process.env.TILE_TIMEOUT_MS) || 120000,
            proxy: proxyUrl
        },
        gemini: {
            apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
            model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
            timeout: Number(process.env.GEMINI_TIMEOUT_MS) || 300000
        },
        azureVision: {
            endpoint: process.env.AZURE_VISION_ENDPOINT,
            apiKey: process.env.AZURE_VISION_KEY,
            defaultLanguage: process.env.AZURE_VISION_LANGUAGE || 'sk',
            maxConcurrency: Number(process.env.AZURE_VISION_CONCURRENCY) || 3
        }
    },

    // Azure Vision OCR settings
    ocr: {
        enabled: process.env.AZURE_OCR_ENABLED === 'true',
        language: process.env.AZURE_VISION_LANGUAGE || 'sk',
        maxConcurrency: Number(process.env.AZURE_VISION_CONCURRENCY) || 3
    },

    // PDF to JPEG conversion settings
    pdf: {
        density: Number(process.env.PDF_DENSITY) || 150,
        quality: Number(process.env.PDF_QUALITY) || 80,
        maxPages: Number(process.env.PDF_MAX_PAGES) || 10,
        maxWidth: Number(process.env.PDF_MAX_WIDTH) || 1600,
        grayscale: true,
        normalize: true
    },

    // Tiling configuration
    tiling: {
        defaults: {
            enableTiling: true,
            headerHeight: 500,
            sliceHeight: 500,
            overlap: 100,
            parallelMode: true,
            maxConcurrency: 5,
            retryAttempts: 2
        },
        // Document-type specific overrides
        byDocType: {
            drawdown: {
                enableTiling: true,
                parallelMode: true
            },
            invoice: {
                enableTiling: false
            },
            bankStatement: {
                enableTiling: true
            },
            loanContract: {
                enableTiling: false
            }
        }
    },

    // Validation configuration
    validation: {
        // Which validators to run for each document type
        byDocType: {
            drawdown: ['iban'],
            invoice: [],
            bankStatement: [],
            loanContract: []
        },
        // Re-verification settings
        reVerification: {
            enabled: true,
            maxAttempts: 1
        }
    },

    // Debug settings
    debug: {
        outputDir: process.env.DEBUG_OUTPUT_DIR || null,
        verbose: process.env.DEBUG_VERBOSE === 'true'
    }
};

/**
 * Get tiling config for a specific document type.
 * Merges defaults with document-type specific overrides.
 * @param {string} docType
 * @param {Object} userOptions - User-provided options (highest priority)
 * @returns {Object}
 */
export function getTilingConfig(docType, userOptions = {}) {
    const defaults = config.tiling.defaults;
    const docTypeOverrides = config.tiling.byDocType[docType] || {};

    return {
        ...defaults,
        ...docTypeOverrides,
        ...userOptions
    };
}

/**
 * Get provider config by name.
 * @param {string} providerName - 'openai', 'azure-openai', or 'gemini'
 * @returns {Object}
 */
export function getProviderConfig(providerName) {
    if (providerName === 'azure-openai') {
        return config.providers.azure;
    }
    return config.providers[providerName] || config.providers.gemini;
}

/**
 * Get validators for a document type.
 * @param {string} docType
 * @returns {string[]}
 */
export function getValidatorsForDocType(docType) {
    return config.validation.byDocType[docType] || [];
}

/**
 * Check if a provider is configured (has API key).
 * @param {string} providerName
 * @returns {boolean}
 */
export function isProviderConfigured(providerName) {
    const providerConfig = getProviderConfig(providerName);
    return !!providerConfig.apiKey;
}

export default config;
