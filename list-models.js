const { GoogleGenerativeAI } = require("@google/generative-ai");

async function listModels() {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Dummy model to get client
        // Actually the SDK doesn't have a direct listModels method on the client instance easily accessible in all versions?
        // Wait, the error message said "Call ListModels".
        // In the node SDK, it might be different.
        // Let's try to use the API key to make a REST call if SDK is ambiguous, but SDK should have it.
        // Looking at docs (simulated), usually it's a separate manager or just not exposed in the high level `getGenerativeModel`.

        // Let's try a simple fetch to the API endpoint which is more reliable for listing.
        const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();

        if (data.models) {
            console.log("Available Models:");
            data.models.forEach(m => {
                if (m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent")) {
                    console.log(`- ${m.name} (${m.displayName})`);
                }
            });
        } else {
            console.log("No models found or error:", data);
        }
    } catch (error) {
        console.error("Error listing models:", error);
    }
}

listModels();
