export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { to, subject, text, from } = req.body;
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "BREVO_API_KEY not set" });
  try {
    const toArr = Array.isArray(to) ? to : [to];
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "Hoptix IT", email: from || process.env.BREVO_FROM_EMAIL },
        to: toArr.map(function(e){ return { email: e }; }),
        subject: subject || "(no subject)",
        textContent: text || ""
      })
    });
    const data = await r.json();
    if (r.ok && data.messageId) return res.status(200).json({ id: data.messageId });
    return res.status(r.status).json({ error: data.message || "Failed" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
