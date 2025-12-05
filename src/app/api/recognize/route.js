import { NextResponse } from "next/server";
import { getSchema } from "@/services/schema.service";
import { analyzeWithOpenAI } from "@/services/openai.service";
import { analyzeWithGemini } from "@/services/gemini.service";

export const dynamic = 'force-dynamic';
export const maxDuration = 1300;
export const runtime = 'nodejs';

/**
 * Parses tiling options from request parameters.
 * Handles both JSON body and FormData string values.
 */
function parseTilingOptions(params, docType) {
    const { enableTiling, tileHeight, tileOverlap, headerHeight, parallelTiling, maxConcurrency } = params;

    // Build options object, only including defined values
    const options = {};

    // enableTiling: true/false/"true"/"false" or auto for drawdown
    if (enableTiling === true || enableTiling === "true") {
        options.enableTiling = true;
    } else if (enableTiling === false || enableTiling === "false") {
        options.enableTiling = false;
    }
    // If not specified, let the service decide (auto-enable for drawdown)

    // Numeric parameters
    if (tileHeight !== undefined && tileHeight !== null && tileHeight !== "") {
        const val = parseInt(tileHeight, 10);
        if (!isNaN(val) && val > 0) options.sliceHeight = val;
    }

    if (tileOverlap !== undefined && tileOverlap !== null && tileOverlap !== "") {
        const val = parseInt(tileOverlap, 10);
        if (!isNaN(val) && val >= 0) options.overlap = val;
    }

    if (headerHeight !== undefined && headerHeight !== null && headerHeight !== "") {
        const val = parseInt(headerHeight, 10);
        if (!isNaN(val) && val > 0) options.headerHeight = val;
    }

    if (maxConcurrency !== undefined && maxConcurrency !== null && maxConcurrency !== "") {
        const val = parseInt(maxConcurrency, 10);
        if (!isNaN(val) && val > 0) options.maxConcurrency = val;
    }

    // parallelTiling: true/false/"true"/"false"
    if (parallelTiling === true || parallelTiling === "true") {
        options.parallelMode = true;
    } else if (parallelTiling === false || parallelTiling === "false") {
        options.parallelMode = false;
    }

    return options;
}

export async function POST(req) {
    try {
        let fileBuffer, mimeType, docType, modelProvider, enforceJsonSchema, customPrompt, customSchemaInput;
        let tilingParams = {};
        const contentType = req.headers.get("content-type") || "";

        if (contentType.includes("application/json")) {
            const body = await req.json();

            if (!body.file || !body.mimeType) {
                 return NextResponse.json({ error: "Missing file (base64) or mimeType in JSON body" }, { status: 400 });
            }

            fileBuffer = Buffer.from(body.file, 'base64');
            mimeType = body.mimeType;
            docType = body.docType;
            modelProvider = body.modelProvider || "gemini";
            enforceJsonSchema = body.enforceJsonSchema !== false; // Default true if not explicitly false
            customPrompt = body.customPrompt || null;
            customSchemaInput = body.customSchema;

            // Extract tiling parameters from JSON body
            tilingParams = {
                enableTiling: body.enableTiling,
                tileHeight: body.tileHeight,
                tileOverlap: body.tileOverlap,
                headerHeight: body.headerHeight,
                parallelTiling: body.parallelTiling,
                maxConcurrency: body.maxConcurrency
            };

        } else if (contentType.includes("multipart/form-data")) {
            const formData = await req.formData();
            const file = formData.get("file");
            docType = formData.get("docType");
            modelProvider = formData.get("modelProvider") || "gemini";
            enforceJsonSchema = formData.get("enforceJsonSchema") !== "false"; // Form data is string "false"
            customPrompt = formData.get("customPrompt") || null;
            const customSchemaStr = formData.get("customSchema");

            if (file) {
                const arrayBuffer = await file.arrayBuffer();
                fileBuffer = Buffer.from(arrayBuffer);
                mimeType = file.type;
            }
            customSchemaInput = customSchemaStr;

            // Extract tiling parameters from FormData
            tilingParams = {
                enableTiling: formData.get("enableTiling"),
                tileHeight: formData.get("tileHeight"),
                tileOverlap: formData.get("tileOverlap"),
                headerHeight: formData.get("headerHeight"),
                parallelTiling: formData.get("parallelTiling"),
                maxConcurrency: formData.get("maxConcurrency")
            };
        } else {
             return NextResponse.json({ error: "Unsupported Content-Type. Use multipart/form-data or application/json" }, { status: 400 });
        }

        if (!fileBuffer || !docType) {
            return NextResponse.json({ error: "Missing file or document type" }, { status: 400 });
        }

        // Load Schema
        let schema;
        if (customSchemaInput) {
            try {
                // Handle both string (from FormData) and Object (from JSON)
                schema = typeof customSchemaInput === 'string'
                    ? JSON.parse(customSchemaInput)
                    : customSchemaInput;
            } catch (e) {
                return NextResponse.json({ error: "Invalid custom schema JSON" }, { status: 400 });
            }
        } else {
            schema = await getSchema(docType);
        }

        if (!schema) {
            return NextResponse.json({ error: "Invalid document type or schema" }, { status: 400 });
        }

        // Parse tiling options
        const tilingOptions = parseTilingOptions(tilingParams, docType);

        // Normalize file object for services
        const fileObj = { type: mimeType };

        let jsonResponse;

        if (modelProvider === "openai" || modelProvider === "azure-openai") {
            jsonResponse = await analyzeWithOpenAI(fileObj, fileBuffer, docType, schema, modelProvider, enforceJsonSchema, customPrompt, tilingOptions);
        } else {
            // Gemini doesn't support tiling in this implementation
            jsonResponse = await analyzeWithGemini(fileObj, fileBuffer, docType, schema, customPrompt);
        }

        return NextResponse.json(jsonResponse);

    } catch (error) {
        console.error("Error processing document:", error);
        const errorMessage = error.message || "Internal server error";

        if (errorMessage.includes("OCR which is not currently supported")) {
             return NextResponse.json({ error: errorMessage }, { status: 400 });
        }

        return NextResponse.json({ error: errorMessage, details: error.message }, { status: 500 });
    }
}
