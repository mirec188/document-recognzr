import { Stage } from '../Stage.js';
import { getProvider } from '../providers/index.js';
import { enforceStrictSchema } from '../../services/schema.service.js';
import { getTilingConfig } from '../../config/index.js';

/**
 * ExtractionStage - Orchestrates AI provider calls for data extraction.
 *
 * Handles:
 * - Single tile/image extraction
 * - Parallel tile processing with batching
 * - Provider selection and delegation
 */
export class ExtractionStage extends Stage {
    constructor() {
        super('ExtractionStage');
    }

    async process(context) {
        const provider = getProvider(context.getProvider());

        if (!provider.isConfigured()) {
            context.error = `Provider ${context.getProvider()} is not configured`;
            return context;
        }

        // Build instructions from prompt and schema
        const customPrompt = context.options.customPrompt;
        const enforceSchema = context.options.enforceJsonSchema !== false;
        const instructions = provider.buildInstructions(
            customPrompt,
            context.docType,
            context.schema,
            enforceSchema
        );

        // Prepare strict schema for structured output
        const strictSchema = enforceSchema ? enforceStrictSchema({ ...context.schema }) : null;

        // Decide extraction strategy based on provider type
        if (context.isOpenAIProvider()) {
            await this.extractWithOpenAI(context, provider, instructions, strictSchema, enforceSchema);
        } else {
            await this.extractWithGemini(context, provider, instructions, strictSchema, enforceSchema);
        }

        context.completeStage(this.name);
        return context;
    }

    /**
     * Extract using OpenAI-compatible provider (OpenAI or Azure).
     * Handles tiled and non-tiled scenarios.
     */
    async extractWithOpenAI(context, provider, instructions, strictSchema, enforceSchema) {
        const { tiles, docType } = context;

        if (!tiles || tiles.length === 0) {
            context.error = 'No tiles to process';
            return;
        }

        const tilingConfig = getTilingConfig(docType, context.options);

        // Single tile - simple extraction
        if (tiles.length === 1) {
            console.log(`[${this.name}] Single tile extraction`);
            const result = await this.extractTile(provider, tiles[0], instructions, docType, strictSchema, enforceSchema, false);
            context.extractions = [result];
            return;
        }

        // Multiple tiles - use parallel or sequential processing
        if (tilingConfig.parallelMode) {
            await this.extractParallel(context, provider, instructions, strictSchema, enforceSchema, tilingConfig);
        } else {
            await this.extractSequential(context, provider, instructions, strictSchema, enforceSchema);
        }
    }

    /**
     * Extract using Gemini provider.
     * Gemini processes the entire file at once (no tiling needed).
     */
    async extractWithGemini(context, provider, instructions, strictSchema, enforceSchema) {
        console.log(`[${this.name}] Gemini extraction (no tiling)`);

        try {
            const result = await provider.extract({
                file: context.file,
                mimeType: context.mimeType,
                instructions,
                docType: context.docType,
                schema: strictSchema || context.schema,
                enforceSchema
            });

            context.extractions = [result];
        } catch (err) {
            context.error = `Gemini extraction failed: ${err.message}`;
            context.errors.push({
                stage: this.name,
                message: err.message,
                stack: err.stack
            });
        }
    }

    /**
     * Extract a single tile.
     */
    async extractTile(provider, tile, instructions, docType, strictSchema, enforceSchema, useTileTimeout) {
        // Add text prompt to images
        const images = [
            { type: "text", text: "Extract data from this document section:" },
            ...tile.images
        ];

        const result = await provider.extract({
            images,
            instructions,
            docType,
            schema: strictSchema,
            enforceSchema,
            options: { useTileTimeout }
        });

        // Tag results with tile metadata for re-verification
        if (result.data && result.data.drawdowns && Array.isArray(result.data.drawdowns)) {
            for (const row of result.data.drawdowns) {
                row._tileIndex = tile.globalIndex;
                row._pageIndex = tile.pageIndex;
                row._sliceIndex = tile.sliceIndex;
            }
        }

        return {
            ...result,
            tileIndex: tile.globalIndex
        };
    }

    /**
     * Process tiles in parallel with batching.
     */
    async extractParallel(context, provider, instructions, strictSchema, enforceSchema, tilingConfig) {
        const { tiles, docType } = context;
        const maxConcurrency = tilingConfig.maxConcurrency || 5;
        const retryAttempts = tilingConfig.retryAttempts || 2;

        console.log(`[${this.name}] Parallel extraction: ${tiles.length} tiles, concurrency=${maxConcurrency}`);

        const results = [];
        const batches = this.createBatches(tiles, maxConcurrency);

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];
            console.log(`[${this.name}] Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} tiles)`);

            const batchPromises = batch.map(async (tile) => {
                let lastError;
                for (let attempt = 0; attempt <= retryAttempts; attempt++) {
                    try {
                        if (attempt > 0) {
                            // Exponential backoff
                            const delay = Math.pow(2, attempt) * 1000;
                            console.log(`[${this.name}] Retry ${attempt}/${retryAttempts} for tile ${tile.globalIndex} after ${delay}ms`);
                            await new Promise(r => setTimeout(r, delay));
                        }

                        return await this.extractTile(provider, tile, instructions, docType, strictSchema, enforceSchema, true);
                    } catch (err) {
                        lastError = err;
                        console.error(`[${this.name}] Tile ${tile.globalIndex} attempt ${attempt + 1} failed:`, err.message);
                    }
                }

                // All retries failed
                context.addWarning(this.name, `Tile ${tile.globalIndex} failed after ${retryAttempts + 1} attempts: ${lastError.message}`);
                return null;
            });

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults.filter(r => r !== null));
        }

        context.extractions = results;
        console.log(`[${this.name}] Completed ${results.length}/${tiles.length} tiles`);
    }

    /**
     * Process tiles sequentially.
     */
    async extractSequential(context, provider, instructions, strictSchema, enforceSchema) {
        const { tiles, docType } = context;
        console.log(`[${this.name}] Sequential extraction: ${tiles.length} tiles`);

        const results = [];

        for (const tile of tiles) {
            try {
                const result = await this.extractTile(provider, tile, instructions, docType, strictSchema, enforceSchema, true);
                results.push(result);
            } catch (err) {
                context.addWarning(this.name, `Tile ${tile.globalIndex} failed: ${err.message}`);
            }
        }

        context.extractions = results;
    }

    /**
     * Split array into batches.
     */
    createBatches(items, batchSize) {
        const batches = [];
        for (let i = 0; i < items.length; i += batchSize) {
            batches.push(items.slice(i, i + batchSize));
        }
        return batches;
    }
}
