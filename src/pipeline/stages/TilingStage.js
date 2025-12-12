import { Stage } from '../Stage.js';
import { tileImage, shouldTile } from '../../services/tiling.service.js';
import { getTilingConfig } from '../../config/index.js';

/**
 * TilingStage - Splits large images into overlapping tiles for better OCR.
 *
 * For dense tabular documents (many rows), tiling improves accuracy by:
 * - Keeping each tile within the model's optimal resolution
 * - Including header context with each tile
 * - Using overlap to prevent cutting rows
 */
export class TilingStage extends Stage {
    constructor() {
        super('TilingStage');
    }

    async shouldRun(context) {
        // Only run for OpenAI-compatible providers (tiling not needed for Gemini)
        return context.isOpenAIProvider();
    }

    async process(context) {
        const tilingConfig = getTilingConfig(context.docType, context.options);

        // If tiling is disabled, create simple tile structure
        if (!tilingConfig.enableTiling) {
            context.tiles = context.images.map((imageBuffer, pageIndex) => ({
                pageIndex,
                sliceIndex: 0,
                images: this.buildImageContent([imageBuffer]),
                isHeader: false,
                isTiled: false
            }));
            context.completeStage(this.name);
            return context;
        }

        console.log(`[${this.name}] Building tiles for ${context.images.length} pages...`);

        const tiles = [];
        let globalIndex = 0;

        for (let pageIndex = 0; pageIndex < context.images.length; pageIndex++) {
            const imageBuffer = context.images[pageIndex];
            const needsTiling = await shouldTile(imageBuffer, tilingConfig.sliceHeight);

            if (needsTiling) {
                // Tile this page
                const { header, slices, metadata } = await tileImage(imageBuffer, {
                    headerHeight: tilingConfig.headerHeight,
                    sliceHeight: tilingConfig.sliceHeight,
                    overlap: tilingConfig.overlap,
                    pageIndex
                });

                console.log(`[${this.name}] Page ${pageIndex + 1}: ${slices.length} slices (${metadata.width}x${metadata.height}px)`);

                // Create tile for each slice (header + slice combined)
                for (let sliceIndex = 0; sliceIndex < slices.length; sliceIndex++) {
                    const images = header
                        ? this.buildImageContent([header, slices[sliceIndex]])
                        : this.buildImageContent([slices[sliceIndex]]);

                    tiles.push({
                        pageIndex,
                        sliceIndex,
                        globalIndex: globalIndex++,
                        images,
                        isHeader: false,
                        isTiled: true,
                        rawSlice: slices[sliceIndex],  // Keep for re-verification
                        rawHeader: header
                    });
                }
            } else {
                // No tiling needed - single tile for this page
                tiles.push({
                    pageIndex,
                    sliceIndex: 0,
                    globalIndex: globalIndex++,
                    images: this.buildImageContent([imageBuffer]),
                    isHeader: false,
                    isTiled: false,
                    rawSlice: imageBuffer
                });
            }
        }

        context.tiles = tiles;
        context.metadata.tilesProcessed = tiles.length;
        console.log(`[${this.name}] Created ${tiles.length} total tiles`);

        context.completeStage(this.name);
        return context;
    }

    /**
     * Build image content array for API call.
     * @param {Buffer[]} buffers - Image buffers
     * @returns {Array} - Array of image content objects
     */
    buildImageContent(buffers) {
        return buffers.map(buffer => ({
            type: "image_url",
            image_url: {
                url: `data:image/jpeg;base64,${buffer.toString('base64')}`,
                detail: "high"
            }
        }));
    }
}
