import { Stage } from '../Stage.js';
import { getValidators } from '../validators/index.js';
import { getValidatorsForDocType, config } from '../../config/index.js';

/**
 * ValidationStage - Validates extracted data and attempts repairs.
 *
 * - Runs configured validators for the document type
 * - Attempts repairs for invalid items (e.g., IBAN re-verification)
 * - Logs validation results
 */
export class ValidationStage extends Stage {
    constructor() {
        super('ValidationStage');
    }

    async shouldRun(context) {
        // Only run if we have a result and validation is configured
        const validatorNames = getValidatorsForDocType(context.docType);
        return context.result && validatorNames.length > 0;
    }

    async process(context) {
        const validatorNames = getValidatorsForDocType(context.docType);
        const validators = getValidators(validatorNames);

        if (validators.length === 0) {
            console.log(`[${this.name}] No validators configured for ${context.docType}`);
            context.completeStage(this.name);
            return context;
        }

        console.log(`[${this.name}] Running ${validators.length} validators: ${validatorNames.join(', ')}`);

        // Get the array field for this document type
        const arrayField = this.getArrayField(context.docType);

        if (!arrayField || !context.result[arrayField]) {
            console.log(`[${this.name}] No array field '${arrayField}' to validate`);
            context.completeStage(this.name);
            return context;
        }

        const items = context.result[arrayField];
        console.log(`[${this.name}] Validating ${items.length} items`);

        // Run each validator
        for (const validator of validators) {
            await this.runValidator(validator, items, context, arrayField);
        }

        context.completeStage(this.name);
        return context;
    }

    /**
     * Run a single validator with repair attempt.
     */
    async runValidator(validator, items, context, arrayField) {
        // Find invalid items
        const invalidItems = validator.findInvalid(items);

        if (invalidItems.length === 0) {
            console.log(`[${this.name}] ${validator.name}: All ${items.length} items valid`);
            return;
        }

        console.log(`[${this.name}] ${validator.name}: ${invalidItems.length}/${items.length} items invalid`);

        // Log invalid items
        for (const item of invalidItems) {
            const fieldName = validator.getFieldName();
            console.log(`[${this.name}]   - ${item.invoiceNumber || '?'}: ${item[fieldName]}`);
        }

        // Check if repair is enabled
        const reVerifyConfig = config.validation.reVerification;
        if (!reVerifyConfig.enabled) {
            console.log(`[${this.name}] Re-verification disabled, skipping repair`);
            context.metadata.reVerificationAttempted = false;
            return;
        }

        // Attempt repair
        console.log(`[${this.name}] Attempting repair for ${invalidItems.length} items...`);
        context.metadata.reVerificationAttempted = true;

        try {
            const repairs = await validator.repair(invalidItems, context);

            if (repairs.length > 0) {
                console.log(`[${this.name}] ${validator.name}: ${repairs.length}/${invalidItems.length} items repaired`);
                validator.applyRepairs(context.result, repairs, arrayField);
            } else {
                console.log(`[${this.name}] ${validator.name}: No repairs possible`);
            }

            // Log remaining invalid items and add validation flags
            const stillInvalid = validator.findInvalid(context.result[arrayField]);
            if (stillInvalid.length > 0) {
                console.log(`[${this.name}] ${validator.name}: ${stillInvalid.length} items still invalid after repair`);
                for (const item of stillInvalid) {
                    const fieldName = validator.getFieldName();
                    console.log(`[${this.name}]   - ${item.invoiceNumber || '?'}: ${item[fieldName]}`);

                    // Add validation issue flag to the item
                    if (validator.getValidationDetails) {
                        const details = validator.getValidationDetails(item);
                        item._validationIssue = details.issue || 'invalid';
                        item._validationDetails = details.details || {};
                    } else {
                        item._validationIssue = 'invalid';
                    }
                }

                // Store count in metadata for reporting
                context.metadata.invalidItemsCount = context.metadata.invalidItemsCount || {};
                context.metadata.invalidItemsCount[validator.name] = stillInvalid.length;
            }
        } catch (err) {
            console.error(`[${this.name}] ${validator.name} repair failed:`, err.message);
            context.addWarning(this.name, `Repair failed: ${err.message}`);
        }
    }

    /**
     * Get the array field name for a document type.
     */
    getArrayField(docType) {
        const arrayFieldMap = {
            'drawdown': 'drawdowns',
            'invoice': 'invoiceRows',
            'bankStatement': 'transactions',
            'loanContract': null
        };
        return arrayFieldMap[docType];
    }
}
