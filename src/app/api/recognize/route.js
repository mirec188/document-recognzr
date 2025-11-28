import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { NextResponse } from "next/server";
import PDFParser from "pdf2json";
import fs from 'fs/promises';
import path from 'path';
import { ProxyAgent } from "undici";

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export const runtime = 'nodejs';

// Initialize Clients
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
const OPENAI_TIMEOUT = Number(process.env.OPENAI_TIMEOUT_MS) || 300000;
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
const longFetch = (url, init = {}) => {
    const signal = AbortSignal.timeout(OPENAI_TIMEOUT);
    return fetch(url, { ...init, signal, cache: 'no-store', dispatcher });
};
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: OPENAI_TIMEOUT, fetch: longFetch });

// Azure OpenAI configuration (expects .env values)
const AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY;
const AZURE_OPENAI_RESOURCE = process.env.AZURE_OPENAI_RESOURCE_NAME; // e.g., slsp-openai-sweden
const AZURE_OPENAI_API_VERSION = process.env.AZURE_OPENAI_API_VERSION; // e.g., 2025-01-01-preview
const AZURE_OPENAI_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT; // e.g., datamanagement-gpt-5
const AZURE_USE_DEPLOYMENT_URLS = process.env.AZURE_OPENAI_USE_DEPLOYMENT_URLS === 'true';

const dataFilePath = path.join(process.cwd(), 'src/data/schemas.json');

// Helper to enforce strict schema for OpenAI Structured Outputs
function enforceStrictSchema(schema) {
    if (!schema || typeof schema !== 'object') return schema;

    const newSchema = { ...schema };

    if (newSchema.type === 'object') {
        newSchema.additionalProperties = false;
        newSchema.required = Object.keys(newSchema.properties || {});

        // Recursively enforce for properties
        if (newSchema.properties) {
            for (const key in newSchema.properties) {
                newSchema.properties[key] = enforceStrictSchema(newSchema.properties[key]);
            }
        }
    } else if (newSchema.type === 'array') {
        if (newSchema.items) {
            newSchema.items = enforceStrictSchema(newSchema.items);
        }
    }

    return newSchema;
}

export async function POST(req) {
    try {
        const formData = await req.formData();
        const file = formData.get("file");
        const docType = formData.get("docType");
        const modelProvider = formData.get("modelProvider") || "gemini";

        if (!file || !docType) {
            return NextResponse.json({ error: "Missing file or document type" }, { status: 400 });
        }

        // Load Schemas dynamically
        let schemas;
        try {
            const fileContent = await fs.readFile(dataFilePath, 'utf8');
            schemas = JSON.parse(fileContent);
        } catch (err) {
            console.error("Error loading schemas:", err);
            return NextResponse.json({ error: "Failed to load document schemas" }, { status: 500 });
        }

        // Select Schema
        const schema = schemas[docType];
        if (!schema) {
            return NextResponse.json({ error: "Invalid document type" }, { status: 400 });
        }

        // Convert file to buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        let jsonResponse;

        if (modelProvider === "openai" || modelProvider === "azure-openai") {
            // OpenAI Implementation
            let userContent;

            if (file.type === "application/pdf") {
                // Extract text from PDF for OpenAI using pdf2json
                try {
                    const pdfParser = new PDFParser(this, 1);

                    const textContent = await new Promise((resolve, reject) => {
                        pdfParser.on("pdfParser_dataError", errData => reject(errData.parserError));
                        pdfParser.on("pdfParser_dataReady", pdfData => {
                            resolve(pdfParser.getRawTextContent());
                        });
                        pdfParser.parseBuffer(buffer);
                    });

                    if (!textContent || textContent.trim().length === 0) {
                        return NextResponse.json({ error: "Could not extract text from PDF. If this is a scanned PDF, OpenAI requires OCR which is not currently supported in this mode. Please use Gemini for scanned PDFs." }, { status: 400 });
                    }

                    userContent = `Here is the text content of the ${docType}: \n\n${textContent} `;
                } catch (pdfError) {
                    console.error("PDF parsing error:", pdfError);
                    return NextResponse.json({ error: "Failed to parse PDF file." }, { status: 500 });
                }
            } else {
                // It's an image, use Vision
                const base64Data = buffer.toString("base64");
                userContent = [
                    {
                        type: "image_url",
                        image_url: {
                            url: `data:${file.type};base64,${base64Data}`,
                        },
                    },
                ];
            }

            // Enforce strict schema
            const strictSchema = enforceStrictSchema(schema);

            // Log Prompt
            console.log("--- OpenAI Request Prompt ---");
            console.log(JSON.stringify(userContent, null, 2));
            console.log("-----------------------------");

            // Choose OpenAI client and model based on provider
            let response;
            if (modelProvider === "azure-openai") {
                // Construct Azure deployment-scoped endpoint and include required api-version
                const deployment = AZURE_OPENAI_DEPLOYMENT;
                if (!AZURE_OPENAI_RESOURCE || !AZURE_OPENAI_API_KEY || !deployment) {
                    return NextResponse.json({ error: "Azure OpenAI environment is not fully configured" }, { status: 500 });
                }
                const baseUrl = `https://${AZURE_OPENAI_RESOURCE}.openai.azure.com/openai/deployments/${deployment}`;
                const azureClient = new OpenAI({
                    apiKey: AZURE_OPENAI_API_KEY,
                    baseURL: baseUrl,
                    timeout: OPENAI_TIMEOUT,
                    fetch: longFetch,
                    defaultQuery: { "api-version": AZURE_OPENAI_API_VERSION || "2025-02-01-preview" },
                    defaultHeaders: { "api-key": AZURE_OPENAI_API_KEY }
                });
                const requestBody = {
                    model: deployment,
                    messages: [
                        {
                            role: "system",
                            content: `You are an expert document parser. Extract information from this ${docType}.`
                        },
                        {
                            role: "user",
                            content: userContent,
                        },
                    ],
                    response_format: {
                        type: "json_schema",
                        json_schema: {
                            name: docType,
                            strict: true,
                            schema: strictSchema
                        }
                    }
                };
                const mask = (k) => (k ? `${k.slice(0, 6)}...${k.slice(-2)}` : undefined);
                const urlToCall = `${baseUrl}/chat/completions?api-version=${AZURE_OPENAI_API_VERSION || "2025-02-01-preview"}`;
                const headersToSend = { "content-type": "application/json", "api-key": mask(AZURE_OPENAI_API_KEY) };
                console.log("--- Azure OpenAI Request ---");
                console.log(JSON.stringify({ url: urlToCall, headers: headersToSend, body: requestBody }, null, 2));
                if (requestBody.response_format) console.log("response_format present: json_schema");
                console.log("----------------------------");
                const fetchResp = await longFetch(urlToCall, {
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
                    model: "gpt-5",
                    messages: [
                        {
                            role: "system",
                            content: [{ type: "text", text: `You are an expert document parser. Extract information from this ${docType}.` }]
                        },
                        {
                            role: "user",
                            content: Array.isArray(userContent) ? userContent : [{ type: "text", text: userContent }],
                        },
                    ],
                    response_format: {
                        type: "json_schema",
                        json_schema: {
                            name: docType,
                            strict: true,
                            schema: strictSchema
                        }
                    },
                };
                const mask = (k) => (k ? `${k.slice(0, 6)}...${k.slice(-2)}` : undefined);
                const urlToCall = `https://api.openai.com/v1/chat/completions`;
                const headersToSend = { "content-type": "application/json", "authorization": `Bearer ${mask(process.env.OPENAI_API_KEY)}` };
                console.log("--- OpenAI Request ---");
                console.log(JSON.stringify({ url: urlToCall, headers: headersToSend, body: requestBody }, null, 2));
                if (requestBody.response_format) console.log("response_format present: json_schema");
                console.log("----------------------");
                response = await openai.chat.completions.create(requestBody, { timeout: OPENAI_TIMEOUT });
            }

            const content = (response && response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content) || "";

            // Log Response
            console.log("--- OpenAI Full Response ---");
            console.log(typeof response === 'string' ? response : JSON.stringify(response, null, 2));
            console.log("Parsed content:", content);
            console.log("----------------------------");

            try {
                jsonResponse = JSON.parse(content);
            } catch (e) {
                console.error("Failed to parse OpenAI response:", content);
                return NextResponse.json({ error: "Failed to parse document from OpenAI", raw: content || response }, { status: 500 });
            }

        } else {
            // Google Gemini Implementation
            // Using gemini-2.5-flash as verified from available models list
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            const base64Data = buffer.toString("base64");

            const prompt = `
        You are an expert document parser. 
        Please extract information from this ${docType} and return it in JSON format.
        
        Strictly follow this JSON schema:
        ${JSON.stringify(schema, null, 2)}
        
        Return ONLY the JSON object. No markdown formatting, no backticks.
      `;

            // Log Prompt
            console.log("--- Gemini Request Prompt ---");
            console.log(prompt);
            console.log("-----------------------------");

            const result = await model.generateContent([
                prompt,
                {
                    inlineData: {
                        data: base64Data,
                        mimeType: file.type,
                    },
                },
            ]);

            const responseText = result.response.text();

            // Log Response
            console.log("--- Gemini Full Response ---");
            console.log(responseText);
            console.log("----------------------------");

            const cleanedResponse = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
            try {
                jsonResponse = JSON.parse(cleanedResponse);
            } catch (e) {
                console.error("Failed to parse Gemini response:", responseText);
                return NextResponse.json({ error: "Failed to parse document from Gemini", raw: responseText }, { status: 500 });
            }
        }

        return NextResponse.json(jsonResponse);

    } catch (error) {
        console.error("Error processing document:", error);
        return NextResponse.json({ error: "Internal server error", details: error.message }, { status: 500 });
    }
}
