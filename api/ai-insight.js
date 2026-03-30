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

    // Extract the user message content (last message in the array)
    const userMessage = messages[messages.length - 1];
    const promptText = typeof userMessage.content === "string"
      ? userMessage.content
      : (userMessage.content?.[0]?.text || "");

    const systemInstruction = "You are an IT helpdesk analyst. When given ticket data, provide concise analysis using bullet points.";

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + apiKey,
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

    if (!response.ok) {
      const errMsg = data.error?.message || "Gemini API error";
      return res.status(response.status).json({ error: errMsg });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";

    // Return in same shape the frontend expects: { content: [{ text }] }
    return res.status(200).json({ content: [{ type: "text", text }] });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
