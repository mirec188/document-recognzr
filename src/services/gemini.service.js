import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY);

export async function analyzeWithGemini(file, buffer, docType, schema, customPrompt) {
    // Using gemini-2.5-flash as verified from available models list
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const base64Data = buffer.toString("base64");
    const schemaString = JSON.stringify(schema, null, 2);
    let prompt;

    if (customPrompt) {
        if (customPrompt.includes("{{schema}}")) {
            prompt = customPrompt.replace("{{schema}}", schemaString);
        } else {
            prompt = `${customPrompt}
    
    Strictly follow this JSON schema:
    ${schemaString}
    
    Return ONLY the JSON object. No markdown formatting, no backticks.`;
        }
    } else {
        prompt = `
    You are an expert document parser. 
    Please extract information from this ${docType} and return it in JSON format.
    
    Strictly follow this JSON schema:
    ${schemaString}
    
    Return ONLY the JSON object. No markdown formatting, no backticks.
  `;
    }

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
        return JSON.parse(cleanedResponse);
    } catch (e) {
        console.error("Failed to parse Gemini response:", responseText);
        throw new Error("Failed to parse document from Gemini");
    }
}
