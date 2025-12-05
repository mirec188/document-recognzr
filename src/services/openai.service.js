import OpenAI from "openai";
import { ProxyAgent } from "undici";
import { enforceStrictSchema } from "./schema.service";
import { pdfToJpegs } from "./pdf.service";
import { tileImage, shouldTile, aggregateResults } from "./tiling.service";

const OPENAI_TIMEOUT = Number(process.env.OPENAI_TIMEOUT_MS) || 300000;
const TILE_TIMEOUT = Number(process.env.TILE_TIMEOUT_MS) || 60000;
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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: OPENAI_TIMEOUT, fetch: longFetch });

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
 * Builds the system message from prompt and schema.
 */
function buildSystemMessage(customPrompt, docType, schema, enforceJsonSchema) {
    const defaultPrompt = `You are an expert document parser. You are extracting data about list of drawdowns (invoice number, variable symbol, amount and iban (bank account) to where money will be sent). Focus, do not make mistakes. This is a scan. IBANS have to be valid. Be careful with errors like 8-6, 5-3 similiar numbers etc. Extract information from this ${docType}.`;

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
 * Makes a single OpenAI/Azure API call with given user content.
 */
async function makeOpenAICall(userContent, systemMessage, docType, strictSchema, enforceJsonSchema, provider, useTileTimeout = false) {
    let response;

    if (provider === "azure-openai") {
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
        const headersToSend = { "content-type": "application/json", "api-key": mask(AZURE_OPENAI_API_KEY) };

        console.log("--- Azure OpenAI Request ---");
        console.log(JSON.stringify({ url: urlToCall, headers: headersToSend, imageCount: userContent.filter(c => c.type === 'image_url').length }, null, 2));
        if (requestBody.response_format) console.log("response_format present: json_schema");
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
        response = await fetchResp.json();

    } else {
        const requestBody = {
            model: "gpt-5-nano",
            messages: [
                { role: "system", content: [{ type: "text", text: systemMessage }] },
                { role: "user", content: Array.isArray(userContent) ? userContent : [{ type: "text", text: userContent }] },
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
        console.log("--- OpenAI Request ---");
        console.log(JSON.stringify({ url: "https://api.openai.com/v1/chat/completions", headers: { authorization: `Bearer ${mask(process.env.OPENAI_API_KEY)}` }, imageCount: userContent.filter(c => c.type === 'image_url').length }, null, 2));
        if (requestBody.response_format) console.log("response_format present: json_schema");
        console.log("----------------------");

        const timeout = useTileTimeout ? TILE_TIMEOUT : OPENAI_TIMEOUT;
        response = await openai.chat.completions.create(requestBody, { timeout });
    }

    const content = (response && response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content) || "";

    console.log("--- OpenAI Response ---");
    console.log("Parsed content length:", content.length);
    console.log("-----------------------");

    try {
        return JSON.parse(content);
    } catch (e) {
        console.error("Failed to parse OpenAI response:", content.substring(0, 500));
        throw new Error("Failed to parse document from OpenAI");
    }
}

/**
 * Builds user content with tiling applied.
 * Returns array of tile contents, where each tile is an array of image_url objects.
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
 */
async function processSingleCallMode(tileContents, systemMessage, docType, strictSchema, enforceJsonSchema, provider) {
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

    return await makeOpenAICall(flatImages, systemMessage, docType, strictSchema, enforceJsonSchema, provider, false);
}

/**
 * Process tiles in parallel mode (separate API call per tile).
 */
async function processParallelMode(tileContents, systemMessage, docType, strictSchema, enforceJsonSchema, provider, config) {
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
                    const result = await makeOpenAICall(
                        userContent,
                        systemMessage,
                        docType,
                        strictSchema,
                        enforceJsonSchema,
                        provider,
                        true // use tile timeout
                    );
                    return { index: globalIndex, pageIndex: tile.pageIndex, sliceIndex: tile.sliceIndex, result, success: true };
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

    // Sort by index and extract successful results
    const successfulResults = results
        .filter(r => r.success)
        .sort((a, b) => a.index - b.index)
        .map(r => r.result);

    return successfulResults;
}

/**
 * Main analysis function with tiling support.
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

    console.log(`[OpenAI] Provider: ${provider}, DocType: ${docType}, Tiling: ${tilingConfig.enableTiling ? 'enabled' : 'disabled'}${tilingConfig.parallelMode ? ' (parallel)' : ''}`);

    // Convert PDF to JPEGs if needed, or use image directly
    let jpegBuffers;
    if (file.type === "application/pdf") {
        jpegBuffers = await pdfToJpegs(buffer, { density: 200, quality: 85 });
        console.log(`[OpenAI] PDF converted to ${jpegBuffers.length} page(s)`);
    } else {
        jpegBuffers = [buffer];
    }

    // Build tile contents
    let tileContents;
    try {
        tileContents = await buildUserContentWithTiling(jpegBuffers, tilingConfig, docType);
        console.log(`[OpenAI] Total tiles to process: ${tileContents.length}`);
    } catch (tilingError) {
        console.error("[OpenAI] Tiling failed, falling back to non-tiled processing:", tilingError.message);
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

    // Prepare system message and schema
    const strictSchema = enforceStrictSchema(schema);
    const systemMessage = buildSystemMessage(customPrompt, docType, schema, enforceJsonSchema);

    let results;

    if (tileContents.length === 1) {
        // Single tile - just process it
        const userContent = [...tileContents[0].images];
        const result = await makeOpenAICall(userContent, systemMessage, docType, strictSchema, enforceJsonSchema, provider, false);
        results = [result];
    } else if (tilingConfig.parallelMode) {
        // Parallel mode - separate calls for each tile
        results = await processParallelMode(
            tileContents,
            systemMessage,
            docType,
            strictSchema,
            enforceJsonSchema,
            provider,
            tilingConfig
        );
    } else {
        // Single call mode - all tiles in one request
        const result = await processSingleCallMode(
            tileContents,
            systemMessage,
            docType,
            strictSchema,
            enforceJsonSchema,
            provider
        );
        results = [result];
    }

    // Aggregate and deduplicate results if multiple
    if (results.length === 0) {
        throw new Error("No results from API processing");
    }

    if (results.length === 1) {
        return results[0];
    }

    console.log(`[OpenAI] Aggregating ${results.length} results`);
    return aggregateResults(results, docType, schema);
}
