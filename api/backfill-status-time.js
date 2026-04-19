// api/backfill-status-time.js
// ONE-TIME USE: Rebuilds statusTimeLog for all tickets that are missing it.
// Call this once after deploying: GET /api/backfill-status-time
// Protected by a secret key to prevent unauthorized access.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

// Rebuild statusTimeLog from statusHistory timestamps
function buildStatusTimeLog(ticket) {
  var hist = (ticket.status_history || ticket.statusHistory || []).filter(function(h) {
    return h && h.status && h.timestamp;
  });

  if (!hist.length) {
    // No history — create a single entry for current status from createdAt
    return [{
      status: ticket.status,
      enteredAt: ticket.createdAt || new Date().toISOString(),
      exitedAt: ticket.status === "Closed" ? (ticket.closedAt || ticket.updatedAt) : null,
      durationMins: null
    }];
  }

  var log = [];

  for (var i = 0; i < hist.length; i++) {
    var entry = hist[i];
    var nextEntry = hist[i + 1] || null;

    var exitedAt = null;
    var durationMins = null;

    if (nextEntry) {
      exitedAt = nextEntry.timestamp;
      durationMins = parseFloat(
        ((new Date(exitedAt) - new Date(entry.timestamp)) / 60000).toFixed(2)
      );
      if (durationMins < 0) durationMins = 0;
    } else {
      // Last entry = current status
      if (ticket.status === "Closed" && ticket.closedAt) {
        exitedAt = ticket.closedAt;
        durationMins = parseFloat(
          ((new Date(exitedAt) - new Date(entry.timestamp)) / 60000).toFixed(2)
        );
        if (durationMins < 0) durationMins = 0;
      } else {
        exitedAt = null;
        durationMins = null;
      }
    }

    log.push({
      status: entry.status,
      enteredAt: entry.timestamp,
      exitedAt: exitedAt,
      durationMins: durationMins
    });
  }

  return log;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Simple secret key protection
  const secret = req.query.secret || req.body?.secret;
  if (secret !== "hoptix-backfill-2026") {
    return res.status(401).json({ error: "Unauthorized. Add ?secret=hoptix-backfill-2026 to the URL." });
  }

  try {
    const { data: tickets, error } = await supabase.from("tickets").select("*");
    if (error) throw error;

    const all = tickets || [];
    let updated = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < all.length; i++) {
      const ticket = all[i];

      // Skip if already has statusTimeLog with real data
      const existingLog = ticket.status_time_log || ticket.statusTimeLog || [];
      const hasData = existingLog.some(function(e) {
        return e && e.enteredAt;
      });

      if (hasData) {
        skipped++;
        continue;
      }

      // Rebuild from statusHistory
      const newLog = buildStatusTimeLog(ticket);

      const { error: saveErr } = await supabase
        .from("tickets")
        .update({ status_time_log: newLog })
        .eq("id", ticket.id);

      if (saveErr) {
        errors.push(ticket.id + ": " + saveErr.message);
      } else {
        updated++;
      }
    }

    return res.status(200).json({
      success: true,
      total: all.length,
      updated: updated,
      skipped: skipped,
      errors: errors.length ? errors : undefined,
      message: "Backfill complete. " + updated + " tickets updated, " + skipped + " already had data."
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
