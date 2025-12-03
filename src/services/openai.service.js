import OpenAI from "openai";
import { ProxyAgent } from "undici";
import { enforceStrictSchema } from "./schema.service";
import { pdfToJpegs } from "./pdf.service";

const OPENAI_TIMEOUT = Number(process.env.OPENAI_TIMEOUT_MS) || 300000;
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

const longFetch = (url, init = {}) => {
    const signal = AbortSignal.timeout(OPENAI_TIMEOUT);
    return fetch(url, { ...init, signal, cache: 'no-store', dispatcher });
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: OPENAI_TIMEOUT, fetch: longFetch });

// Azure OpenAI configuration
const AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY;
const AZURE_OPENAI_RESOURCE = process.env.AZURE_OPENAI_RESOURCE_NAME;
const AZURE_OPENAI_API_VERSION = process.env.AZURE_OPENAI_API_VERSION;
const AZURE_OPENAI_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT;

export async function analyzeWithOpenAI(file, buffer, docType, schema, provider = "openai", enforceJsonSchema = true, customPrompt = null) {
    let userContent;

    if (file.type === "application/pdf") {
        const jpegBuffers = await pdfToJpegs(buffer, { density: 200, quality: 80 });
        userContent = jpegBuffers.map(b => ({
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${b.toString("base64")}` },
        }));
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

    const defaultPrompt = `You are an expert document parser. You are extracting data about list of drawdowns (invoice number, variable symbol, amount and iban (bank account) to where money will be sent). Focus, do not make mistakes. This is a scan. IBANS have to be valid. Be careful with errors like 8-6, 5-3 similiar numbers etc. Extract information from this ${docType}.`;
    let systemMessage;

    if (customPrompt) {
        if (customPrompt.includes("{{schema}}")) {
             systemMessage = customPrompt.replace("{{schema}}", JSON.stringify(schema));
        } else {
             // No placeholder.
             if (enforceJsonSchema) {
                 systemMessage = customPrompt;
             } else {
                 systemMessage = `${customPrompt} Return the output as a valid JSON object adhering to this schema: ${JSON.stringify(schema)}`;
             }
        }
    } else {
        // Default
        if (enforceJsonSchema) {
             systemMessage = defaultPrompt;
        } else {
             systemMessage = `${defaultPrompt} Return the output as a valid JSON object adhering to this schema: ${JSON.stringify(schema)}`;
        }
    }

    let response;

    if (provider === "azure-openai") {
        const deployment = AZURE_OPENAI_DEPLOYMENT;
        if (!AZURE_OPENAI_RESOURCE || !AZURE_OPENAI_API_KEY || !deployment) {
            throw new Error("Azure OpenAI environment is not fully configured");
        }

        const baseUrl = `https://${AZURE_OPENAI_RESOURCE}.openai.azure.com/openai/deployments/${deployment}`;
        
        // Note: The original code instantiated a new OpenAI client for Azure here.
        // We can do the same or use fetch directly as the original code did for the actual call (mixed approach).
        // The original code constructed the client but then used `longFetch` manually for the request? 
        // Let's look closely at the original code.
        // Original code: 
        // const azureClient = new OpenAI({...}); 
        // ... 
        // const fetchResp = await longFetch(...) 
        // It seems it used manual fetch for Azure to handle specific headers/url structure that maybe the library wasn't handling as desired or just legacy.
        // We will stick to the manual fetch approach to ensure compatibility with the previous logic.

        const requestBody = {
            model: deployment,
            messages: [
                {
                    role: "system",
                    content: systemMessage
                },
                {
                    role: "user",
                    content: userContent,
                },
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

        // the mas is here for logging only
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
                    content: [{ type: "text", text: systemMessage }]
                },
                {
                    role: "user",
                    content: Array.isArray(userContent) ? userContent : [{ type: "text", text: userContent }],
                },
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
        return JSON.parse(content);
    } catch (e) {
        console.error("Failed to parse OpenAI response:", content);
        throw new Error("Failed to parse document from OpenAI");
    }
}
