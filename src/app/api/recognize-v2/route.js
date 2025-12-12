import { NextResponse } from "next/server";
import { getSchema } from "@/services/schema.service";
import { Pipeline } from "@/pipeline/Pipeline.js";
import { ProcessingContext } from "@/pipeline/Context.js";
import {
    PreprocessingStage,
    AzureOCRStage,
    TilingStage,
    ExtractionStage,
    AggregationStage,
    ValidationStage,
    CleanupStage,
    OCREnhancedExtractionStage,
    OCROnlyExtractionStage,
    OCRVerifiedExtractionStage
} from "@/pipeline/stages/index.js";

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export const runtime = 'nodejs';

/**
 * Parse request and build processing context.
 */
async function parseRequest(req) {
    const contentType = req.headers.get("content-type") || "";
    let file, mimeType, docType, options = {};

    if (contentType.includes("application/json")) {
        const body = await req.json();

        if (!body.file || !body.mimeType) {
            throw new Error("Missing file (base64) or mimeType in JSON body");
        }

        file = Buffer.from(body.file, 'base64');
        mimeType = body.mimeType;
        docType = body.docType;

        options = {
            modelProvider: body.modelProvider || "gemini",
            enforceJsonSchema: body.enforceJsonSchema !== false,
            customPrompt: body.customPrompt || null,
            // Tiling options
            enableTiling: parseBoolean(body.enableTiling),
            sliceHeight: parseNumber(body.tileHeight),
            overlap: parseNumber(body.tileOverlap),
            headerHeight: parseNumber(body.headerHeight),
            parallelMode: parseBoolean(body.parallelTiling),
            maxConcurrency: parseNumber(body.maxConcurrency),
            // OCR options
            useAzureOCR: parseBoolean(body.useAzureOCR),
            ocrLanguage: body.ocrLanguage,
            ocrConcurrency: parseNumber(body.ocrConcurrency),
            // Pipeline mode: "default", "ocr-enhanced", "ocr-only"
            pipelineMode: body.pipelineMode || "default"
        };

        // Custom schema
        if (body.customSchema) {
            options.customSchema = typeof body.customSchema === 'string'
                ? JSON.parse(body.customSchema)
                : body.customSchema;
        }

    } else if (contentType.includes("multipart/form-data")) {
        const formData = await req.formData();
        const fileField = formData.get("file");

        if (fileField) {
            const arrayBuffer = await fileField.arrayBuffer();
            file = Buffer.from(arrayBuffer);
            mimeType = fileField.type;
        }

        docType = formData.get("docType");

        options = {
            modelProvider: formData.get("modelProvider") || "gemini",
            enforceJsonSchema: formData.get("enforceJsonSchema") !== "false",
            customPrompt: formData.get("customPrompt") || null,
            // Tiling options
            enableTiling: parseBoolean(formData.get("enableTiling")),
            sliceHeight: parseNumber(formData.get("tileHeight")),
            overlap: parseNumber(formData.get("tileOverlap")),
            headerHeight: parseNumber(formData.get("headerHeight")),
            parallelMode: parseBoolean(formData.get("parallelTiling")),
            maxConcurrency: parseNumber(formData.get("maxConcurrency")),
            // OCR options
            useAzureOCR: parseBoolean(formData.get("useAzureOCR")),
            ocrLanguage: formData.get("ocrLanguage"),
            ocrConcurrency: parseNumber(formData.get("ocrConcurrency")),
            // Pipeline mode: "default", "ocr-enhanced", "ocr-only"
            pipelineMode: formData.get("pipelineMode") || "default"
        };

        // Custom schema
        const customSchemaStr = formData.get("customSchema");
        if (customSchemaStr) {
            options.customSchema = JSON.parse(customSchemaStr);
        }

    } else {
        throw new Error("Unsupported Content-Type. Use multipart/form-data or application/json");
    }

    if (!file || !docType) {
        throw new Error("Missing file or document type");
    }

    // Load schema
    let schema = options.customSchema;
    if (!schema) {
        schema = await getSchema(docType);
    }

    if (!schema) {
        throw new Error("Invalid document type or schema");
    }

    return { file, mimeType, docType, schema, options };
}

/**
 * Parse boolean from string/boolean/undefined.
 */
function parseBoolean(value) {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return undefined;
}

/**
 * Parse number from string/number/undefined.
 */
function parseNumber(value) {
    if (value === undefined || value === null || value === "") return undefined;
    const num = parseInt(value, 10);
    return isNaN(num) ? undefined : num;
}

/**
 * Build the document processing pipeline based on mode.
 *
 * Modes:
 * - "default": Standard pipeline (tiling + AI extraction)
 * - "ocr-enhanced": Azure OCR + Image sent to AI (best accuracy)
 * - "ocr-only": Azure OCR text only, no image (fastest, cheapest)
 *
 * @param {string} mode - Pipeline mode
 * @returns {Pipeline}
 */
function buildPipeline(mode) {
    const pipeline = new Pipeline('DocumentRecognition');

    // All modes start with preprocessing
    pipeline.add(new PreprocessingStage());

    switch (mode) {
        case 'ocr-enhanced':
            // OCR + Image mode: Azure OCR extracts text, then send both OCR text + image to AI
            console.log('[Pipeline] Mode: ocr-enhanced (OCR text + images)');
            pipeline.add(new AzureOCRStage());
            pipeline.add(new OCREnhancedExtractionStage());
            break;

        case 'ocr-only':
            // OCR-only mode: Azure OCR extracts text, send only text to AI (no images)
            console.log('[Pipeline] Mode: ocr-only (text only, no images)');
            pipeline.add(new AzureOCRStage());
            pipeline.add(new OCROnlyExtractionStage());
            break;

        case 'ocr-verified':
            // OCR-verified mode: OCR + image extraction, then IBAN verification loop
            console.log('[Pipeline] Mode: ocr-verified (OCR + image + IBAN verification)');
            pipeline.add(new AzureOCRStage());
            pipeline.add(new OCRVerifiedExtractionStage());
            break;

        default:
            // Default mode: Standard tiling + AI extraction
            console.log('[Pipeline] Mode: default (tiling + AI vision)');
            pipeline.add(new AzureOCRStage());    // Optional: runs if useAzureOCR=true
            pipeline.add(new TilingStage());
            pipeline.add(new ExtractionStage());
            break;
    }

    // All modes end with aggregation, validation, and cleanup
    pipeline.add(new AggregationStage());
    pipeline.add(new ValidationStage());
    pipeline.add(new CleanupStage());

    return pipeline;
}

export async function POST(req) {
    try {
        // Parse request
        const request = await parseRequest(req);

        // Create processing context
        const context = new ProcessingContext(request);

        // Determine pipeline mode
        // For ocr-enhanced, ocr-only, and ocr-verified, auto-enable Azure OCR
        let pipelineMode = request.options.pipelineMode || 'default';
        if (pipelineMode === 'ocr-enhanced' || pipelineMode === 'ocr-only' || pipelineMode === 'ocr-verified') {
            context.options.useAzureOCR = true;
        }

        // Build and execute pipeline
        const pipeline = buildPipeline(pipelineMode);
        const result = await pipeline.execute(context);

        // Check for errors
        if (result.error) {
            console.error("[recognize-v2] Pipeline error:", result.error);

            // Special handling for specific errors
            if (result.error.includes("OCR which is not currently supported")) {
                return NextResponse.json({ error: result.error }, { status: 400 });
            }

            return NextResponse.json({
                error: result.error,
                details: result.errors
            }, { status: 500 });
        }

        // Return result with optional metadata
        const response = result.result || {};

        // Add processing summary if in debug mode
        if (process.env.DEBUG_VERBOSE === 'true') {
            response._meta = result.getSummary();
        }

        return NextResponse.json(response);

    } catch (error) {
        console.error("[recognize-v2] Error processing document:", error);

        if (error.message.includes("OCR which is not currently supported")) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }

        return NextResponse.json({
            error: error.message || "Internal server error"
        }, { status: 500 });
    }
}
