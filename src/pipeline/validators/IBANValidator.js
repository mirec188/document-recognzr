import { BaseValidator } from './BaseValidator.js';
import { validateIBAN, validateIBANDetailed } from '../../services/tiling.service.js';
import { getProvider } from '../providers/index.js';
import { enforceStrictSchema } from '../../services/schema.service.js';

/**
 * IBAN Validator - Validates IBANs using MOD-97 algorithm.
 * Can attempt repair by re-sending tile images with focused prompts.
 * Now includes detailed validation with length checks.
 */
export class IBANValidator extends BaseValidator {
    constructor() {
        super('IBANValidator');
    }

    getFieldName() {
        return 'iban';
    }

    /**
     * Validate an item's IBAN.
     * @param {Object} item
     * @returns {boolean}
     */
    validate(item) {
        if (!item || !item.iban) {
            return false;  // Missing IBAN is invalid
        }
        return validateIBAN(item.iban);
    }

    /**
     * Get detailed validation info for an item's IBAN.
     * @param {Object} item
     * @returns {{valid: boolean, issue: string|null, details: Object}}
     */
    getValidationDetails(item) {
        if (!item || !item.iban) {
            return { valid: false, issue: 'missing', details: {} };
        }
        const details = validateIBANDetailed(item.iban);
        return {
            valid: details.valid,
            issue: details.issue,
            details
        };
    }

    /**
     * Attempt to repair invalid IBANs by re-sending tile images.
     *
     * @param {Array} invalidItems - Items with invalid IBANs
     * @param {Object} context - Processing context
     * @returns {Promise<Array>} - Array of repaired items
     */
    async repair(invalidItems, context) {
        if (!invalidItems || invalidItems.length === 0) {
            return [];
        }

        // Only repair for OpenAI providers (have tile images)
        if (!context.isOpenAIProvider()) {
            console.log(`[${this.name}] Skipping repair - not OpenAI provider`);
            return [];
        }

        // Group invalid items by tile index
        const itemsByTile = new Map();
        const itemsWithoutTile = [];

        for (const item of invalidItems) {
            const tileIdx = item._tileIndex;
            if (tileIdx === undefined) {
                itemsWithoutTile.push(item);
            } else {
                if (!itemsByTile.has(tileIdx)) {
                    itemsByTile.set(tileIdx, []);
                }
                itemsByTile.get(tileIdx).push(item);
            }
        }

        // Handle items without tile tracking
        if (itemsWithoutTile.length > 0) {
            console.log(`[${this.name}] ${itemsWithoutTile.length} items without tile tracking - assigning to tile 0`);
            if (!itemsByTile.has(0)) {
                itemsByTile.set(0, []);
            }
            itemsByTile.get(0).push(...itemsWithoutTile);
        }

        if (itemsByTile.size === 0) {
            return [];
        }

        console.log(`[${this.name}] Re-verifying ${invalidItems.length} items across ${itemsByTile.size} tiles`);

        const provider = getProvider(context.getProvider());
        const allRepaired = [];

        // Process each tile
        for (const [tileIdx, items] of itemsByTile) {
            const tile = context.tiles[tileIdx];
            if (!tile) {
                console.log(`[${this.name}] ⚠ Tile ${tileIdx} not found, skipping ${items.length} items`);
                continue;
            }

            const repaired = await this.reVerifyTile(tile, items, context, provider);
            allRepaired.push(...repaired);
        }

        return allRepaired;
    }

    /**
     * Re-verify IBANs for a single tile.
     */
    async reVerifyTile(tile, items, context, provider) {
        // Build detailed issue list with specific problems
        const ibanList = items.map(item => {
            const validation = this.getValidationDetails(item);
            const details = validation.details;
            let issueDesc = '';

            if (details.issue === 'too_short') {
                const missing = details.expectedLength - details.actualLength;
                issueDesc = ` - TOO SHORT: has ${details.actualLength} chars, needs ${details.expectedLength} (missing ${missing} digit${missing > 1 ? 's' : ''})`;
            } else if (details.issue === 'too_long') {
                const extra = details.actualLength - details.expectedLength;
                issueDesc = ` - TOO LONG: has ${details.actualLength} chars, needs ${details.expectedLength} (${extra} extra digit${extra > 1 ? 's' : ''})`;
            } else if (details.issue === 'checksum_failed') {
                issueDesc = ' - CHECKSUM FAILED: digit(s) may be wrong';
            }

            return `Invoice: ${item.invoiceNumber || '?'}, Current IBAN: ${item.iban}${issueDesc}`;
        }).join('\n');

        const reVerifyPrompt = `IMPORTANT: Re-examine this document section VERY carefully.

The following IBANs failed validation and are INCORRECT:
${ibanList}

CRITICAL VALIDATION RULES:
- Slovak IBANs (SK) must be EXACTLY 24 characters: SK + 2 check digits + 20 digits
- Czech IBANs (CZ) must be EXACTLY 24 characters: CZ + 2 check digits + 20 digits
- Count EVERY digit carefully - missing or extra digits are common OCR errors
- Common OCR errors: 0↔O, 1↔I↔l, 5↔S, 6↔8, B↔8

For IBANs marked "TOO SHORT": Look for missing digits, often repeated zeros (00) that OCR merged.
For IBANs marked "TOO LONG": Look for duplicated digits that should appear only once.
For IBANs marked "CHECKSUM FAILED": One or more digits may be misread.

Extract ONLY the rows listed above with CORRECTED IBANs. Count the digits to ensure correct length.`;

        const userContent = [
            { type: "text", text: reVerifyPrompt },
            ...tile.images
        ];

        try {
            const strictSchema = enforceStrictSchema({ ...context.schema });

            const { data } = await provider.extract({
                images: userContent,
                instructions: reVerifyPrompt,
                docType: context.docType,
                schema: strictSchema,
                enforceSchema: context.options.enforceJsonSchema !== false,
                options: { useTileTimeout: true }
            });

            // Filter corrections - only accept items we asked about with valid IBANs
            const requestedInvoices = new Set(
                items.map(i => String(i.invoiceNumber || '').trim().toLowerCase())
            );

            const correctedFromTile = data?.drawdowns || data?.items || [];
            const repaired = [];

            for (const corrected of correctedFromTile) {
                const invoiceKey = String(corrected.invoiceNumber || '').trim().toLowerCase();

                if (!requestedInvoices.has(invoiceKey)) {
                    continue;  // Not one we asked about
                }

                if (validateIBAN(corrected.iban)) {
                    console.log(`[${this.name}] ✓ Tile ${tile.globalIndex}: ${corrected.invoiceNumber} corrected to valid IBAN`);
                    repaired.push(corrected);
                } else {
                    console.log(`[${this.name}] ✗ Tile ${tile.globalIndex}: ${corrected.invoiceNumber} still invalid`);
                }
            }

            return repaired;
        } catch (err) {
            console.error(`[${this.name}] Re-verification failed for tile ${tile.globalIndex}:`, err.message);
            return [];
        }
    }
}
