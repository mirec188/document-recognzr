import sharp from 'sharp';
import { saveDebugFiles, getDebugOutputDir } from './pdf.service.js';

/**
 * Validates an IBAN using MOD-97 algorithm.
 * @param {string} iban
 * @returns {boolean}
 */
export function validateIBAN(iban) {
    console.log("Validating IBAN:", iban);
    if (!iban || typeof iban !== 'string') return false;

    // Remove spaces and uppercase
    const normalized = iban.replace(/\s/g, '').toUpperCase();
    console.log("Normalized IBAN:", normalized);
    // Basic regex check (Country code + 2 check digits + up to 30 alphanum)
    // Minimal length is 15 (Norway), Max is 34.
    if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(normalized)) return false;

    // Move first 4 chars to end
    const rearranged = normalized.slice(4) + normalized.slice(0, 4);

    // Replace letters with numbers (A=10, B=11, ..., Z=35)
    let numeric = '';
    for (let i = 0; i < rearranged.length; i++) {
        const code = rearranged.charCodeAt(i);
        if (code >= 65 && code <= 90) { // A-Z
            numeric += (code - 55).toString();
        } else {
            numeric += rearranged[i];
        }
    }

    // Mod 97 check using BigInt
    try {
        const remainder = BigInt(numeric) % 97n;
        console.log("IBAN MOD-97 remainder:", remainder.toString());
        return remainder === 1n;
    } catch (e) {
        return false;
    }
}

// Default tiling configuration (optimized for 2048px wide images)
const DEFAULTS = {
    headerHeight: 200,    // Capture table header area (pixels) - smaller for resized images
    sliceHeight: 900,     // ~10-15 rows at 2048px width
    overlap: 100          // ~2 rows overlap to avoid cutting text
};

/**
 * Tiles a single image buffer into a header and overlapping horizontal slices.
 *
 * @param {Buffer} imageBuffer - The source image buffer (JPEG/PNG)
 * @param {Object} options - Tiling configuration
 * @param {number} options.headerHeight - Height of header section in pixels (default: 300)
 * @param {number} options.sliceHeight - Height of each slice in pixels (default: 1200)
 * @param {number} options.overlap - Overlap between slices in pixels (default: 150)
 * @returns {Promise<{header: Buffer, slices: Buffer[], metadata: {width: number, height: number, sliceCount: number}}>}
 */
export async function tileImage(imageBuffer, options = {}) {
    const config = { ...DEFAULTS, ...options };

    // Get image metadata
    const metadata = await sharp(imageBuffer).metadata();
    const { width, height } = metadata;

    // If image is shorter than header + one slice, return as single slice
    if (height <= config.headerHeight + config.sliceHeight) {
        return {
            header: null,
            slices: [imageBuffer],
            metadata: { width, height, sliceCount: 1, tiled: false }
        };
    }

    // Extract header
    const headerBuffer = await sharp(imageBuffer)
        .extract({
            left: 0,
            top: 0,
            width,
            height: Math.min(config.headerHeight, height)
        })
        .jpeg({ quality: 95 })
        .toBuffer();

    const slices = [];
    const bodyStartY = config.headerHeight;
    const effectiveStep = config.sliceHeight - config.overlap;

    let currentY = bodyStartY;

    while (currentY < height) {
        // Calculate slice bounds
        const startY = currentY;
        const endY = Math.min(currentY + config.sliceHeight, height);
        const sliceActualHeight = endY - startY;

        // Skip if remaining height is too small (less than overlap)
        if (sliceActualHeight <= config.overlap && slices.length > 0) {
            break;
        }

        const sliceBuffer = await sharp(imageBuffer)
            .extract({
                left: 0,
                top: startY,
                width,
                height: sliceActualHeight
            })
            .jpeg({ quality: 95 })
            .toBuffer();

        slices.push(sliceBuffer);
        currentY += effectiveStep;
    }

    // Debug: Save tiles if debug output is enabled
    const debugDir = getDebugOutputDir();
    if (debugDir) {
        // Save header
        if (headerBuffer) {
            await saveDebugFiles([headerBuffer], `p${options.pageIndex || 0}-header`, debugDir);
        }
        // Save slices
        await saveDebugFiles(slices, `p${options.pageIndex || 0}-slice`, debugDir);
    }

    return {
        header: headerBuffer,
        slices,
        metadata: {
            width,
            height,
            sliceCount: slices.length,
            tiled: true,
            headerHeight: config.headerHeight,
            sliceHeight: config.sliceHeight,
            overlap: config.overlap
        }
    };
}

/**
 * Determines if an image should be tiled based on its dimensions.
 * Images shorter than 2x sliceHeight generally don't benefit from tiling.
 *
 * @param {Buffer} imageBuffer - The source image buffer
 * @param {number} sliceHeight - The configured slice height
 * @returns {Promise<boolean>}
 */
export async function shouldTile(imageBuffer, sliceHeight = DEFAULTS.sliceHeight) {
    const metadata = await sharp(imageBuffer).metadata();
    // Tile if image height exceeds 1.5x slice height
    return metadata.height > (sliceHeight * 1.5);
}

/**
 * Normalizes an IBAN by removing spaces and converting to uppercase.
 * Also extracts the "core" digits for fuzzy matching (ignoring check digits).
 * @param {string} iban
 * @returns {{normalized: string, coreDigits: string}}
 */
function normalizeIBAN(iban) {
    if (!iban || typeof iban !== 'string') {
        return { normalized: '', coreDigits: '' };
    }
    const normalized = iban.replace(/\s/g, '').toUpperCase();
    // Core digits = everything after country code and check digits (positions 4+)
    const coreDigits = normalized.slice(4).replace(/[^0-9]/g, '');
    return { normalized, coreDigits };
}

/**
 * Deduplicates extracted rows based on unique identifiers.
 * Uses composite key strategy based on document type.
 * Smart dedup: when same row appears multiple times with different IBAN versions,
 * prefers the version with a valid IBAN checksum.
 *
 * @param {Array} rows - Array of extracted data rows
 * @param {string} docType - Document type for determining key fields
 * @returns {Array} Deduplicated rows preserving original order
 */
export function deduplicateRows(rows, docType) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return rows || [];
    }

    // Define key fields per document type
    const keyFieldsMap = {
        'drawdown': ['variableSymbol', 'invoiceNumber'],
        'invoice': ['invoiceNumber'],
        'bankStatement': ['date', 'description', 'amount'],
        'loanContract': ['contractNumber']
    };

    const keyFields = keyFieldsMap[docType] || [];

    // If no key fields defined, return as-is
    if (keyFields.length === 0) {
        return rows;
    }

    // Map to store best version of each row (keyed by composite key)
    const seen = new Map();
    // Track insertion order
    const insertionOrder = [];

    for (const row of rows) {
        if (!row || typeof row !== 'object') {
            continue;
        }

        // Build composite key from available fields
        const keyParts = keyFields
            .map(field => String(row[field] || '').trim().toLowerCase())
            .filter(v => v !== '');

        // If no valid key parts, keep the row (can't determine uniqueness)
        if (keyParts.length === 0) {
            insertionOrder.push({ key: null, row });
            continue;
        }

        const key = keyParts.join('|');

        if (!seen.has(key)) {
            // First occurrence
            seen.set(key, row);
            insertionOrder.push({ key, row: null }); // Placeholder, will resolve from map
        } else {
            // Duplicate detected - smart selection for drawdown type
            const existing = seen.get(key);

            if (docType === 'drawdown' && row.iban && existing.iban) {
                const newIban = normalizeIBAN(row.iban);
                const existingIban = normalizeIBAN(existing.iban);

                // Only compare if IBANs are similar (same core digits pattern, allowing for OCR errors)
                // Check if they share at least 80% of digits
                const similarity = calculateSimilarity(newIban.coreDigits, existingIban.coreDigits);

                if (similarity > 0.8) {
                    const newIsValid = validateIBAN(row.iban);
                    const existingIsValid = validateIBAN(existing.iban);

                    if (newIsValid && !existingIsValid) {
                        // Replace with version that has valid IBAN
                        console.log(`[Dedup] Replacing invalid IBAN ${existing.iban} with valid ${row.iban} (similarity: ${(similarity * 100).toFixed(0)}%)`);
                        seen.set(key, row);
                    }
                }
                // If IBANs are very different, they might be different rows with same invoice number
                // Keep the first one in this case
            }
        }
    }

    // Build result preserving insertion order
    const result = [];
    for (const entry of insertionOrder) {
        if (entry.key === null) {
            // Row without key - add directly
            result.push(entry.row);
        } else {
            // Get the best version from the map
            const bestRow = seen.get(entry.key);
            if (bestRow && !result.includes(bestRow)) {
                result.push(bestRow);
            }
        }
    }

    return result;
}

/**
 * Calculates similarity between two strings (0-1).
 * Uses simple character matching - good enough for digit comparison.
 */
function calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;

    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1;

    // Count matching characters at same positions
    let matches = 0;
    const minLen = Math.min(str1.length, str2.length);
    for (let i = 0; i < minLen; i++) {
        if (str1[i] === str2[i]) matches++;
    }

    return matches / longer.length;
}

/**
 * Merges results from multiple tile extractions.
 * Handles nested structures (e.g., { drawdowns: [...] })
 *
 * @param {Array<Object>} results - Array of JSON results from each tile/page
 * @param {string} docType - Document type
 * @param {Object} schema - Schema for structure inference (optional)
 * @returns {Object} Merged and deduplicated result
 */
export function aggregateResults(results, docType, schema = null) {
    if (!results || results.length === 0) {
        return {};
    }

    if (results.length === 1) {
        return results[0];
    }

    // Map document types to their array field names
    const arrayFieldMap = {
        'drawdown': 'drawdowns',
        'invoice': 'invoiceRows',
        'bankStatement': 'transactions',
        'loanContract': null // No array field
    };

    const arrayField = arrayFieldMap[docType];

    // If no array field, merge at top level or return first result
    if (!arrayField) {
        // For non-array types, merge objects (later values overwrite)
        return results.reduce((merged, result) => ({ ...merged, ...result }), {});
    }

    // Start with first result as base
    const baseResult = { ...results[0] };

    // Collect all items from the array field
    let allItems = [];
    for (const result of results) {
        if (result && Array.isArray(result[arrayField])) {
            allItems = allItems.concat(result[arrayField]);
        }
    }

    // Deduplicate items
    baseResult[arrayField] = deduplicateRows(allItems, docType);

    // Recalculate totalSum for drawdown type
    if (docType === 'drawdown' && baseResult[arrayField]) {
        baseResult.totalSum = baseResult[arrayField].reduce((sum, item) => {
            const amt = parseFloat(item.amount) || 0;
            return sum + amt;
        }, 0);
        // Round to 2 decimal places
        baseResult.totalSum = Math.round(baseResult.totalSum * 100) / 100;
    }

    return baseResult;
}

/**
 * Gets default tiling configuration
 * @returns {Object} Default tiling options
 */
export function getDefaultTilingConfig() {
    return { ...DEFAULTS };
}
