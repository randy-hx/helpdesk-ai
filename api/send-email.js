import nodemailer from "nodemailer";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { to, subject, text } = req.body;
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass)
    return res.status(500).json({ error: "Gmail credentials not configured" });
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: gmailUser, pass: gmailPass }
    });
    const toArr = Array.isArray(to) ? to : [to];
    const info = await transporter.sendMail({
      from: '"Hoptix IT Helpdesk" <' + gmailUser + ">",
      to: toArr.join(", "),
      subject: subject || "(no subject)",
      text: text || ""
    });
    return res.status(200).json({ id: info.messageId });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
