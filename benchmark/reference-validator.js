const fs = require('fs');
const path = require('path');

/**
 * Reference CSV Validator
 *
 * Compares API extraction results against human-validated reference CSV files.
 */

/**
 * Normalize an amount string to a number.
 * Handles European format: "15 816,28" -> 15816.28
 * @param {string|number} amount
 * @returns {number}
 */
function normalizeAmount(amount) {
    if (typeof amount === 'number') return amount;
    if (!amount) return 0;

    // Remove spaces (thousands separator)
    let str = String(amount).replace(/\s/g, '');
    // Replace comma with dot for decimal
    str = str.replace(',', '.');
    return parseFloat(str) || 0;
}

/**
 * Normalize an IBAN for comparison.
 * Removes spaces and converts to uppercase.
 * @param {string} iban
 * @returns {string}
 */
function normalizeIBAN(iban) {
    if (!iban) return '';
    return String(iban).replace(/\s/g, '').toUpperCase();
}

/**
 * Normalize an invoice number for comparison.
 * Trims whitespace and converts to lowercase.
 * @param {string} invoiceNumber
 * @returns {string}
 */
function normalizeInvoiceNumber(invoiceNumber) {
    if (!invoiceNumber) return '';
    return String(invoiceNumber).trim().toLowerCase();
}

/**
 * Load and parse a reference CSV file.
 * @param {string} csvPath - Path to the CSV file
 * @returns {Array<Object>} - Parsed reference data
 */
function loadReferenceCSV(csvPath) {
    const content = fs.readFileSync(csvPath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());

    if (lines.length < 2) {
        return [];
    }

    // Parse header (semicolon-delimited, may have extra spaces)
    const headerLine = lines[0];
    const headers = headerLine.split(';').map(h => h.trim().toLowerCase());

    // Find column indices
    const invoiceIdx = headers.findIndex(h => h === 'invoicenumber');
    const vsIdx = headers.findIndex(h => h === 'variablesymbol');
    const ibanIdx = headers.findIndex(h => h === 'iban');
    const amountIdx = headers.findIndex(h => h === 'amount');

    const items = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = line.split(';');

        const item = {
            invoiceNumber: cols[invoiceIdx]?.trim() || '',
            variableSymbol: cols[vsIdx]?.trim() || '',
            iban: normalizeIBAN(cols[ibanIdx]),
            amount: normalizeAmount(cols[amountIdx]),
            _raw: {
                invoiceNumber: cols[invoiceIdx]?.trim(),
                iban: cols[ibanIdx]?.trim(),
                amount: cols[amountIdx]?.trim()
            }
        };

        if (item.invoiceNumber) {
            items.push(item);
        }
    }

    return items;
}

/**
 * Find reference CSV for a document file.
 * @param {string} docPath - Path to document (e.g., benchmark/data/ziadost1.pdf)
 * @returns {string|null} - Path to reference CSV or null if not found
 */
function findReferenceCSV(docPath) {
    const dir = path.dirname(docPath);
    const baseName = path.basename(docPath, path.extname(docPath));
    const refPath = path.join(dir, `${baseName}_reference.csv`);

    if (fs.existsSync(refPath)) {
        return refPath;
    }
    return null;
}

/**
 * Compare API result against reference data.
 * @param {Array} apiItems - Extracted items from API (result.drawdowns)
 * @param {Array} refItems - Reference items from CSV
 * @returns {Object} - Comparison results
 */
function compareWithReference(apiItems, refItems) {
    const result = {
        totalRef: refItems.length,
        totalApi: apiItems.length,
        matched: 0,
        matchedWithCorrectIban: 0,
        matchedWithCorrectAmount: 0,
        matchedAllFields: 0,
        missing: [],        // In ref but not in API
        extra: [],          // In API but not in ref
        fieldErrors: []     // Mismatches per field
    };

    // Build map of reference items by normalized invoice number
    const refMap = new Map();
    for (const ref of refItems) {
        const key = normalizeInvoiceNumber(ref.invoiceNumber);
        if (!refMap.has(key)) {
            refMap.set(key, []);
        }
        refMap.get(key).push(ref);
    }

    // Track which reference items have been matched
    const matchedRefKeys = new Set();

    // Compare each API item against reference
    for (const api of apiItems) {
        const apiKey = normalizeInvoiceNumber(api.invoiceNumber);
        const apiIban = normalizeIBAN(api.iban);
        const apiAmount = normalizeAmount(api.amount);

        const refs = refMap.get(apiKey);

        if (!refs || refs.length === 0) {
            // Extra item in API (not in reference)
            result.extra.push({
                invoiceNumber: api.invoiceNumber,
                iban: api.iban,
                amount: api.amount
            });
            continue;
        }

        // Find best matching reference item (prefer exact IBAN match)
        let bestRef = null;
        let bestRefIdx = -1;
        for (let i = 0; i < refs.length; i++) {
            const ref = refs[i];
            if (ref._matched) continue;

            if (ref.iban === apiIban) {
                bestRef = ref;
                bestRefIdx = i;
                break;
            }
            if (!bestRef) {
                bestRef = ref;
                bestRefIdx = i;
            }
        }

        if (!bestRef) {
            // All refs with this invoice number already matched
            result.extra.push({
                invoiceNumber: api.invoiceNumber,
                iban: api.iban,
                amount: api.amount
            });
            continue;
        }

        // Mark as matched
        bestRef._matched = true;
        matchedRefKeys.add(apiKey);
        result.matched++;

        // Compare fields
        const ibanCorrect = apiIban === bestRef.iban;
        const amountCorrect = Math.abs(apiAmount - bestRef.amount) < 0.01;

        if (ibanCorrect) result.matchedWithCorrectIban++;
        if (amountCorrect) result.matchedWithCorrectAmount++;
        if (ibanCorrect && amountCorrect) result.matchedAllFields++;

        // Track field errors
        if (!ibanCorrect || !amountCorrect) {
            const error = {
                invoiceNumber: api.invoiceNumber,
                fields: []
            };

            if (!ibanCorrect) {
                error.fields.push({
                    field: 'iban',
                    expected: bestRef._raw?.iban || bestRef.iban,
                    got: api.iban
                });
            }

            if (!amountCorrect) {
                error.fields.push({
                    field: 'amount',
                    expected: bestRef._raw?.amount || bestRef.amount,
                    got: api.amount
                });
            }

            result.fieldErrors.push(error);
        }
    }

    // Find missing items (in ref but not matched)
    for (const ref of refItems) {
        if (!ref._matched) {
            result.missing.push({
                invoiceNumber: ref._raw?.invoiceNumber || ref.invoiceNumber,
                iban: ref._raw?.iban || ref.iban,
                amount: ref._raw?.amount || ref.amount
            });
        }
    }

    return result;
}

/**
 * Format comparison result for logging.
 * @param {string} filename - Source document filename
 * @param {string} refPath - Path to reference CSV
 * @param {Object} comparison - Result from compareWithReference()
 * @returns {string} - Formatted log string
 */
function formatComparisonLog(filename, refPath, comparison) {
    const sep = '='.repeat(80);
    let log = `\n${sep}\n`;
    log += `REFERENCE COMPARISON: ${filename}\n`;
    log += `${sep}\n\n`;

    log += `Reference file: ${refPath}\n`;
    log += `Reference rows: ${comparison.totalRef}\n`;
    log += `API rows: ${comparison.totalApi}\n\n`;

    const ibanPct = comparison.matched > 0
        ? ((comparison.matchedWithCorrectIban / comparison.matched) * 100).toFixed(1)
        : '0.0';
    const amountPct = comparison.matched > 0
        ? ((comparison.matchedWithCorrectAmount / comparison.matched) * 100).toFixed(1)
        : '0.0';
    const perfectPct = comparison.matched > 0
        ? ((comparison.matchedAllFields / comparison.matched) * 100).toFixed(1)
        : '0.0';

    log += `Matching Analysis:\n`;
    log += `  - Matched by invoiceNumber: ${comparison.matched}/${comparison.totalRef}\n`;
    log += `  - IBAN accuracy: ${comparison.matchedWithCorrectIban}/${comparison.matched} (${ibanPct}%)\n`;
    log += `  - Amount accuracy: ${comparison.matchedWithCorrectAmount}/${comparison.matched} (${amountPct}%)\n`;
    log += `  - Perfect matches: ${comparison.matchedAllFields}/${comparison.matched} (${perfectPct}%)\n\n`;

    if (comparison.missing.length > 0) {
        log += `Missing in API (in ref but not extracted): ${comparison.missing.length}\n`;
        for (const item of comparison.missing.slice(0, 10)) {
            log += `  - Invoice: ${item.invoiceNumber}, IBAN: ${item.iban}, Amount: ${item.amount}\n`;
        }
        if (comparison.missing.length > 10) {
            log += `  ... and ${comparison.missing.length - 10} more\n`;
        }
        log += '\n';
    }

    if (comparison.extra.length > 0) {
        log += `Extra in API (extracted but not in ref): ${comparison.extra.length}\n`;
        for (const item of comparison.extra.slice(0, 10)) {
            log += `  - Invoice: ${item.invoiceNumber}, IBAN: ${item.iban}, Amount: ${item.amount}\n`;
        }
        if (comparison.extra.length > 10) {
            log += `  ... and ${comparison.extra.length - 10} more\n`;
        }
        log += '\n';
    }

    if (comparison.fieldErrors.length > 0) {
        log += `Field Mismatches: ${comparison.fieldErrors.length}\n`;
        for (const error of comparison.fieldErrors.slice(0, 10)) {
            for (const field of error.fields) {
                log += `  - Invoice ${error.invoiceNumber}: ${field.field} mismatch\n`;
                log += `      Expected: ${field.expected}\n`;
                log += `      Got:      ${field.got}\n`;
            }
        }
        if (comparison.fieldErrors.length > 10) {
            log += `  ... and ${comparison.fieldErrors.length - 10} more errors\n`;
        }
        log += '\n';
    }

    log += `${sep}\n`;
    return log;
}

module.exports = {
    loadReferenceCSV,
    findReferenceCSV,
    compareWithReference,
    formatComparisonLog,
    normalizeAmount,
    normalizeIBAN,
    normalizeInvoiceNumber
};
