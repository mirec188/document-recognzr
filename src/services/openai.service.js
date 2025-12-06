import OpenAI from "openai";
import { ProxyAgent } from "undici";
import { enforceStrictSchema } from "./schema.service";
import { pdfToJpegs } from "./pdf.service";
import { tileImage, shouldTile, aggregateResults, validateIBAN } from "./tiling.service";

const OPENAI_TIMEOUT = Number(process.env.OPENAI_TIMEOUT_MS) || 300000;
const TILE_TIMEOUT = Number(process.env.TILE_TIMEOUT_MS) || 120000;
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

const longFetch = (url, init = {}) => {
    const signal = AbortSignal.timeout(OPENAI_TIMEOUT);
    return fetch(url, { ...init, signal, cache: 'no-store', dispatcher });
};

const tileFetch = (url, init = {}) => {
    const signal = AbortSignal.timeout(TILE_TIMEOUT);
    return fetch(url, { ...init, signal, cache: 'no-store', dispatcher });
};

// Azure OpenAI configuration
const AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY;
const AZURE_OPENAI_RESOURCE = process.env.AZURE_OPENAI_RESOURCE_NAME;
const AZURE_OPENAI_API_VERSION = process.env.AZURE_OPENAI_API_VERSION;
const AZURE_OPENAI_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT;

// Default tiling configuration (optimized for 2048px wide images)
const DEFAULT_TILING = {
    enableTiling: true,
    headerHeight: 500,
    sliceHeight: 500,
    overlap: 100,
    parallelMode: true,
    maxConcurrency: 5,
    retryAttempts: 2
};

// OpenAI model to use
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.1";

/**
 * Normalizes tiling options with defaults.
 * Auto-enables tiling for 'drawdown' type unless explicitly disabled.
 */
function normalizeTilingOptions(options, docType) {
    const config = { ...DEFAULT_TILING, ...options };

    // Auto-enable for drawdown if not explicitly disabled
    if (docType === 'drawdown' && options.enableTiling !== false) {
        config.enableTiling = true;
    }

    return config;
}

/**
 * Builds the system message (instructions) from prompt and schema.
 */
function buildInstructions(customPrompt, docType, schema, enforceJsonSchema) {
    const defaultPrompt = `You are an expert document parser. You are extracting data about list of drawdowns (invoice number, variable symbol, amount and iban (bank account) to where money will be sent). Focus, do not make mistakes. This is a scan. IBANS have to be valid. Be careful with errors like 8-6, 5-3 similar numbers etc. Extract information from this ${docType}.`;

    if (customPrompt) {
        if (customPrompt.includes("{{schema}}")) {
            return customPrompt.replace("{{schema}}", JSON.stringify(schema));
        } else {
            if (enforceJsonSchema) {
                return customPrompt;
            } else {
                return `${customPrompt} Return the output as a valid JSON object adhering to this schema: ${JSON.stringify(schema)}`;
            }
        }
    } else {
        if (enforceJsonSchema) {
            return defaultPrompt;
        } else {
            return `${defaultPrompt} Return the output as a valid JSON object adhering to this schema: ${JSON.stringify(schema)}`;
        }
    }
}

/**
 * Converts Chat Completions format content to Responses API format.
 * Chat Completions: { type: "image_url", image_url: { url: "..." } }
 * Responses API: { type: "input_image", image_url: "..." }
 */
function convertToResponsesFormat(userContent) {
    return userContent.map(item => {
        if (item.type === "image_url") {
            return {
                type: "input_image",
                image_url: item.image_url.url,
                detail: item.image_url.detail || "high"
            };
        } else if (item.type === "text") {
            return {
                type: "input_text",
                text: item.text
            };
        }
        return item;
    });
}

/**
 * Makes a single OpenAI Responses API call.
 */
async function makeOpenAIResponsesCall(userContent, instructions, docType, strictSchema, enforceJsonSchema, provider, useTileTimeout = false) {
    // For Azure, fall back to Chat Completions API (Responses API may not be available)
    if (provider === "azure-openai") {
        return makeAzureChatCompletionsCall(userContent, instructions, docType, strictSchema, enforceJsonSchema, useTileTimeout);
    }

    // Convert content to Responses API format
    const inputContent = convertToResponsesFormat(userContent);

    // Build request body for Responses API
    console.log(instructions);
    const requestBody = {
        model: OPENAI_MODEL,
        instructions: instructions,
        input: [
            {
                role: "user",
                content: inputContent
            }
        ],
        // Structured output via text.format
        ...(enforceJsonSchema && {
            text: {
                format: {
                    type: "json_schema",
                    name: docType,
                    strict: true,
                    schema: strictSchema
                }
            }
        }),
        // Don't store for privacy
        store: false
    };

    const mask = (k) => (k ? `${k.slice(0, 6)}...${k.slice(-2)}` : undefined);
    const imageCount = inputContent.filter(c => c.type === 'input_image').length;

    console.log("--- OpenAI Responses API Request ---");
    console.log(JSON.stringify({
        url: "https://api.openai.com/v1/responses",
        model: OPENAI_MODEL,
        imageCount,
        hasStructuredOutput: !!enforceJsonSchema
    }, null, 2));
    console.log("------------------------------------");

    const fetchFn = useTileTimeout ? tileFetch : longFetch;

    const fetchResp = await fetchFn("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify(requestBody)
    });

    if (!fetchResp.ok) {
        const errText = await fetchResp.text().catch(() => "");
        throw new Error(`OpenAI Responses API HTTP ${fetchResp.status}: ${errText}`);
    }

    const response = await fetchResp.json();

    // Parse response from Responses API format
    // Response structure: { output: [{ type: "message", content: [{ type: "output_text", text: "..." }] }] }
    let content = "";
    if (response.output && Array.isArray(response.output)) {
        for (const outputItem of response.output) {
            if (outputItem.type === "message" && outputItem.content) {
                for (const contentItem of outputItem.content) {
                    if (contentItem.type === "output_text") {
                        content += contentItem.text;
                    }
                }
            }
        }
    }

    console.log("--- OpenAI Responses API Response ---");
    console.log("Status:", response.status);
    console.log("Response ID:", response.id);
    console.log("Content length:", content.length);
    if (response.usage) {
        console.log("Tokens - Input:", response.usage.input_tokens, "Output:", response.usage.output_tokens);
        if (response.usage.input_tokens_details?.cached_tokens) {
            console.log("Cached tokens:", response.usage.input_tokens_details.cached_tokens);
        }
    }
    console.log("-------------------------------------");

    try {
        const parsed = JSON.parse(content);
        // Return both parsed result and response ID for potential re-verification
        return { data: parsed, responseId: response.id };
    } catch (e) {
        console.error("Failed to parse OpenAI response:", content.substring(0, 500));
        throw new Error("Failed to parse document from OpenAI");
    }
}

/**
 * Makes a Chat Completions API call (used for Azure OpenAI).
 */
async function makeAzureChatCompletionsCall(userContent, systemMessage, docType, strictSchema, enforceJsonSchema, useTileTimeout = false) {
    const deployment = AZURE_OPENAI_DEPLOYMENT;
    if (!AZURE_OPENAI_RESOURCE || !AZURE_OPENAI_API_KEY || !deployment) {
        throw new Error("Azure OpenAI environment is not fully configured");
    }

    const baseUrl = `https://${AZURE_OPENAI_RESOURCE}.openai.azure.com/openai/deployments/${deployment}`;

    const requestBody = {
        model: deployment,
        messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: userContent },
        ],
        ...(enforceJsonSchema && {
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: docType,
                    strict: true,
                    schema: strictSchema,
                },
            },
        }),
    };

    const mask = (k) => (k ? `${k.slice(0, 6)}...${k.slice(-2)}` : undefined);
    const urlToCall = `${baseUrl}/chat/completions?api-version=${AZURE_OPENAI_API_VERSION || "2025-02-01-preview"}`;

    console.log("--- Azure OpenAI Request ---");
    console.log(JSON.stringify({
        url: urlToCall,
        headers: { "api-key": mask(AZURE_OPENAI_API_KEY) },
        imageCount: userContent.filter(c => c.type === 'image_url').length
    }, null, 2));
    console.log("----------------------------");

    const fetchFn = useTileTimeout ? tileFetch : longFetch;
    const fetchResp = await fetchFn(urlToCall, {
        method: "POST",
        headers: { "content-type": "application/json", "api-key": AZURE_OPENAI_API_KEY },
        body: JSON.stringify(requestBody)
    });

    if (!fetchResp.ok) {
        const errText = await fetchResp.text().catch(() => "");
        throw new Error(`Azure HTTP ${fetchResp.status}: ${errText}`);
    }

    const response = await fetchResp.json();
    const content = response?.choices?.[0]?.message?.content || "";

    console.log("--- Azure OpenAI Response ---");
    console.log("Content length:", content.length);
    console.log("-----------------------------");

    try {
        const parsed = JSON.parse(content);
        // Return consistent format (Azure doesn't support re-verification)
        return { data: parsed, responseId: null };
    } catch (e) {
        console.error("Failed to parse Azure response:", content.substring(0, 500));
        throw new Error("Failed to parse document from Azure OpenAI");
    }
}

/**
 * Re-verifies invalid IBANs by re-sending the tile images with a focused prompt.
 * Groups invalid items by their source tile and processes each tile once.
 *
 * @param {Array} invalidItems - Array of items with invalid IBANs (must have _tileIndex)
 * @param {Array} tileContents - Array of tile content objects with images
 * @param {string} instructions - Base instructions
 * @param {string} docType - Document type
 * @param {Object} strictSchema - JSON schema for response
 * @param {boolean} enforceJsonSchema - Use structured output
 * @param {string} provider - API provider
 * @returns {Promise<Array>} Array of corrected items
 */
async function reVerifyInvalidIBANs(invalidItems, tileContents, instructions, docType, strictSchema, enforceJsonSchema, provider) {
    if (!invalidItems || invalidItems.length === 0) {
        return [];
    }

    // Group invalid items by tile index
    const itemsByTile = new Map();
    const itemsWithoutTile = [];

    for (const item of invalidItems) {
        const tileIdx = item._tileIndex;
        if (tileIdx === undefined) {
            // Items without tile tracking - will process with all tiles
            itemsWithoutTile.push(item);
        } else {
            if (!itemsByTile.has(tileIdx)) {
                itemsByTile.set(tileIdx, []);
            }
            itemsByTile.get(tileIdx).push(item);
        }
    }

    // If we have items without tile tracking, assign them to tile 0 (or process all tiles)
    if (itemsWithoutTile.length > 0) {
        console.log(`[Re-verify] ${itemsWithoutTile.length} items without tile tracking - will process with first tile`);
        if (!itemsByTile.has(0)) {
            itemsByTile.set(0, []);
        }
        itemsByTile.get(0).push(...itemsWithoutTile);
    }

    console.log(`[Re-verify] Re-processing ${itemsByTile.size} tiles containing ${invalidItems.length} invalid IBANs`);

    const allCorrected = [];

    // Process each tile with invalid IBANs
    for (const [tileIdx, items] of itemsByTile) {
        const tile = tileContents[tileIdx];
        if (!tile) {
            console.error(`[Re-verify] Tile ${tileIdx} not found in tileContents`);
            continue;
        }

        // Build focused prompt with specific IBANs to re-check
        const ibanList = items.map(item =>
            `Invoice: ${item.invoiceNumber || '?'}, Current IBAN: ${item.iban}`
        ).join('\n');

        const reVerifyPrompt = `IMPORTANT: Re-examine this document section VERY carefully.

The following IBANs failed checksum validation and are INCORRECT:
${ibanList}

Look at each digit individually. Slovak IBANs are 24 characters: SK + 2 check digits + 20 digits.

Extract ONLY the rows listed above with CORRECTED IBANs. Focus on accuracy over speed.`;

        // Build user content: focused prompt + tile images
        const userContent = [
            { type: "text", text: reVerifyPrompt },
            ...tile.images
        ];

        try {
            console.log(`[Re-verify] Processing tile ${tileIdx + 1} with ${items.length} invalid IBANs:`);
            for (const item of items) {
                console.log(`[Re-verify]   - Invoice: ${item.invoiceNumber}, IBAN: ${item.iban}`);
            }
            const { data } = await makeOpenAIResponsesCall(
                userContent,
                instructions,
                docType,
                strictSchema,
                enforceJsonSchema,
                provider,
                true // use tile timeout
            );

            // Extract corrected items
            const correctedFromTile = data.drawdowns || [];

            // Build set of requested invoice numbers for filtering
            const requestedInvoices = new Set(
                items.map(i => String(i.invoiceNumber || '').trim().toLowerCase())
            );

            // Log and filter corrections - only accept corrections for invoices we asked about
            let correctionCount = 0;
            for (const corrected of correctedFromTile) {
                const invoiceKey = String(corrected.invoiceNumber || '').trim().toLowerCase();
                const wasRequested = requestedInvoices.has(invoiceKey);

                if (!wasRequested) {
                    console.log(`[Re-verify] ⚠ Tile ${tileIdx + 1}: ${corrected.invoiceNumber} - not in request, ignoring`);
                    continue;
                }

                if (validateIBAN(corrected.iban)) {
                    correctionCount++;
                    console.log(`[Re-verify] ✓ Tile ${tileIdx + 1}: ${corrected.invoiceNumber} -> ${corrected.iban} (valid)`);
                    allCorrected.push(corrected);
                } else {
                    console.log(`[Re-verify] ✗ Tile ${tileIdx + 1}: ${corrected.invoiceNumber} -> ${corrected.iban} (still invalid)`);
                }
            }

            console.log(`[Re-verify] Tile ${tileIdx + 1}: ${correctionCount}/${items.length} IBANs corrected`);

        } catch (error) {
            console.error(`[Re-verify] Tile ${tileIdx + 1} failed:`, error.message);
        }
    }

    const totalCorrected = allCorrected.filter(item => validateIBAN(item.iban)).length;
    console.log(`[Re-verify] Total: ${totalCorrected}/${invalidItems.length} IBANs successfully corrected`);

    return allCorrected;
}

/**
 * Applies corrections from re-verification to the original result.
 */
function applyCorrectedIBANs(originalResult, correctedItems, docType) {
    if (!correctedItems || correctedItems.length === 0) {
        return originalResult;
    }

    // For drawdown type, update items in the drawdowns array
    if (docType === 'drawdown' && originalResult.drawdowns) {
        const correctionMap = new Map();
        for (const item of correctedItems) {
            // Key by invoice number
            const key = String(item.invoiceNumber || '').trim().toLowerCase();
            if (key && validateIBAN(item.iban)) {
                correctionMap.set(key, item.iban);
            }
        }

        // Apply corrections
        for (const row of originalResult.drawdowns) {
            const key = String(row.invoiceNumber || '').trim().toLowerCase();
            if (correctionMap.has(key)) {
                const oldIban = row.iban;
                row.iban = correctionMap.get(key);
                console.log(`[Re-verify] Applied correction: ${row.invoiceNumber}: ${oldIban} -> ${row.iban}`);
            }
        }
    }

    return originalResult;
}

/**
 * Builds user content with tiling applied.
 * Returns array of tile contents, where each tile is an array of image content objects.
 */
async function buildUserContentWithTiling(jpegBuffers, tilingConfig, docType) {
    const allTileContents = [];

    for (let pageIdx = 0; pageIdx < jpegBuffers.length; pageIdx++) {
        const jpegBuffer = jpegBuffers[pageIdx];

        // Check if this page should be tiled
        const needsTiling = tilingConfig.enableTiling && await shouldTile(jpegBuffer, tilingConfig.sliceHeight);

        if (!needsTiling) {
            // No tiling - use original image
            allTileContents.push({
                pageIndex: pageIdx,
                sliceIndex: 0,
                images: [{
                    type: "image_url",
                    image_url: {
                        url: `data:image/jpeg;base64,${jpegBuffer.toString("base64")}`,
                        detail: "high"
                    }
                }]
            });
        } else {
            // Apply tiling
            const { header, slices, metadata } = await tileImage(jpegBuffer, {
                headerHeight: tilingConfig.headerHeight,
                sliceHeight: tilingConfig.sliceHeight,
                overlap: tilingConfig.overlap,
                pageIndex: pageIdx  // For debug file naming
            });

            console.log(`[Tiling] Page ${pageIdx + 1}: ${metadata.sliceCount} slices created (${metadata.width}x${metadata.height}px)`);

            const headerBase64 = header ? header.toString("base64") : null;

            // Build content for each slice (header + slice)
            for (let sliceIdx = 0; sliceIdx < slices.length; sliceIdx++) {
                const slice = slices[sliceIdx];
                const sliceBase64 = slice.toString("base64");

                const images = [];

                // Include header if available
                if (headerBase64) {
                    images.push({
                        type: "image_url",
                        image_url: { url: `data:image/jpeg;base64,${headerBase64}`, detail: "high" }
                    });
                }

                // Add the slice
                images.push({
                    type: "image_url",
                    image_url: { url: `data:image/jpeg;base64,${sliceBase64}`, detail: "high" }
                });

                allTileContents.push({
                    pageIndex: pageIdx,
                    sliceIndex: sliceIdx,
                    images
                });
            }
        }
    }

    return allTileContents;
}

/**
 * Process tiles in single-call mode (all images in one API request).
 * Returns { results: [data], responseIds: [id] }
 */
async function processSingleCallMode(tileContents, instructions, docType, strictSchema, enforceJsonSchema, provider) {
    // Flatten all images into single userContent array
    const flatImages = [];

    // Add context message about multiple images
    if (tileContents.length > 1) {
        flatImages.push({
            type: "text",
            text: "These images are sequential sections of the same document. The first image of each pair shows the table header for context. Extract and merge all data from all sections, maintaining order. Ignore rows that appear cut off at image boundaries. Remove duplicate rows that may appear due to image overlap."
        });
    }

    for (const tile of tileContents) {
        flatImages.push(...tile.images);
    }

    const { data, responseId } = await makeOpenAIResponsesCall(flatImages, instructions, docType, strictSchema, enforceJsonSchema, provider, false);
    return { results: [data], responseIds: responseId ? [responseId] : [] };
}

/**
 * Process tiles in parallel mode (separate API call per tile).
 * Returns { results: [data], responseIds: [id] }
 */
async function processParallelMode(tileContents, instructions, docType, strictSchema, enforceJsonSchema, provider, config) {
    const { maxConcurrency, retryAttempts } = config;
    const results = [];

    // Process in batches to respect rate limits
    for (let i = 0; i < tileContents.length; i += maxConcurrency) {
        const batch = tileContents.slice(i, i + maxConcurrency);

        const batchPromises = batch.map(async (tile, batchIndex) => {
            const globalIndex = i + batchIndex;

            // Build user content for this tile
            const userContent = [];

            // Add context message
            userContent.push({
                type: "text",
                text: tile.images.length > 1
                    ? "The first image is the table header for context. Extract all complete visible rows from the second image. Ignore rows that are cut off at the edges."
                    : "Extract all data from this document section."
            });

            userContent.push(...tile.images);

            // Retry logic
            for (let attempt = 0; attempt <= retryAttempts; attempt++) {
                try {
                    console.log(`[Parallel] Processing tile ${globalIndex + 1}/${tileContents.length} (attempt ${attempt + 1})`);
                    const { data, responseId } = await makeOpenAIResponsesCall(
                        userContent,
                        instructions,
                        docType,
                        strictSchema,
                        enforceJsonSchema,
                        provider,
                        true // use tile timeout
                    );

                    // Tag each row with its source tile index for re-verification
                    if (data.drawdowns && Array.isArray(data.drawdowns)) {
                        for (const row of data.drawdowns) {
                            row._tileIndex = globalIndex;
                            row._pageIndex = tile.pageIndex;
                            row._sliceIndex = tile.sliceIndex;
                        }
                    }

                    return { index: globalIndex, pageIndex: tile.pageIndex, sliceIndex: tile.sliceIndex, data, responseId, success: true };
                } catch (error) {
                    console.error(`[Parallel] Tile ${globalIndex + 1} attempt ${attempt + 1} failed:`, error.message);
                    if (attempt === retryAttempts) {
                        return { index: globalIndex, pageIndex: tile.pageIndex, sliceIndex: tile.sliceIndex, error: error.message, success: false };
                    }
                    // Exponential backoff
                    await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
                }
            }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        // Small delay between batches to avoid rate limiting
        if (i + maxConcurrency < tileContents.length) {
            await new Promise(r => setTimeout(r, 500));
        }
    }

    // Check for failures
    const failures = results.filter(r => !r.success);
    if (failures.length > 0) {
        console.error(`[Parallel] ${failures.length} tiles failed:`, failures.map(f => `tile ${f.index + 1}: ${f.error}`));
    }

    // Sort by index and extract successful results and response IDs
    const sorted = results
        .filter(r => r.success)
        .sort((a, b) => a.index - b.index);

    return {
        results: sorted.map(r => r.data),
        responseIds: sorted.map(r => r.responseId).filter(Boolean)
    };
}

/**
 * Main analysis function with tiling support.
 * Uses OpenAI Responses API for OpenAI, Chat Completions for Azure.
 *
 * @param {Object} file - File object with type property
 * @param {Buffer} buffer - File buffer
 * @param {string} docType - Document type (e.g., 'drawdown')
 * @param {Object} schema - JSON schema for response
 * @param {string} provider - 'openai' or 'azure-openai'
 * @param {boolean} enforceJsonSchema - Use structured output
 * @param {string|null} customPrompt - Custom prompt override
 * @param {Object} tilingOptions - Tiling configuration
 * @returns {Promise<Object>} Parsed JSON response
 */
export async function analyzeWithOpenAI(file, buffer, docType, schema, provider = "openai", enforceJsonSchema = true, customPrompt = null, tilingOptions = {}) {
    // Normalize tiling configuration
    const tilingConfig = normalizeTilingOptions(tilingOptions, docType);

    const apiType = provider === "azure-openai" ? "Azure Chat Completions" : "OpenAI Responses";
    console.log(`[${apiType}] Provider: ${provider}, DocType: ${docType}, Model: ${provider === "azure-openai" ? AZURE_OPENAI_DEPLOYMENT : OPENAI_MODEL}`);
    console.log(`[${apiType}] Tiling: ${tilingConfig.enableTiling ? 'enabled' : 'disabled'}${tilingConfig.parallelMode ? ' (parallel)' : ''}`);

    // Convert PDF to JPEGs if needed, or use image directly
    let jpegBuffers;
    if (file.type === "application/pdf") {
        jpegBuffers = await pdfToJpegs(buffer, { density: 100, quality: 60 });
        console.log(`[${apiType}] PDF converted to ${jpegBuffers.length} page(s)`);
    } else {
        jpegBuffers = [buffer];
    }

    // Build tile contents
    let tileContents;
    try {
        tileContents = await buildUserContentWithTiling(jpegBuffers, tilingConfig, docType);
        console.log(`[${apiType}] Total tiles to process: ${tileContents.length}`);
    } catch (tilingError) {
        console.error(`[${apiType}] Tiling failed, falling back to non-tiled processing:`, tilingError.message);
        // Fallback to non-tiled approach
        tileContents = jpegBuffers.map((b, idx) => ({
            pageIndex: idx,
            sliceIndex: 0,
            images: [{
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${b.toString("base64")}` }
            }]
        }));
    }

    // Prepare instructions and schema
    const strictSchema = enforceStrictSchema(schema);
    const instructions = buildInstructions(customPrompt, docType, schema, enforceJsonSchema);

    let results;

    if (tileContents.length === 1) {
        // Single tile - just process it
        const userContent = [...tileContents[0].images];
        const { data } = await makeOpenAIResponsesCall(userContent, instructions, docType, strictSchema, enforceJsonSchema, provider, false);
        results = [data];
    } else if (tilingConfig.parallelMode) {
        // Parallel mode - separate calls for each tile
        const processed = await processParallelMode(
            tileContents,
            instructions,
            docType,
            strictSchema,
            enforceJsonSchema,
            provider,
            tilingConfig
        );
        results = processed.results;
    } else {
        // Single call mode - all tiles in one request
        const processed = await processSingleCallMode(
            tileContents,
            instructions,
            docType,
            strictSchema,
            enforceJsonSchema,
            provider
        );
        results = processed.results;
    }

    // Aggregate and deduplicate results if multiple
    if (results.length === 0) {
        throw new Error("No results from API processing");
    }

    let finalResult;
    if (results.length === 1) {
        finalResult = results[0];
    } else {
        console.log(`[${apiType}] Aggregating ${results.length} results`);
        finalResult = aggregateResults(results, docType, schema);
    }
    console.log(`[${apiType}] Final result contains ${finalResult.drawdowns ? finalResult.drawdowns.length : 0} drawdown(s)`);

    console.log(`[${apiType}] Starting re-verification of invalid IBANs if any`);
    // Re-verification step for drawdown documents with OpenAI provider
    if (docType === 'drawdown' && provider === 'openai' && finalResult.drawdowns) {
        console.log(`[${apiType}] Checking for invalid IBANs in drawdowns for re-verification`);
        // Find all invalid IBANs
        const invalidItems = finalResult.drawdowns.filter(item => !validateIBAN(item.iban));

        // Log which have tile tracking and which don't
        const withTileIndex = invalidItems.filter(i => i._tileIndex !== undefined).length;
        console.log(`[${apiType}] Detected ${invalidItems.length} invalid IBAN(s) for re-verification (${withTileIndex} with tile tracking)`);

        if (invalidItems.length > 0) {
            console.log(`[${apiType}] Found ${invalidItems.length} invalid IBANs, attempting re-verification...`);

            const correctedItems = await reVerifyInvalidIBANs(
                invalidItems,
                tileContents,
                instructions,
                docType,
                strictSchema,
                enforceJsonSchema,
                provider
            );

            // Apply corrections
            if (correctedItems.length > 0) {
                finalResult = applyCorrectedIBANs(finalResult, correctedItems, docType);
            }

            // Check if there are still invalid IBANs after corrections
            const stillInvalid = finalResult.drawdowns.filter(item => !validateIBAN(item.iban));
            if (stillInvalid.length > 0) {
                console.log(`[${apiType}] After re-verification, ${stillInvalid.length} IBANs still invalid:`);
                for (const item of stillInvalid) {
                    console.log(`[${apiType}]   - Invoice: ${item.invoiceNumber}, IBAN: ${item.iban}`);
                }
            } else {
                console.log(`[${apiType}] All IBANs now valid after re-verification`);
            }
        }
    }

    // Final validation before return
    if (finalResult.drawdowns) {
        const invalidCount = finalResult.drawdowns.filter(item => !validateIBAN(item.iban)).length;
        console.log(`[${apiType}] Final result: ${finalResult.drawdowns.length} drawdowns, ${invalidCount} with invalid IBANs`);
    }

    // Clean up internal tracking fields before returning
    if (finalResult.drawdowns) {
        for (const row of finalResult.drawdowns) {
            delete row._tileIndex;
            delete row._pageIndex;
            delete row._sliceIndex;
        }
    }

    return finalResult;
}
