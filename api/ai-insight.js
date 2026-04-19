// api/ai-insight.js — Groq (free tier, 14,400 req/day)
// Requires GROQ_API_KEY in Vercel environment variables
// Get a free key at: https://console.groq.com

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GROQ_API_KEY not configured" });

  try {
    const { messages } = req.body;
    if (!messages || !messages.length) return res.status(400).json({ error: "No messages provided" });

    const userMessage = messages[messages.length - 1];
    const promptText = typeof userMessage.content === "string"
      ? userMessage.content
      : (userMessage.content?.[0]?.text || "");

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 1000,
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content: "You are an IT helpdesk analyst. When given ticket data, provide concise analysis using bullet points. Be direct and actionable."
          },
          {
            role: "user",
            content: promptText
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data.error?.message || "Groq API error (status " + response.status + ")";
      return res.status(response.status).json({ error: errMsg });
    }

    const text = data.choices?.[0]?.message?.content || "No response generated.";
    return res.status(200).json({ content: [{ type: "text", text }] });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
