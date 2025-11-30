import { NextResponse } from "next/server";
import { getSchema } from "@/services/schema.service";
import { analyzeWithOpenAI } from "@/services/openai.service";
import { analyzeWithGemini } from "@/services/gemini.service";

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export const runtime = 'nodejs';

export async function POST(req) {
    try {
        let fileBuffer, mimeType, docType, modelProvider, enforceJsonSchema, customPrompt, customSchemaInput;
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

        // Normalize file object for services
        const fileObj = { type: mimeType };

        let jsonResponse;

        if (modelProvider === "openai" || modelProvider === "azure-openai") {
            jsonResponse = await analyzeWithOpenAI(fileObj, fileBuffer, docType, schema, modelProvider, enforceJsonSchema, customPrompt);
        } else {
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
