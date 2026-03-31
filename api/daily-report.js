// api/daily-report.js
// Vercel Cron Job — runs daily at 5:00 AM UTC (1:00 PM Manila PHT)
// Sends a Dashboard summary email to randy@omnisecurityinc.com

import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";

const RECIPIENT = "randy@omnisecurityinc.com";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;

const ALL_STATUSES = ["Open", "In Progress", "Pending", "Escalated", "Closed"];
const IT_ROLES = ["admin", "it_manager", "it_technician"];

const STATUS_COLORS = {
  "Open": "#f59e0b",
  "In Progress": "#6366f1",
  "Pending": "#0ea5e9",
  "Escalated": "#ef4444",
  "Closed": "#10b981"
};

const PRI_COLORS = {
  critical: "#dc2626",
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#10b981"
};

const PRI_LABELS = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low"
};

function fmtDuration(mins) {
  if (!mins || mins <= 0) return "0m";
  var h = Math.floor(mins / 60);
  var m = Math.round(mins % 60);
  if (h === 0) return m + "m";
  if (m === 0) return h + "h";
  return h + "h " + m + "m";
}

function calcSlaRate(arr) {
  if (!arr.length) return 100;
  var breached = arr.filter(function(t) { return t.sla_breached; }).length;
  return Math.round((1 - breached / arr.length) * 100);
}

function phtNow() {
  return new Date(Date.now() + 8 * 3600000);
}

function buildHtml(tickets, users, sessions) {
  var active = tickets.filter(function(t) { return !t.deleted; });
  var now = phtNow();
  var dateStr = now.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "Asia/Manila"
  });
  var timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila"
  });

  // ── Stats ──────────────────────────────────────────────────────────────────
  var totalLoggedMins = sessions
    .filter(function(s) { return s.ended_at; })
    .reduce(function(sum, s) { return sum + (s.duration_minutes || 0); }, 0);

  var statusCounts = {};
  ALL_STATUSES.forEach(function(s) {
    statusCounts[s] = active.filter(function(t) { return t.status === s; }).length;
  });

  var slaRate = calcSlaRate(active);
  var slaColor = slaRate >= 90 ? "#10b981" : slaRate >= 75 ? "#f59e0b" : "#ef4444";
  var breaches = active.filter(function(t) { return t.sla_breached && t.status !== "Closed"; });

  // ── Technician workload ────────────────────────────────────────────────────
  var techs = users.filter(function(u) {
    return IT_ROLES.includes(u.role) && u.active;
  });

  var techRows = techs.map(function(t) {
    var assigned = active.filter(function(tk) { return tk.assigned_to === t.id; });
    var open = assigned.filter(function(tk) { return tk.status !== "Closed"; }).length;
    var techMins = sessions
      .filter(function(s) { return s.user_id === t.id && s.ended_at; })
      .reduce(function(sum, s) { return sum + (s.duration_minutes || 0); }, 0);
    return { name: t.name, total: assigned.length, open: open, loggedMins: techMins };
  }).filter(function(t) { return t.total > 0; })
    .sort(function(a, b) { return b.open - a.open; });

  // ── 7-day trend ────────────────────────────────────────────────────────────
  var daily = Array.from({ length: 7 }, function(_, i) {
    var d = new Date(now.getTime() - (6 - i) * 86400000);
    var ds = d.toISOString().slice(0, 10);
    return {
      lbl: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      created: active.filter(function(t) { return t.created_at && t.created_at.slice(0, 10) === ds; }).length,
      closed: active.filter(function(t) { return t.closed_at && t.closed_at.slice(0, 10) === ds; }).length
    };
  });

  // ── Stat card helper — builds one card as a table-safe HTML string ─────────
  function statCard(label, value, color) {
    return '<td style="padding:5px;width:25%;">'
      + '<div style="background:#ffffff;border-radius:8px;border:1px solid #e2e8f0;padding:10px 4px;text-align:center;">'
      + '<div style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:5px;line-height:1.2;">' + label + '</div>'
      + '<div style="font-size:20px;font-weight:800;color:' + color + ';line-height:1;">' + value + '</div>'
      + '</div></td>';
  }

  // ── Breach rows ────────────────────────────────────────────────────────────
  var breachRowsHtml = "";
  if (breaches.length === 0) {
    breachRowsHtml = '<tr><td colspan="4" style="padding:14px;text-align:center;color:#16a34a;font-size:13px;">&#9989; No SLA breaches &#8212; all tickets within target!</td></tr>';
  } else {
    breaches.slice(0, 10).forEach(function(t) {
      var asgn = users.find(function(u) { return u.id === t.assigned_to; });
      var priColor = PRI_COLORS[t.priority] || "#6366f1";
      var priLabel = PRI_LABELS[t.priority] || t.priority;
      var stColor = STATUS_COLORS[t.status] || "#6366f1";
      breachRowsHtml +=
        '<tr style="border-bottom:1px solid #fee2e2;">'
        + '<td style="padding:9px 10px;font-size:12px;color:#1e293b;font-weight:600;">' + (t.title || "—") + '</td>'
        + '<td style="padding:9px 10px;"><span style="background:' + priColor + '22;color:' + priColor + ';border:1px solid ' + priColor + '44;border-radius:5px;padding:2px 7px;font-size:11px;font-weight:700;">' + priLabel + '</span></td>'
        + '<td style="padding:9px 10px;"><span style="background:' + stColor + '22;color:' + stColor + ';border:1px solid ' + stColor + '44;border-radius:5px;padding:2px 7px;font-size:11px;font-weight:700;">' + t.status + '</span></td>'
        + '<td style="padding:9px 10px;font-size:12px;color:#64748b;">' + (asgn ? asgn.name : "Unassigned") + '</td>'
        + '</tr>';
    });
    if (breaches.length > 10) {
      breachRowsHtml += '<tr><td colspan="4" style="padding:8px 10px;font-size:11px;color:#ef4444;text-align:center;">+' + (breaches.length - 10) + ' more breached tickets</td></tr>';
    }
  }

  // ── Tech rows ──────────────────────────────────────────────────────────────
  var techRowsHtml = "";
  if (techRows.length === 0) {
    techRowsHtml = '<tr><td colspan="3" style="padding:14px;text-align:center;color:#94a3b8;font-size:13px;">No technician data yet.</td></tr>';
  } else {
    techRows.forEach(function(t) {
      var barPct = t.total ? Math.min(100, Math.round(t.open / t.total * 100)) : 0;
      techRowsHtml +=
        '<tr style="border-bottom:1px solid #f1f5f9;">'
        + '<td style="padding:10px 12px;font-size:13px;font-weight:600;color:#1e293b;">' + t.name + '</td>'
        + '<td style="padding:10px 12px;font-size:12px;color:#64748b;">'
        +   t.open + ' open / ' + t.total + ' total<br>'
        +   '<div style="background:#e2e8f0;border-radius:4px;height:5px;width:100px;margin-top:4px;">'
        +     '<div style="background:#6366f1;height:5px;border-radius:4px;width:' + barPct + '%;"></div>'
        +   '</div>'
        + '</td>'
        + '<td style="padding:10px 12px;font-size:13px;color:#8b5cf6;font-weight:700;">' + fmtDuration(t.loggedMins) + '</td>'
        + '</tr>';
    });
  }

  // ── Trend rows ─────────────────────────────────────────────────────────────
  var trendRowsHtml = "";
  daily.forEach(function(d) {
    trendRowsHtml +=
      '<tr style="border-bottom:1px solid #f1f5f9;">'
      + '<td style="padding:8px 12px;font-size:12px;color:#475569;font-weight:600;">' + d.lbl + '</td>'
      + '<td style="padding:8px 12px;font-size:14px;font-weight:700;color:#6366f1;text-align:center;">' + d.created + '</td>'
      + '<td style="padding:8px 12px;font-size:14px;font-weight:700;color:#10b981;text-align:center;">' + d.closed + '</td>'
      + '</tr>';
  });

  // ── Final HTML — all concatenation, zero template literals ────────────────
  return '<!DOCTYPE html>'
    + '<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>'
    + '<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">'
    + '<div style="max-width:600px;margin:0 auto;padding:20px 12px;">'

    // Header
    + '<div style="background:linear-gradient(135deg,#020e1f 0%,#062d6b 60%,#0a3d8f 100%);border-radius:14px;padding:24px 20px;margin-bottom:18px;text-align:center;">'
    + '<div style="color:#ffffff;font-size:26px;font-weight:800;margin-bottom:4px;">hoptix</div>'
    + '<div style="font-size:11px;letter-spacing:1px;margin-bottom:14px;color:#7dd3fc;">A.eye technology</div>'
    + '<div style="color:#ffffff;font-size:17px;font-weight:700;margin-bottom:6px;">&#128202; IT Tickets Daily Report</div>'
    + '<div style="color:#7dd3fc;font-size:12px;">' + dateStr + ' &middot; Generated at ' + timeStr + ' PHT</div>'
    + '</div>'

    // Overview — 2 rows of 4 using a proper table, no string slicing
    + '<div style="background:#f8fafc;border-radius:12px;padding:14px;margin-bottom:18px;">'
    + '<div style="font-weight:700;font-size:13px;color:#1e293b;margin-bottom:12px;">&#128200; Overview</div>'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">'
    + '<tr>'
    + statCard("Total Tickets", active.length, "#6366f1")
    + statCard("Open", statusCounts["Open"], "#f59e0b")
    + statCard("In Progress", statusCounts["In Progress"], "#6366f1")
    + statCard("Pending", statusCounts["Pending"], "#0ea5e9")
    + '</tr>'
    + '<tr>'
    + statCard("Escalated", statusCounts["Escalated"], "#ef4444")
    + statCard("Closed", statusCounts["Closed"], "#10b981")
    + statCard("SLA Rate", slaRate + "%", slaColor)
    + statCard("IT Hours", fmtDuration(totalLoggedMins), "#8b5cf6")
    + '</tr>'
    + '</table>'
    + '</div>'

    // SLA Breach
    + '<div style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;margin-bottom:18px;overflow:hidden;">'
    + '<div style="background:' + (breaches.length > 0 ? "#fef2f2" : "#f0fdf4") + ';padding:12px 14px;border-bottom:1px solid ' + (breaches.length > 0 ? "#fecaca" : "#bbf7d0") + ';">'
    + '<span style="font-weight:800;font-size:13px;color:' + (breaches.length > 0 ? "#dc2626" : "#166534") + ';">' + (breaches.length > 0 ? "&#128680;" : "&#9989;") + ' SLA Breach Alerts &mdash; ' + breaches.length + ' ticket' + (breaches.length !== 1 ? "s" : "") + ' breached</span>'
    + '</div>'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">'
    + '<thead><tr style="background:#f8fafc;">'
    + '<th style="padding:9px 10px;text-align:left;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">Title</th>'
    + '<th style="padding:9px 10px;text-align:left;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">Priority</th>'
    + '<th style="padding:9px 10px;text-align:left;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">Status</th>'
    + '<th style="padding:9px 10px;text-align:left;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">Assigned To</th>'
    + '</tr></thead>'
    + '<tbody>' + breachRowsHtml + '</tbody>'
    + '</table></div>'

    // Technician Workload
    + '<div style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;margin-bottom:18px;overflow:hidden;">'
    + '<div style="padding:12px 14px;border-bottom:1px solid #e2e8f0;">'
    + '<span style="font-weight:800;font-size:13px;color:#1e293b;">&#128100; Technician Workload</span>'
    + '</div>'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">'
    + '<thead><tr style="background:#f8fafc;">'
    + '<th style="padding:9px 12px;text-align:left;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">Technician</th>'
    + '<th style="padding:9px 12px;text-align:left;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">Tickets</th>'
    + '<th style="padding:9px 12px;text-align:left;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">IT Hours</th>'
    + '</tr></thead>'
    + '<tbody>' + techRowsHtml + '</tbody>'
    + '</table></div>'

    // 7-Day Trend
    + '<div style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;margin-bottom:18px;overflow:hidden;">'
    + '<div style="padding:12px 14px;border-bottom:1px solid #e2e8f0;">'
    + '<span style="font-weight:800;font-size:13px;color:#1e293b;">&#128197; 7-Day Trend</span>'
    + '</div>'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">'
    + '<thead><tr style="background:#f8fafc;">'
    + '<th style="padding:9px 12px;text-align:left;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">Day</th>'
    + '<th style="padding:9px 12px;text-align:center;font-size:10px;font-weight:700;color:#6366f1;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">Created</th>'
    + '<th style="padding:9px 12px;text-align:center;font-size:10px;font-weight:700;color:#10b981;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">Closed</th>'
    + '</tr></thead>'
    + '<tbody>' + trendRowsHtml + '</tbody>'
    + '</table></div>'

    // Footer
    + '<div style="text-align:center;padding:14px 0;">'
    + '<div style="font-size:11px;color:#94a3b8;">&copy; 2025 Hoptix &middot; A.eye Technology &middot; Auto-generated daily report</div>'
    + '<div style="font-size:10px;color:#cbd5e1;margin-top:4px;">Delivered every day at 1:00 PM Philippine Time</div>'
    + '</div>'

    + '</div></body></html>';
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    const [ticketsRes, usersRes, sessionsRes] = await Promise.all([
      supabase.from("tickets").select("*"),
      supabase.from("users").select("*"),
      supabase.from("time_sessions").select("*")
    ]);

    if (ticketsRes.error) throw new Error("Tickets fetch failed: " + ticketsRes.error.message);
    if (usersRes.error) throw new Error("Users fetch failed: " + usersRes.error.message);

    const tickets = ticketsRes.data || [];
    const users = usersRes.data || [];
    const sessions = sessionsRes.data || [];

    const html = buildHtml(tickets, users, sessions);

    const now = new Date(Date.now() + 8 * 3600000);
    const dateLabel = now.toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila"
    });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });

    await transporter.sendMail({
      from: '"Hoptix Reports" <' + process.env.GMAIL_USER + '>',
      to: RECIPIENT,
      subject: "IT Tickets Daily Report — " + dateLabel,
      html: html
    });

    return res.status(200).json({ success: true, message: "Daily report sent to " + RECIPIENT });

  } catch (err) {
    console.error("daily-report error:", err);
    return res.status(500).json({ error: err.message });
  }
}
