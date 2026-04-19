// api/ai-insight.js — Google Gemini 2.0 Flash (free tier)
// Requires GEMINI_API_KEY in Vercel environment variables
// Get a free key at: https://aistudio.google.com

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY not configured" });

  try {
    const { messages } = req.body;
    if (!messages || !messages.length) return res.status(400).json({ error: "No messages provided" });

    const userMessage = messages[messages.length - 1];
    const promptText = typeof userMessage.content === "string"
      ? userMessage.content
      : (userMessage.content?.[0]?.text || "");

    const systemInstruction = "You are an IT helpdesk analyst. When given ticket data, provide concise analysis using bullet points. Be direct and actionable.";

    // Try gemini-2.0-flash first, fall back to gemini-1.5-flash
    const models = ["gemini-1.5-flash-8b", "gemini-1.5-flash", "gemini-2.0-flash"];
    let lastError = null;

    for (const model of models) {
      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + apiKey,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: systemInstruction }]
            },
            contents: [
              {
                role: "user",
                parts: [{ text: promptText }]
              }
            ],
            generationConfig: {
              maxOutputTokens: 1000,
              temperature: 0.4
            }
          })
        }
      );

      const data = await response.json();

      if (response.ok) {
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";
        return res.status(200).json({ content: [{ type: "text", text }] });
      }

      lastError = data.error?.message || "Gemini API error (status " + response.status + ")";
      // If it's a 404 (model not found), try next model; otherwise break
      if (response.status !== 404) break;
    }

    return res.status(500).json({ error: lastError || "All models failed" });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
