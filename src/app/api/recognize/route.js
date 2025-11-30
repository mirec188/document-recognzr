import { NextResponse } from "next/server";
import { getSchema } from "@/services/schema.service";
import { analyzeWithOpenAI } from "@/services/openai.service";
import { analyzeWithGemini } from "@/services/gemini.service";

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export const runtime = 'nodejs';

export async function POST(req) {
    try {
        const formData = await req.formData();
        const file = formData.get("file");
        const docType = formData.get("docType");
        const modelProvider = formData.get("modelProvider") || "gemini";
        const enforceJsonSchema = formData.get("enforceJsonSchema") !== "false";
        const customPrompt = formData.get("customPrompt") || null;
        const customSchemaStr = formData.get("customSchema");

        if (!file || !docType) {
            return NextResponse.json({ error: "Missing file or document type" }, { status: 400 });
        }

        // Load Schema
        let schema;
        if (customSchemaStr) {
            try {
                schema = JSON.parse(customSchemaStr);
            } catch (e) {
                return NextResponse.json({ error: "Invalid custom schema JSON" }, { status: 400 });
            }
        } else {
            schema = await getSchema(docType);
        }

        if (!schema) {
            return NextResponse.json({ error: "Invalid document type or schema" }, { status: 400 });
        }

        // Convert file to buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        let jsonResponse;

        if (modelProvider === "openai" || modelProvider === "azure-openai") {
            jsonResponse = await analyzeWithOpenAI(file, buffer, docType, schema, modelProvider, enforceJsonSchema, customPrompt);
        } else {
            jsonResponse = await analyzeWithGemini(file, buffer, docType, schema, customPrompt);
        }

        return NextResponse.json(jsonResponse);

    } catch (error) {
        console.error("Error processing document:", error);
        // Provide more specific error messages if available
        const errorMessage = error.message || "Internal server error";
        const status = errorMessage.includes("Azure HTTP") || errorMessage.includes("Failed to parse") ? 500 : 500; 
        // We could differentiate 400s from 500s based on error types if we defined custom errors, but for now 500 is safe for unexpected failures.
        
        // Special handling for the known "OCR not supported" error from PDF service
        if (errorMessage.includes("OCR which is not currently supported")) {
             return NextResponse.json({ error: errorMessage }, { status: 400 });
        }

        return NextResponse.json({ error: errorMessage, details: error.message }, { status: 500 });
    }
}