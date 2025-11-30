/**
 * Validates an IBAN using MOD-97 algorithm.
 * @param {string} iban 
 * @returns {boolean}
 */
function validateIBAN(iban) {
    if (!iban || typeof iban !== 'string') return false;
    
    // Remove spaces and uppercase
    const normalized = iban.replace(/\s/g, '').toUpperCase();
    
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
        return remainder === 1n;
    } catch (e) {
        return false;
    }
}

/**
 * Validates the drawdown response data.
 * @param {object} data The JSON response from the API.
 * @param {number|null} expectedTotal The expected total amount (optional).
 * @returns {object} Result with stats and errors.
 */
function validateDrawdown(data, expectedTotal = null) {
    const results = {
        validIbans: 0,
        invalidIbans: 0,
        totalAmount: 0,
        totalMatches: true,
        errors: []
    };

    // The API might return { drawdown: [...] } or just [...] depending on schema/prompt
    // Our schema defines { drawdown: [ ... ] }
    let items = [];
    if (data && Array.isArray(data.drawdown)) {
        items = data.drawdown;
    } else if (Array.isArray(data)) {
        items = data; // Fallback if model returns direct array
    } else {
        results.errors.push("Invalid JSON structure: missing 'drawdown' array");
        return results;
    }

    for (const item of items) {
        // Validate IBAN
        if (validateIBAN(item.iban)) {
            results.validIbans++;
        } else {
            results.invalidIbans++;
            results.errors.push(`Invalid IBAN: ${item.iban} (Invoice: ${item.invoiceNumber || 'Unknown'})`);
        }

        // Sum Amount
        if (item.amount) {
            // Handle string amounts like "1,234.56" or "1.234,56" if necessary.
            // Assuming standard float or string representation.
            let amtStr = item.amount.toString().replace(/\s/g, '');
            // Simple parse (supports dot decimal)
            const amt = parseFloat(amtStr);
            if (!isNaN(amt)) {
                results.totalAmount += amt;
            }
        }
    }

    // Round to 2 decimals
    results.totalAmount = Math.round(results.totalAmount * 100) / 100;

    if (expectedTotal !== null) {
        // Allow small epsilon difference (0.05)
        if (Math.abs(results.totalAmount - expectedTotal) > 0.05) {
            results.totalMatches = false;
            results.errors.push(`Total amount mismatch: Calculated ${results.totalAmount}, Expected ${expectedTotal}`);
        }
    }

    return results;
}

module.exports = { validateIBAN, validateDrawdown };
