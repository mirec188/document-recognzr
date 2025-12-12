import { Stage } from '../Stage.js';
import { aggregateResults, deduplicateRows } from '../../services/tiling.service.js';

/**
 * AggregationStage - Merges results from multiple tile extractions.
 *
 * - Concatenates array results from all tiles
 * - Deduplicates based on document-type specific keys
 * - Recalculates totals where applicable
 */
export class AggregationStage extends Stage {
    constructor() {
        super('AggregationStage');
    }

    async process(context) {
        const { extractions, docType, schema } = context;

        if (!extractions || extractions.length === 0) {
            context.addWarning(this.name, 'No extractions to aggregate');
            context.result = {};
            context.completeStage(this.name);
            return context;
        }

        if (extractions.length === 1) {
            // Single extraction - no aggregation needed
            context.result = extractions[0].data;
            console.log(`[${this.name}] Single extraction, no aggregation needed`);
            context.completeStage(this.name);
            return context;
        }

        console.log(`[${this.name}] Aggregating ${extractions.length} extractions...`);

        // Extract just the data from extractions
        const results = extractions.map(e => e.data);

        // Use existing aggregation logic
        context.result = aggregateResults(results, docType, schema);

        // Log aggregation results
        const arrayFieldMap = {
            'drawdown': 'drawdowns',
            'invoice': 'invoiceRows',
            'bankStatement': 'transactions'
        };
        const arrayField = arrayFieldMap[docType];

        if (arrayField && context.result[arrayField]) {
            const totalItems = results.reduce((sum, r) =>
                sum + (r[arrayField]?.length || 0), 0);
            const dedupedItems = context.result[arrayField].length;
            console.log(`[${this.name}] Aggregated ${totalItems} items → ${dedupedItems} after dedup`);
        }

        context.completeStage(this.name);
        return context;
    }
}
