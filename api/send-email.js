export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { to, subject, text, from } = req.body;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "RESEND_API_KEY not set" });
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: from || "Hoptix IT <onboarding@resend.dev>",
        to: Array.isArray(to) ? to : [to],
        subject,
        text
      })
    });
    const data = await r.json();
    if (r.ok) return res.status(200).json({ id: data.id });
    return res.status(r.status).json({ error: data.message || "Failed" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
