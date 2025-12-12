import fs from 'fs';
import path from 'path';

/**
 * API Call Logger Service
 *
 * Logs all API calls (OpenAI, Azure, Gemini, Azure Vision) to a file
 * for debugging and review of prompts and settings.
 */

const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'api-calls.log');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Format a log entry with timestamp and structured data.
 */
function formatLogEntry(entry) {
    const timestamp = new Date().toISOString();
    const separator = '='.repeat(80);

    let log = `\n${separator}\n`;
    log += `[${timestamp}] ${entry.service} - ${entry.operation}\n`;
    log += `${separator}\n\n`;

    if (entry.endpoint) {
        log += `ENDPOINT: ${entry.endpoint}\n\n`;
    }

    if (entry.model) {
        log += `MODEL: ${entry.model}\n\n`;
    }

    if (entry.request) {
        log += `REQUEST:\n`;
        log += `${'-'.repeat(40)}\n`;
        log += formatObject(entry.request);
        log += `\n`;
    }

    if (entry.response) {
        log += `RESPONSE:\n`;
        log += `${'-'.repeat(40)}\n`;
        log += formatObject(entry.response);
        log += `\n`;
    }

    if (entry.error) {
        log += `ERROR:\n`;
        log += `${'-'.repeat(40)}\n`;
        log += formatObject(entry.error);
        log += `\n`;
    }

    if (entry.duration) {
        log += `DURATION: ${entry.duration}ms\n`;
    }

    log += `\n`;
    return log;
}

/**
 * Format an object for logging, handling special cases.
 */
function formatObject(obj) {
    if (typeof obj === 'string') {
        return obj;
    }

    // Deep clone to avoid modifying original
    const sanitized = sanitizeForLogging(obj);

    return JSON.stringify(sanitized, null, 2);
}

/**
 * Sanitize object for logging - truncate large base64 data, etc.
 */
function sanitizeForLogging(obj, depth = 0) {
    if (depth > 10) return '[MAX_DEPTH]';

    if (obj === null || obj === undefined) {
        return obj;
    }

    if (typeof obj === 'string') {
        // Truncate base64 data
        if (obj.length > 500 && isBase64Like(obj)) {
            return `[BASE64_DATA: ${obj.length} chars, first 100: ${obj.substring(0, 100)}...]`;
        }
        // Truncate very long strings
        if (obj.length > 16000) {
            return `${obj.substring(0, 2000)}... [TRUNCATED: ${obj.length} total chars]`;
        }
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeForLogging(item, depth + 1));
    }

    if (typeof obj === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            // Special handling for image data
            if (key === 'image_url' && value?.url) {
                result[key] = {
                    ...value,
                    url: value.url.length > 200
                        ? `[DATA_URL: ${value.url.length} chars]`
                        : value.url
                };
            } else if (key === 'data' && typeof value === 'string' && value.length > 500) {
                result[key] = `[IMAGE_DATA: ${value.length} chars]`;
            } else if (key === 'inlineData' && value?.data) {
                result[key] = {
                    ...value,
                    data: `[INLINE_DATA: ${value.data.length} chars]`
                };
            } else {
                result[key] = sanitizeForLogging(value, depth + 1);
            }
        }
        return result;
    }

    return obj;
}

/**
 * Check if a string looks like base64 data.
 */
function isBase64Like(str) {
    // Check if it starts with data URL or looks like base64
    if (str.startsWith('data:')) return true;
    // Check for base64 pattern (mostly alphanumeric with +/=)
    const base64Pattern = /^[A-Za-z0-9+/]+=*$/;
    return base64Pattern.test(str.substring(0, 100));
}

/**
 * Write log entry to file.
 */
function writeToFile(content) {
    try {
        fs.appendFileSync(LOG_FILE, content, 'utf8');
    } catch (error) {
        console.error('[APILogger] Failed to write to log file:', error.message);
    }
}

/**
 * Log an API call.
 *
 * @param {Object} entry - Log entry
 * @param {string} entry.service - Service name (OpenAI, Azure, Gemini, AzureVision)
 * @param {string} entry.operation - Operation name (extract, analyze, ocr)
 * @param {string} [entry.endpoint] - API endpoint URL
 * @param {string} [entry.model] - Model being used
 * @param {Object} [entry.request] - Request payload
 * @param {Object} [entry.response] - Response data
 * @param {Object} [entry.error] - Error information
 * @param {number} [entry.duration] - Call duration in ms
 */
export function logAPICall(entry) {
    const formatted = formatLogEntry(entry);
    writeToFile(formatted);
}

/**
 * Log the start of a new benchmark/test run.
 */
export function logSessionStart(config) {
    const timestamp = new Date().toISOString();
    const header = `
${'#'.repeat(80)}
${'#'.repeat(80)}
##  NEW SESSION: ${timestamp}
${'#'.repeat(80)}
${'#'.repeat(80)}

CONFIGURATION:
${JSON.stringify(config, null, 2)}

`;
    writeToFile(header);
}

/**
 * Clear the log file.
 */
export function clearLog() {
    try {
        fs.writeFileSync(LOG_FILE, '', 'utf8');
    } catch (error) {
        console.error('[APILogger] Failed to clear log file:', error.message);
    }
}

/**
 * Get the log file path.
 */
export function getLogFilePath() {
    return LOG_FILE;
}
