import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  const gmail = process.env.GMAIL_USER;
  const pass  = process.env.GMAIL_APP_PASSWORD;
  if (!gmail || !pass) return res.status(200).json({ replies: [] });

  const client = new ImapFlow({
    host: "imap.gmail.com", port: 993, secure: true,
    auth: { user: gmail, pass }, logger: false
  });
  try {
    await client.connect();
    await client.mailboxOpen("INBOX");
    const replies = [], uids = [];

    for await (const msg of client.fetch({ seen: false }, { envelope: true, source: true })) {
      const subject = msg.envelope.subject || "";
      const match = subject.match(/\[#(t[\w]+)\]/i);
      if (!match) continue;
      const parsed = await simpleParser(msg.source);
      uids.push(msg.uid);
      replies.push({
        uid: String(msg.uid),
        ticketId: match[1],
        fromEmail: parsed.from?.value?.[0]?.address || "unknown",
        fromName:  parsed.from?.value?.[0]?.name    || "",
        subject,
        body: parsed.text || "",
        timestamp: parsed.date?.toISOString() || new Date().toISOString()
      });
    }
    if (uids.length) await client.messageFlagsAdd({ uid: uids }, ["\\Seen"]);
    await client.logout();
    return res.status(200).json({ replies });
  } catch (e) {
    try { await client.logout(); } catch {}
    return res.status(200).json({ replies: [], error: e.message });
  }
}
