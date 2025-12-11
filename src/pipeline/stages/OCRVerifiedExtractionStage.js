import { Stage } from '../Stage.js';
import { getProvider } from '../providers/index.js';
import { enforceStrictSchema } from '../../services/schema.service.js';
import { validateIBAN, validateIBANDetailed } from '../../services/tiling.service.js';

/**
 * OCRVerifiedExtractionStage - OCR + Image extraction with IBAN verification loop.
 *
 * Pipeline Mode: "ocr-verified"
 *
 * This stage implements a multi-step extraction with verification:
 * 1. Use Azure OCR text + image for initial extraction
 * 2. Validate all IBANs using MOD-97 checksum
 * 3. If invalid IBANs found, send back to AI with:
 *    - The image
 *    - List of valid IBANs (for context)
 *    - List of invalid IBANs to re-examine
 *    - Request to fix or identify duplicates
 *
 * Benefits:
 * - High accuracy initial extraction from OCR
 * - Automatic correction of OCR/parsing errors
 * - Deduplication of similar IBANs (one valid, one invalid = likely duplicate)
 */
export class OCRVerifiedExtractionStage extends Stage {
    constructor() {
        super('OCRVerifiedExtractionStage');
    }

    async shouldRun(context) {
        return context.metadata.ocrText && context.isOpenAIProvider();
    }

    async process(context) {
        const provider = getProvider(context.getProvider());

        if (!provider.isConfigured()) {
            context.error = `Provider ${context.getProvider()} is not configured`;
            return context;
        }

        console.log(`[${this.name}] Starting OCR-verified extraction pipeline`);

        const enforceSchema = context.options.enforceJsonSchema !== false;
        const strictSchema = enforceSchema ? enforceStrictSchema({ ...context.schema }) : null;

        try {
            // Step 1: Initial extraction with OCR + Image
            console.log(`[${this.name}] Step 1: Initial extraction with OCR text + image`);
            const initialResult = await this.performInitialExtraction(
                context, provider, strictSchema, enforceSchema
            );

            if (!initialResult || !initialResult.data) {
                throw new Error('Initial extraction returned no data');
            }

            // Step 2: Validate IBANs
            console.log(`[${this.name}] Step 2: Validating IBANs`);
            const items = initialResult.data.drawdowns || initialResult.data.items || [];
            const { validItems, invalidItems } = this.validateItems(items);

            console.log(`[${this.name}] Validation result: ${validItems.length} valid, ${invalidItems.length} invalid IBANs`);

            // Step 3: If invalid IBANs exist, first try OCR-based correction
            let finalItems = validItems;
            let remainingInvalidItems = invalidItems;

            if (remainingInvalidItems.length > 0) {
                console.log(`[${this.name}] Step 3a: Attempting OCR-based IBAN correction`);
                const { corrected, stillInvalid } = this.correctIBANsFromOCR(
                    remainingInvalidItems, context.metadata.ocrText
                );

                if (corrected.length > 0) {
                    console.log(`[${this.name}] OCR correction: ${corrected.length} IBANs fixed from OCR text`);
                    finalItems = [...finalItems, ...corrected];
                }
                remainingInvalidItems = stillInvalid;
            }

            // Step 3b: If still invalid IBANs, attempt AI verification/correction
            if (remainingInvalidItems.length > 0) {
                console.log(`[${this.name}] Step 3b: Re-verifying ${remainingInvalidItems.length} invalid IBANs with AI`);
                const correctedItems = await this.performVerificationPass(
                    context, provider, strictSchema, enforceSchema,
                    finalItems, remainingInvalidItems
                );

                // Merge corrected items with valid items
                finalItems = this.mergeResults(finalItems, correctedItems, remainingInvalidItems);
            }

            // Build final result
            const finalData = { ...initialResult.data };
            if (finalData.drawdowns) {
                finalData.drawdowns = finalItems;
            } else if (finalData.items) {
                finalData.items = finalItems;
            }

            context.extractions = [{ data: finalData }];

        } catch (err) {
            context.error = `OCR-verified extraction failed: ${err.message}`;
            context.errors.push({
                stage: this.name,
                message: err.message,
                stack: err.stack
            });
        }

        context.completeStage(this.name);
        return context;
    }

    /**
     * Step 1: Initial extraction using OCR text + image.
     */
    async performInitialExtraction(context, provider, strictSchema, enforceSchema) {
        const ocrText = context.metadata.ocrText;
        const schemaStr = JSON.stringify(context.schema, null, 2);

        const instructions = `You are an expert document parser specializing in financial documents and data extraction.

I'm providing you with:
1. OCR-extracted TEXT from Azure Computer Vision (highly accurate for characters)
2. The original document IMAGE for visual structure reference

## OCR Extracted Text:
\`\`\`
${ocrText}
\`\`\`

## Your Task:
Parse the OCR text and extract data according to this JSON schema:
${schemaStr}

## Guidelines:
- If the page you are reviewing does not have table headers, common columns order can be : invoice number, variable symbol, IBAN, amount
- Trust the OCR text for exact character values (IBANs, invoice numbers, amounts)
- Use the image to understand document structure and which values belong together
- Amounts may use comma as decimal separator (e.g., "1 234,56" = 1234.56)
- Each row typically has: invoice number, variable symbol, IBAN, and amount
- Sometimes first or last page does include information about the total amount and/or currency. Otherwise data are represented as individual items in a table.

## CRITICAL IBAN EXTRACTION RULES:
- Slovak IBANs (SK) must be EXACTLY 24 characters when spaces removed
- Czech IBANs (CZ) must be EXACTLY 24 characters when spaces removed
- When you see an IBAN like "SK20 0200 0000 0014 7073 7255" in OCR text:
  1. Remove ALL spaces to get: SK2002000000001470737255
  2. Count characters - must be exactly 24
  3. DO NOT add or remove any characters
- Copy the IBAN EXACTLY as shown in OCR text (just remove spaces)
- If an IBAN appears multiple times for different invoices, use the SAME IBAN for all of them

## Invoice Number vs Variable Symbol:
- These are TWO SEPARATE fields that may have different values
- Invoice number is the document/invoice identifier (e.g., "20230049", "FV2311102553")
- Variable symbol is used for payment matching (e.g., "202300491", "2311102553")
- They often appear in adjacent columns - look at column headers to identify each
- If OCR shows two similar numbers next to each other, they are likely invoice number AND variable symbol
- Do NOT copy the same value to both fields unless they are truly identical in the document

Return ONLY valid JSON matching the schema.`;

        // Build content: text instruction + all images
        const content = this.buildImageContent(context, ocrText);

        const result = await provider.extract({
            images: content,
            instructions,
            docType: context.docType,
            schema: strictSchema,
            enforceSchema,
            options: { useTileTimeout: false }
        });

        return result;
    }

    /**
     * Validate items and separate into valid/invalid with detailed error info.
     */
    validateItems(items) {
        const validItems = [];
        const invalidItems = [];

        for (const item of items) {
            if (!item.iban) {
                invalidItems.push({ ...item, _validationError: 'Missing IBAN', _validationIssue: 'missing' });
                continue;
            }

            const validation = validateIBANDetailed(item.iban);

            if (validation.valid) {
                validItems.push(item);
            } else {
                // Build descriptive error message
                let errorMsg = 'Invalid IBAN';
                if (validation.issue === 'too_short') {
                    const missing = validation.expectedLength - validation.actualLength;
                    errorMsg = `IBAN too short: ${validation.actualLength} chars, needs ${validation.expectedLength} (missing ${missing})`;
                } else if (validation.issue === 'too_long') {
                    const extra = validation.actualLength - validation.expectedLength;
                    errorMsg = `IBAN too long: ${validation.actualLength} chars, needs ${validation.expectedLength} (${extra} extra)`;
                } else if (validation.issue === 'checksum_failed') {
                    errorMsg = 'IBAN checksum failed - digit(s) may be wrong';
                }

                invalidItems.push({
                    ...item,
                    _validationError: errorMsg,
                    _validationIssue: validation.issue,
                    _validationDetails: validation
                });
            }
        }

        return { validItems, invalidItems };
    }

    /**
     * Step 3: Re-verify invalid IBANs with context about valid ones.
     */
    async performVerificationPass(context, provider, strictSchema, enforceSchema, validItems, invalidItems) {
        const schemaStr = JSON.stringify(context.schema, null, 2);

        // Build context about valid IBANs
        const validIbanList = validItems.map(item =>
            `  - Invoice: ${item.invoiceNumber || '?'}, IBAN: ${item.iban}, Amount: ${item.amount || '?'}`
        ).join('\n');

        // Build list of invalid IBANs to review with detailed error info
        const invalidIbanList = invalidItems.map(item => {
            const details = item._validationDetails || {};
            let hint = '';
            let formattedIban = item.iban || '';

            if (item._validationIssue === 'too_short') {
                const missing = details.expectedLength - details.actualLength;
                hint = ` → MISSING ${missing} DIGIT(S) - look for merged zeros (00→0) or missing repeated digits`;
            } else if (item._validationIssue === 'too_long') {
                const extra = details.actualLength - details.expectedLength;
                // Format IBAN with spaces to help identify duplicates
                formattedIban = this.formatIBANWithSpaces(item.iban);
                hint = ` → HAS ${extra} EXTRA DIGIT(S) - look for duplicated zeros or digits in the middle`;
            } else if (item._validationIssue === 'checksum_failed') {
                hint = ' → CHECKSUM WRONG - a digit may be misread (0↔O, 1↔I, 5↔S, 6↔8)';
            }

            return `  - Invoice: ${item.invoiceNumber || '?'}
    Current: ${formattedIban} (${details.actualLength || '?'} chars)
    Amount: ${item.amount || '?'}
    Issue: ${item._validationError}${hint}`;
        }).join('\n');

        const instructions = `You are an expert financial document parser performing a VERIFICATION pass.

## Context:
This is a result of OCR + JSON parsing from a previous step. We have validated all IBANs using the MOD-97 checksum algorithm.

## Valid IBANs (${validItems.length} items) - These passed validation:
${validIbanList || '(none)'}

## Invalid IBANs (${invalidItems.length} items) - These FAILED validation and need review:
${invalidIbanList}

## CRITICAL IBAN RULES:
- Slovak IBANs (SK) must be EXACTLY 24 characters: SK + 2 check digits + 20 account digits
- Czech IBANs (CZ) must be EXACTLY 24 characters: CZ + 2 check digits + 20 account digits
- The checksum (positions 3-4) validates the entire IBAN - changing ANY digit invalidates it

## FIXING "TOO LONG" IBANs (25+ chars):
The extra digit is usually in the MIDDLE of the IBAN, not at the end!
- Common OCR error: "00" being read as "000" (extra zero)
- Look at the original document and count each digit group
- Example: SK2002 0000 0001 4707 3725 5 → should be SK2002 0000 0014 7073 7255
  (The extra "0" before "14" caused the shift)

## FIXING "TOO SHORT" IBANs (23- chars):
A digit was lost, usually a repeated "0":
- "000" might have been read as "00"
- Look for where consecutive zeros appear in similar valid IBANs

## FIXING CHECKSUM ERRORS:
One digit is wrong. Common OCR misreads: 0↔O, 1↔I↔7, 5↔S↔3, 6↔8, B↔8

## Instructions:
1. For each invalid IBAN, look at the ORIGINAL document image
2. Compare character-by-character with the OCR result
3. Find and fix the specific error (don't just remove the last digit!)
4. Verify your corrected IBAN has exactly 24 characters
5. Only return items where you're confident in the correction

## Output Requirements:
- Return JSON matching this schema: ${schemaStr}
- Do NOT include items that are duplicates of valid entries
- Do NOT include items where you cannot determine a valid IBAN

Return ONLY valid JSON matching the schema.`;

        // Build content with images
        const content = this.buildImageContent(context, null);

        try {
            const result = await provider.extract({
                images: content,
                instructions,
                docType: context.docType,
                schema: strictSchema,
                enforceSchema,
                options: { useTileTimeout: true }
            });

            const correctedItems = result.data?.drawdowns || result.data?.items || [];

            // Validate the corrected items
            const verified = [];
            for (const item of correctedItems) {
                if (item.iban && validateIBAN(item.iban)) {
                    console.log(`[${this.name}] ✓ Corrected: Invoice ${item.invoiceNumber} → valid IBAN`);
                    verified.push(item);
                } else {
                    console.log(`[${this.name}] ✗ Still invalid: Invoice ${item.invoiceNumber}`);
                }
            }

            return verified;

        } catch (err) {
            console.error(`[${this.name}] Verification pass failed:`, err.message);
            context.addWarning(this.name, `Verification pass failed: ${err.message}`);
            return [];
        }
    }

    /**
     * Merge results: valid items + corrected items, excluding duplicates.
     */
    mergeResults(validItems, correctedItems, originalInvalidItems) {
        const finalItems = [...validItems];

        // Build set of valid invoice numbers for duplicate detection
        const validInvoiceNumbers = new Set(
            validItems.map(i => this.normalizeInvoiceNumber(i.invoiceNumber))
        );

        // Add corrected items that aren't duplicates
        for (const item of correctedItems) {
            const invoiceKey = this.normalizeInvoiceNumber(item.invoiceNumber);

            // Check if this is a duplicate of an existing valid item
            if (validInvoiceNumbers.has(invoiceKey)) {
                console.log(`[${this.name}] Skipping duplicate: Invoice ${item.invoiceNumber}`);
                continue;
            }

            finalItems.push(item);
            validInvoiceNumbers.add(invoiceKey);
        }

        // Log items that couldn't be corrected
        const correctedInvoices = new Set(
            correctedItems.map(i => this.normalizeInvoiceNumber(i.invoiceNumber))
        );

        for (const item of originalInvalidItems) {
            const invoiceKey = this.normalizeInvoiceNumber(item.invoiceNumber);
            if (!validInvoiceNumbers.has(invoiceKey) && !correctedInvoices.has(invoiceKey)) {
                console.log(`[${this.name}] ⚠ Could not correct: Invoice ${item.invoiceNumber}, IBAN: ${item.iban}`);
            }
        }

        return finalItems;
    }

    /**
     * Normalize invoice number for comparison.
     */
    normalizeInvoiceNumber(invoiceNumber) {
        if (!invoiceNumber) return '';
        return String(invoiceNumber).trim().toLowerCase().replace(/\s+/g, '');
    }

    /**
     * Format IBAN with spaces for easier visual inspection.
     * Groups digits to help identify duplicates.
     */
    formatIBANWithSpaces(iban) {
        if (!iban) return '';
        const clean = iban.replace(/\s/g, '').toUpperCase();
        // Format as: SK20 0200 0000 0014 7073 7255
        return clean.replace(/(.{4})/g, '$1 ').trim();
    }

    /**
     * Correct invalid IBANs by finding matching valid IBANs from OCR text.
     * Uses Levenshtein distance to find the closest matching valid IBAN.
     */
    correctIBANsFromOCR(invalidItems, ocrText) {
        const corrected = [];
        const stillInvalid = [];

        if (!ocrText) {
            return { corrected: [], stillInvalid: invalidItems };
        }

        // Extract all potential IBANs from OCR text (SK/CZ format: 2 letters + 22 digits)
        const ibanPattern = /\b([A-Z]{2}\s*\d{2}[\s\d]{18,26})\b/gi;
        const ocrIbans = [];
        let match;

        while ((match = ibanPattern.exec(ocrText)) !== null) {
            const normalized = match[1].replace(/\s/g, '').toUpperCase();
            // Only consider IBANs that pass validation
            if (validateIBAN(normalized)) {
                ocrIbans.push(normalized);
            }
        }

        console.log(`[${this.name}] Found ${ocrIbans.length} valid IBANs in OCR text`);

        // For each invalid item, try to find a matching valid IBAN from OCR
        for (const item of invalidItems) {
            const invalidIban = (item.iban || '').replace(/\s/g, '').toUpperCase();

            if (!invalidIban) {
                stillInvalid.push(item);
                continue;
            }

            // Find the closest matching valid IBAN from OCR text
            const bestMatch = this.findBestIBANMatch(invalidIban, ocrIbans);

            if (bestMatch) {
                console.log(`[${this.name}] ✓ OCR fix: ${item.invoiceNumber || '?'}: ${invalidIban} → ${bestMatch.iban} (dist: ${bestMatch.distance})`);
                corrected.push({
                    ...item,
                    iban: bestMatch.iban,
                    _ocrCorrected: true
                });
            } else {
                stillInvalid.push(item);
            }
        }

        return { corrected, stillInvalid };
    }

    /**
     * Find the best matching valid IBAN from a list of OCR-extracted IBANs.
     * Uses edit distance to find closest match within threshold.
     */
    findBestIBANMatch(invalidIban, validIbans) {
        if (!invalidIban || validIbans.length === 0) return null;

        // Maximum edit distance to consider a match (allow for 1-2 char differences)
        const maxDistance = 3;
        let bestMatch = null;
        let bestDistance = Infinity;

        for (const validIban of validIbans) {
            // Quick filter: country code must match
            if (invalidIban.slice(0, 2) !== validIban.slice(0, 2)) continue;

            const distance = this.levenshteinDistance(invalidIban, validIban);

            if (distance < bestDistance && distance <= maxDistance) {
                bestDistance = distance;
                bestMatch = validIban;
            }
        }

        return bestMatch ? { iban: bestMatch, distance: bestDistance } : null;
    }

    /**
     * Calculate Levenshtein edit distance between two strings.
     */
    levenshteinDistance(a, b) {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;

        const matrix = [];

        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1,     // insertion
                        matrix[i - 1][j] + 1      // deletion
                    );
                }
            }
        }

        return matrix[b.length][a.length];
    }

    /**
     * Build image content array for API call.
     */
    buildImageContent(context, ocrTextPrefix) {
        const content = [];

        if (ocrTextPrefix) {
            content.push({
                type: "text",
                text: `Document OCR Text:\n${ocrTextPrefix}\n\nSee the attached image(s) for visual reference:`
            });
        }

        for (let i = 0; i < context.images.length; i++) {
            const imageBuffer = context.images[i];
            content.push({
                type: "image_url",
                image_url: {
                    url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`,
                    detail: "high"
                }
            });
        }

        return content;
    }
}
