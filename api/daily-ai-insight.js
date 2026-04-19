// api/daily-ai-insight.js
// Cron: runs at 1PM PHT daily (5:00 AM UTC)
// Fetches all tickets, generates AI analysis, emails to randy@omnisecurityinc.com

import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

const PRI_META = {
  critical: { label: "Critical" },
  high: { label: "High" },
  medium: { label: "Medium" },
  low: { label: "Low" }
};

const ALL_STATUSES = ["Open", "In Progress", "Pending", "Escalated", "Closed"];
const DEFAULT_STATUS_SLA = { "Open": 2, "In Progress": 8, "Pending": 24, "Escalated": 1, "Closed": null };

function fmtDuration(mins) {
  if (!mins || mins <= 0) return "0m";
  var h = Math.floor(mins / 60);
  var m = Math.round(mins % 60);
  if (h === 0) return m + "m";
  if (m === 0) return h + "h";
  return h + "h " + m + "m";
}

async function generateAiInsight(summaryData) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return "AI analysis unavailable — GEMINI_API_KEY not set.";

  const promptText = "You are an IT helpdesk analyst. Analyze this daily helpdesk data and provide:\n" +
    "1. 🔥 Top 3 issues or concerns\n" +
    "2. ⏳ Status bottlenecks (where are tickets getting stuck?)\n" +
    "3. 🚨 SLA breach summary\n" +
    "4. ⏱ IT hours vs ticket volume — is workload balanced?\n" +
    "5. 💡 3 actionable recommendations for tomorrow\n\n" +
    "Be concise. Use bullet points. This will be sent as a daily email report.\n\n" +
    "Data:\n" + JSON.stringify(summaryData, null, 2);

  const models = ["gemini-2.0-flash", "gemini-1.5-flash"];
  for (const model of models) {
    try {
      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + apiKey,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: "You are an IT helpdesk analyst." }] },
            contents: [{ role: "user", parts: [{ text: promptText }] }],
            generationConfig: { maxOutputTokens: 1000, temperature: 0.4 }
          })
        }
      );
      const data = await response.json();
      if (response.ok) {
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "No insight generated.";
      }
      if (response.status !== 404) break;
    } catch (e) {
      return "AI error: " + e.message;
    }
  }
  return "AI analysis unavailable — check GEMINI_API_KEY.";
}

export default async function handler(req, res) {
  // Allow manual trigger via GET or automated cron
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Fetch all data
    const [ticketsRes, usersRes, typesRes, sessionsRes] = await Promise.all([
      supabase.from("tickets").select("*"),
      supabase.from("users").select("*"),
      supabase.from("ticket_types").select("*"),
      supabase.from("time_sessions").select("*")
    ]);

    const tickets = (ticketsRes.data || []).filter(function(t) { return !t.deleted; });
    const users = usersRes.data || [];
    const ticketTypes = typesRes.data || [];
    const sessions = (sessionsRes.data || []).filter(function(s) { return s.ended_at; });

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart.getTime() - 7 * 86400000);

    const todayTickets = tickets.filter(function(t) { return new Date(t.createdAt) >= todayStart; });
    const weekTickets = tickets.filter(function(t) { return new Date(t.createdAt) >= weekStart; });
    const openTickets = tickets.filter(function(t) { return t.status !== "Closed"; });
    const closedToday = tickets.filter(function(t) { return t.closedAt && new Date(t.closedAt) >= todayStart; });

    // Status time summary from statusTimeLog
    var statusTimeSummary = {};
    ALL_STATUSES.forEach(function(s) { statusTimeSummary[s] = 0; });
    tickets.forEach(function(t) {
      (t.statusTimeLog || []).forEach(function(entry) {
        var mins;
        if (entry.durationMins != null) {
          mins = entry.durationMins;
        } else if (entry.exitedAt === null && entry.enteredAt) {
          mins = (Date.now() - new Date(entry.enteredAt)) / 60000;
        } else {
          return;
        }
        if (statusTimeSummary[entry.status] !== undefined) statusTimeSummary[entry.status] += mins;
      });
    });

    // SLA breach analysis
    var slaBreachCount = {};
    var slaBreachMins = {};
    ALL_STATUSES.forEach(function(s) { slaBreachCount[s] = 0; slaBreachMins[s] = 0; });
    tickets.forEach(function(t) {
      (t.statusTimeLog || []).forEach(function(entry) {
        var allowed = DEFAULT_STATUS_SLA[entry.status];
        if (allowed === null || allowed === undefined) return;
        var allowedMins = allowed * 60;
        var durMins;
        if (entry.durationMins != null) {
          durMins = entry.durationMins;
        } else if (entry.exitedAt === null && entry.enteredAt) {
          durMins = (Date.now() - new Date(entry.enteredAt)) / 60000;
        } else {
          return;
        }
        if (durMins > allowedMins) {
          slaBreachCount[entry.status]++;
          slaBreachMins[entry.status] += (durMins - allowedMins);
        }
      });
    });

    const totalBreachCount = Object.values(slaBreachCount).reduce(function(a, b) { return a + b; }, 0);
    const totalBreachMins = Object.values(slaBreachMins).reduce(function(a, b) { return a + b; }, 0);

    // IT hours
    const totalLoggedMins = sessions.reduce(function(sum, s) { return sum + (s.duration_minutes || 0); }, 0);
    const todaySessions = sessions.filter(function(s) { return new Date(s.ended_at) >= todayStart; });
    const todayLoggedMins = todaySessions.reduce(function(sum, s) { return sum + (s.duration_minutes || 0); }, 0);

    // Per-tech breakdown
    const IT_ROLES = ["admin", "it_manager", "it_technician"];
    const techs = users.filter(function(u) { return IT_ROLES.includes(u.role) && u.active; });
    const techBreakdown = techs.map(function(u) {
      var assigned = openTickets.filter(function(t) { return t.assignedTo === u.id; }).length;
      var userMins = sessions.filter(function(s) { return s.user_id === u.id; }).reduce(function(sum, s) { return sum + (s.duration_minutes || 0); }, 0);
      return { name: u.name, openTickets: assigned, loggedHours: parseFloat((userMins / 60).toFixed(1)) };
    }).filter(function(t) { return t.openTickets > 0 || t.loggedHours > 0; });

    // Top ticket types
    const topTypes = ticketTypes.map(function(tt) {
      return { name: tt.name, total: tickets.filter(function(t) { return t.typeId === tt.id; }).length };
    }).sort(function(a, b) { return b.total - a.total; }).slice(0, 5);

    // Build summary for AI
    const summary = {
      date: now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila" }),
      timezone: "PHT (UTC+8)",
      overview: {
        totalActiveTickets: tickets.length,
        openNow: openTickets.length,
        createdToday: todayTickets.length,
        closedToday: closedToday.length,
        escalated: tickets.filter(function(t) { return t.status === "Escalated"; }).length,
        pending: tickets.filter(function(t) { return t.status === "Pending"; }).length,
        inProgress: tickets.filter(function(t) { return t.status === "In Progress"; }).length
      },
      slaBreaches: {
        totalBreachInstances: totalBreachCount,
        totalTimeOverSla: fmtDuration(totalBreachMins),
        byStatus: ALL_STATUSES.filter(function(s) { return slaBreachCount[s] > 0; }).map(function(s) {
          return s + " — " + slaBreachCount[s] + " breaches, " + fmtDuration(slaBreachMins[s]) + " over SLA";
        })
      },
      statusTimeBottlenecks: Object.keys(statusTimeSummary).filter(function(s) { return statusTimeSummary[s] > 0; }).map(function(s) {
        return s + ": " + fmtDuration(statusTimeSummary[s]);
      }),
      itHours: {
        totalAllTime: fmtDuration(totalLoggedMins),
        loggedToday: fmtDuration(todayLoggedMins),
        techBreakdown: techBreakdown
      },
      topIssueTypes: topTypes,
      weeklyCreated: weekTickets.length
    };

    const aiInsight = await generateAiInsight(summary);

    // Build HTML email
    const phtDate = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila" });
    const phtTime = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila" });

    const html = "<div style='font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#f8fafc'>" +
      "<div style='background:linear-gradient(135deg,#020e1f,#062d6b);padding:24px;border-radius:12px 12px 0 0'>" +
      "<div style='color:#fff;font-size:22px;font-weight:800;margin-bottom:4px'>🤖 Daily AI Insight</div>" +
      "<div style='color:#7dd3fc;font-size:13px'>Hoptix IT Helpdesk · " + phtDate + " · " + phtTime + " PHT</div>" +
      "</div>" +
      "<div style='padding:24px;background:#fff'>" +
      "<table style='width:100%;border-collapse:collapse;margin-bottom:20px'><tr>" +
      "<td style='background:#eef2ff;border-radius:8px;padding:14px;text-align:center;width:25%'><div style='font-size:24px;font-weight:800;color:#6366f1'>" + tickets.length + "</div><div style='font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase'>Total</div></td>" +
      "<td style='width:2%'></td>" +
      "<td style='background:#fef3c7;border-radius:8px;padding:14px;text-align:center;width:25%'><div style='font-size:24px;font-weight:800;color:#f59e0b'>" + openTickets.length + "</div><div style='font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase'>Open</div></td>" +
      "<td style='width:2%'></td>" +
      "<td style='background:#fee2e2;border-radius:8px;padding:14px;text-align:center;width:25%'><div style='font-size:24px;font-weight:800;color:#ef4444'>" + totalBreachCount + "</div><div style='font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase'>Breaches</div></td>" +
      "<td style='width:2%'></td>" +
      "<td style='background:#f0fdf4;border-radius:8px;padding:14px;text-align:center;width:25%'><div style='font-size:24px;font-weight:800;color:#10b981'>" + closedToday.length + "</div><div style='font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase'>Closed Today</div></td>" +
      "</tr></table>" +
      "<div style='background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px;margin-bottom:20px'>" +
      "<div style='font-weight:700;color:#0369a1;margin-bottom:10px;font-size:14px'>🤖 AI Analysis</div>" +
      "<div style='font-size:13px;color:#334155;line-height:1.8;white-space:pre-wrap'>" + aiInsight.replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</div>" +
      "</div>" +
      "<div style='background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px;margin-bottom:16px'>" +
      "<div style='font-weight:700;color:#dc2626;margin-bottom:8px;font-size:13px'>🚨 SLA Breach Summary</div>" +
      "<div style='font-size:12px;color:#334155'>Total breach instances: <strong>" + totalBreachCount + "</strong> · Total time over SLA: <strong>" + fmtDuration(totalBreachMins) + "</strong></div>" +
      (totalBreachCount === 0 ? "<div style='font-size:12px;color:#10b981;margin-top:4px'>✅ No breaches recorded.</div>" : "") +
      "</div>" +
      "<div style='background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px;margin-bottom:16px'>" +
      "<div style='font-weight:700;color:#166534;margin-bottom:8px;font-size:13px'>⏱ IT Hours Today: " + fmtDuration(todayLoggedMins) + "</div>" +
      techBreakdown.map(function(t) {
        return "<div style='font-size:12px;color:#334155;margin-bottom:4px'>👤 " + t.name + " — " + t.openTickets + " open tickets · " + t.loggedHours + "h logged</div>";
      }).join("") +
      "</div>" +
      "<div style='text-align:center;padding:16px 0;border-top:1px solid #e2e8f0'>" +
      "<a href='https://helpdesk-ai.vercel.app' style='background:#6366f1;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px'>Open Hoptix Dashboard →</a>" +
      "</div>" +
      "</div>" +
      "<div style='background:#f1f5f9;padding:12px;text-align:center;border-radius:0 0 12px 12px'>" +
      "<div style='font-size:11px;color:#94a3b8'>Hoptix · A.eye Technology · Daily AI Insight · Sent at " + phtTime + " PHT</div>" +
      "</div>" +
      "</div>";

    // Send email
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });

    await transporter.sendMail({
      from: '"Hoptix AI" <' + process.env.GMAIL_USER + ">",
      to: "randy@omnisecurityinc.com",
      subject: "🤖 Daily AI Insight — " + phtDate + " | " + tickets.length + " tickets, " + totalBreachCount + " breaches",
      html: html,
      text: "Daily AI Insight - " + phtDate + "\n\n" + aiInsight
    });

    return res.status(200).json({
      success: true,
      ticketsAnalyzed: tickets.length,
      breachCount: totalBreachCount,
      sentTo: "randy@omnisecurityinc.com"
    });

  } catch (err) {
    console.error("daily-ai-insight error:", err);
    return res.status(500).json({ error: err.message });
  }
}
