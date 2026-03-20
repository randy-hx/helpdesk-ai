import { useState } from "react";
import { supabase } from "./supabase.js";

function toSnakeTicket(t) {
  return {
    id: t.id, title: t.title, description: t.description || "",
    type_id: t.typeId || "", company_id: t.companyId || "",
    client_id: t.clientId || "", location_id: t.locationId || "",
    status: t.status || "Open", priority: t.priority || "medium",
    submitted_by: t.submittedBy || "", assigned_to: t.assignedTo || "",
    external_email: t.externalEmail || "", custom_type_name: t.customTypeName || "",
    sla_deadline: t.slaDeadline || null, sla_breached: t.slaBreached || false,
    time_to_create_mins: t.timeToCreateMins || 0,
    status_history: t.statusHistory || [], conversations: t.conversations || [],
    attachments: t.attachments || [], ai_reason: t.aiReason || "",
    has_unread_reply: t.hasUnreadReply || false, deleted: t.deleted || false,
    closed_at: t.closedAt || null, submitted_at: t.submittedAt || t.createdAt,
    form_opened_at: t.formOpenedAt || t.createdAt,
    created_at: t.createdAt, updated_at: t.updatedAt || t.createdAt
  };
}

export default function Migrate() {
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  function addLog(msg, ok = true) {
    setLog(prev => [...prev, { msg, ok }]);
  }

  async function runMigration() {
    setRunning(true);
    setLog([]);

    try {
      // Users
      const users = JSON.parse(localStorage.getItem("hd_users") || "[]");
      addLog(`Found ${users.length} users`);
      for (const u of users) {
        await supabase.from("users").upsert({
          id: u.id, name: u.name, email: u.email, role: u.role,
          company_id: u.companyId || "", phone: u.phone || "",
          dept: u.dept || "", active: u.active,
          created_at: u.createdAt, last_login: u.lastLogin || null
        });
      }
      addLog(`✅ Migrated ${users.length} users`);

      // Passwords
      const passwords = JSON.parse(localStorage.getItem("hd_passwords") || "{}");
      for (const [userId, password] of Object.entries(passwords)) {
        await supabase.from("passwords").upsert({ user_id: userId, password });
      }
      // Default password for users without one
      for (const u of users) {
        if (!passwords[u.id]) {
          await supabase.from("passwords").upsert({ user_id: u.id, password: "password123" });
        }
      }
      addLog(`✅ Migrated passwords`);

      // Companies
      const companies = JSON.parse(localStorage.getItem("hd_companies") || "[]");
      addLog(`Found ${companies.length} companies`);
      for (const c of companies) {
        await supabase.from("companies").upsert({
          id: c.id, name: c.name, domain: c.domain || "",
          address: c.address || "", phone: c.phone || "",
          industry: c.industry || "", size: c.size || "",
          created_at: c.createdAt || new Date().toISOString()
        });
      }
      addLog(`✅ Migrated ${companies.length} companies`);

      // Clients
      const clients = JSON.parse(localStorage.getItem("hd_clients") || "[]");
      addLog(`Found ${clients.length} clients`);
      for (const c of clients) {
        await supabase.from("clients").upsert({
          id: c.id, name: c.name, email: c.email || "",
          phone: c.phone || "", industry: c.industry || "",
          company_id: c.companyId || "", locations: c.locations || []
        });
      }
      addLog(`✅ Migrated ${clients.length} clients`);

      // Ticket Types
      const ticketTypes = JSON.parse(localStorage.getItem("hd_ticketTypes") || "[]");
      addLog(`Found ${ticketTypes.length} ticket types`);
      for (const t of ticketTypes) {
        await supabase.from("ticket_types").upsert({
          id: t.id, name: t.name, priority: t.priority,
          sla_hours: t.slaHours, color: t.color || "#6366f1",
          keywords: t.keywords || [], default_assignee: t.defaultAssignee || ""
        });
      }
      addLog(`✅ Migrated ${ticketTypes.length} ticket types`);

      // Tickets
      const tickets = JSON.parse(localStorage.getItem("hd_tickets") || "[]");
      addLog(`Found ${tickets.length} tickets`);
      for (const t of tickets) {
        await supabase.from("tickets").upsert(toSnakeTicket(t));
      }
      addLog(`✅ Migrated ${tickets.length} tickets`);

      // Logs
      const logs = JSON.parse(localStorage.getItem("hd_logs") || "[]");
      addLog(`Found ${logs.length} log entries`);
      // Insert in batches of 50
      for (let i = 0; i < logs.length; i += 50) {
        const batch = logs.slice(i, i + 50).map(l => ({
          id: l.id, action: l.action, user_id: l.userId || "",
          target: l.target || "", detail: l.detail || "",
          timestamp: l.timestamp
        }));
        await supabase.from("logs").upsert(batch);
      }
      addLog(`✅ Migrated ${logs.length} log entries`);

      // Schedules
      const schedules = JSON.parse(localStorage.getItem("hd_schedules") || "{}");
      for (const [userId, sch] of Object.entries(schedules)) {
        await supabase.from("schedules").upsert({
          user_id: userId, days: sch.days,
          start_hour: sch.startHour, end_hour: sch.endHour
        });
      }
      addLog(`✅ Migrated schedules`);

      addLog("🎉 Migration complete! All data is now in Supabase.", true);
      setDone(true);
    } catch (err) {
      addLog("❌ Error: " + err.message, false);
    }

    setRunning(false);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 32, maxWidth: 600, width: "100%", boxShadow: "0 4px 20px rgba(0,0,0,.1)" }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: "#1e293b", marginBottom: 8 }}>📦 Data Migration</div>
        <div style={{ fontSize: 13, color: "#64748b", marginBottom: 24, lineHeight: 1.6 }}>
          This will copy all your existing data from this browser's localStorage into Supabase so it's shared across all users and devices. Run this once, then the app will use Supabase going forward.
        </div>

        {!done && (
          <button
            onClick={runMigration}
            disabled={running}
            style={{ width: "100%", padding: "12px", background: running ? "#a5b4fc" : "#6366f1", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: running ? "not-allowed" : "pointer", marginBottom: 20 }}
          >
            {running ? "⏳ Migrating..." : "🚀 Start Migration"}
          </button>
        )}

        {done && (
          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: 16, marginBottom: 20, fontSize: 13, color: "#166534", fontWeight: 600 }}>
            ✅ Migration complete! You can now close this page and use the app normally.
            <br /><br />
            <a href="/" style={{ color: "#6366f1", fontWeight: 700 }}>→ Go to the app</a>
          </div>
        )}

        {log.length > 0 && (
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, fontFamily: "monospace", fontSize: 12 }}>
            {log.map((l, i) => (
              <div key={i} style={{ color: l.ok ? "#166534" : "#dc2626", marginBottom: 4 }}>{l.msg}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
