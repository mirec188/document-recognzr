import { Stage } from '../Stage.js';

/**
 * CleanupStage - Removes internal metadata from results before returning.
 *
 * Internal fields like _tileIndex, _pageIndex, _sliceIndex are used for
 * tracking during processing but should not be exposed to API consumers.
 */
export class CleanupStage extends Stage {
    constructor() {
        super('CleanupStage');
    }

    /**
     * Fields to remove from result items.
     */
    static INTERNAL_FIELDS = ['_tileIndex', '_pageIndex', '_sliceIndex', '_sourceId'];

    async process(context) {
        if (!context.result) {
            context.addWarning(this.name, 'No result to clean up');
            context.completeStage(this.name);
            return context;
        }

        // Clean up based on document type structure
        this.cleanupResult(context.result, context.docType);

        context.completeStage(this.name);
        return context;
    }

    /**
     * Recursively clean up internal fields from result.
     * @param {Object} result - The result object
     * @param {string} docType - Document type for structure hints
     */
    cleanupResult(result, docType) {
        if (!result || typeof result !== 'object') {
            return;
        }

        // Map of document types to their array field names
        const arrayFieldMap = {
            'drawdown': 'drawdowns',
            'invoice': 'invoiceRows',
            'bankStatement': 'transactions',
            'loanContract': null
        };

        const arrayField = arrayFieldMap[docType];

        // Clean up array items if present
        if (arrayField && Array.isArray(result[arrayField])) {
            for (const item of result[arrayField]) {
                this.removeInternalFields(item);
            }
        }

        // Also clean up top-level fields
        this.removeInternalFields(result);
    }

    /**
     * Remove internal fields from an object.
     * @param {Object} obj
     */
    removeInternalFields(obj) {
        if (!obj || typeof obj !== 'object') {
            return;
        }

        for (const field of CleanupStage.INTERNAL_FIELDS) {
            if (field in obj) {
                delete obj[field];
            }
        }
    }
}
