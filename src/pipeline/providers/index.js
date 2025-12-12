import { BaseProvider } from './BaseProvider.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import { AzureProvider } from './AzureProvider.js';
import { GeminiProvider } from './GeminiProvider.js';

export { BaseProvider, OpenAIProvider, AzureProvider, GeminiProvider };

/**
 * Provider factory - creates the appropriate provider instance.
 */
const providerInstances = {
    openai: null,
    'azure-openai': null,
    gemini: null
};

/**
 * Get a provider instance by name.
 * Providers are singleton instances.
 *
 * @param {string} providerName - 'openai', 'azure-openai', or 'gemini'
 * @returns {BaseProvider}
 */
export function getProvider(providerName) {
    const name = providerName || 'gemini';

    if (!providerInstances[name]) {
        switch (name) {
            case 'openai':
                providerInstances[name] = new OpenAIProvider();
                break;
            case 'azure-openai':
                providerInstances[name] = new AzureProvider();
                break;
            case 'gemini':
            default:
                providerInstances[name] = new GeminiProvider();
                break;
        }
    }

    return providerInstances[name];
}

/**
 * Check if a provider is available (configured and ready).
 * @param {string} providerName
 * @returns {boolean}
 */
export function isProviderAvailable(providerName) {
    const provider = getProvider(providerName);
    return provider.isConfigured();
}
