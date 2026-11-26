// api/auth.js — all account actions that need server-side privileges.
// Passwords are handled ONLY by Supabase Auth (stored as one-way bcrypt hashes).
//
// POST /api/auth  { action: "signup", name, email, password, phone, dept }          — public
// POST /api/auth  { action: "forgot", email }                                       — public
// POST /api/auth  { action: "create_user", user:{name,email,role,companyId,phone,dept,active} } — manager
// POST /api/auth  { action: "set_password", userId, password }                      — manager
// POST /api/auth  { action: "set_email", userId, email }                            — manager
// POST /api/auth  { action: "delete_user", userId }                                 — manager
// GET  /api/auth?action=migrate&key=<MIGRATION_SECRET>                              — one-time migration
// GET  /api/auth?action=migrate_attachments&key=<MIGRATION_SECRET>                  — moves old attachments to Storage

import { getAdmin, requireCaller, sendMail, randomPassword, newId, siteOrigin, MANAGER_ROLES } from "./_lib.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function findAuthUserByEmail(admin, email) {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: page, perPage: 200 });
    if (error || !data || !data.users || !data.users.length) return null;
    const hit = data.users.find(function (u) { return (u.email || "").toLowerCase() === target; });
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function getUserRow(admin, userId) {
  const r = await admin.from("users").select("*").eq("id", userId).maybeSingle();
  return r.data || null;
}

// ── One-time migration: move every user to Supabase Auth ───────────────────
async function migrate(req, res) {
  const secret = process.env.MIGRATION_SECRET;
  if (!secret || req.query.key !== secret) return res.status(401).json({ error: "Wrong or missing key." });
  const admin = getAdmin();
  const usersR = await admin.from("users").select("*").is("auth_id", null).limit(40);
  if (usersR.error) return res.status(500).json({ error: "Could not read users (did you run SQL step 1?): " + usersR.error.message });
  const todo = usersR.data || [];
  if (!todo.length) return res.status(200).json({ done: true, message: "All users are migrated. You can now run SQL step 2." });

  let pwMap = {};
  const pwR = await admin.from("passwords").select("user_id,password");
  if (!pwR.error && pwR.data) pwR.data.forEach(function (p) { pwMap[p.user_id] = p.password; });

  const results = [];
  for (const u of todo) {
    const email = (u.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) { results.push({ email: u.email, status: "SKIPPED — invalid email" }); continue; }
    let pw = pwMap[u.id];
    let needsReset = false;
    // Missing, too short, or the publicly-known default → random password; user must use "Forgot password"
    if (!pw || pw.length < 8 || pw === "password123") { pw = randomPassword(); needsReset = true; }
    let authId = null;
    const c = await admin.auth.admin.createUser({ email: email, password: pw, email_confirm: true });
    if (c.error) {
      const existing = await findAuthUserByEmail(admin, email);
      if (!existing) { results.push({ email: email, status: "FAILED — " + c.error.message }); continue; }
      authId = existing.id;
      await admin.auth.admin.updateUserById(authId, { password: pw, email_confirm: true });
    } else {
      authId = c.data.user.id;
    }
    const up = await admin.from("users").update({ auth_id: authId, email: email }).eq("id", u.id);
    if (up.error) { results.push({ email: email, status: "FAILED linking — " + up.error.message }); continue; }
    results.push({ email: email, status: needsReset ? "MIGRATED — must use 'Forgot password' to set a new password" : "MIGRATED — same password as before" });
  }
  const left = await admin.from("users").select("id", { count: "exact", head: true }).is("auth_id", null);
  return res.status(200).json({
    done: (left.count || 0) === 0,
    remaining: left.count || 0,
    message: (left.count || 0) === 0 ? "All users are migrated. You can now run SQL step 2." : "Refresh this page to continue migrating the rest.",
    results: results
  });
}

// ── One-time: move base64 attachments out of the tickets table into Storage ─
// (Huge base64 images/videos inside ticket rows are what exhausted the Disk IO budget.)
async function migrateAttachments(req, res) {
  const secret = process.env.MIGRATION_SECRET;
  if (!secret || req.query.key !== secret) return res.status(401).json({ error: "Wrong or missing key." });
  const admin = getAdmin();
  const started = Date.now();
  let idsR = await admin.rpc("hoptix_old_attachment_ids");
  if (idsR.error) idsR = await admin.from("tickets").select("id").order("id");
  if (idsR.error) return res.status(500).json({ error: idsR.error.message });
  if (idsR.data && idsR.data.length && typeof idsR.data[0] !== "object") idsR.data = idsR.data.map(function (x) { return { id: x }; });
  let checked = 0, ticketsMoved = 0, filesMoved = 0, timedOut = false;
  const errors = [];
  for (const row of idsR.data || []) {
    if (Date.now() - started > 7000) { timedOut = true; break; }
    const r = await admin.from("tickets").select("attachments").eq("id", row.id).maybeSingle();
    checked++;
    const atts = r.data && Array.isArray(r.data.attachments) ? r.data.attachments : [];
    if (!atts.some(function (a) { return a && a.dataUrl; })) continue;
    const out = [];
    let failed = false;
    for (const a of atts) {
      if (!a || !a.dataUrl) { if (a) out.push(a); continue; }
      const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(a.dataUrl);
      if (!m) { out.push(a); continue; }
      const type = m[1] || a.type || "application/octet-stream";
      const buf = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
      const safe = String(a.name || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
      const path = "migrated/" + row.id + "/" + (a.id || newId()) + "_" + safe;
      const up = await admin.storage.from("ticket-attachments").upload(path, buf, { contentType: type, upsert: true });
      if (up.error) { failed = true; errors.push(row.id + ": " + up.error.message); break; }
      out.push({ id: a.id || newId(), name: a.name || safe, type: type, size: a.size || buf.length, path: path });
      filesMoved++;
    }
    if (failed) continue;
    const upd = await admin.from("tickets").update({ attachments: out }).eq("id", row.id);
    if (upd.error) { errors.push(row.id + ": " + upd.error.message); continue; }
    ticketsMoved++;
  }
  const done = !timedOut && ticketsMoved === 0 && errors.length === 0;
  return res.status(200).json({
    done: done,
    message: done ? "All attachments are in Storage. Nothing left to move." : (errors.length ? "Some files failed — see errors." : "Refresh this page to continue."),
    ticketsChecked: checked, ticketsMoved: ticketsMoved, filesMoved: filesMoved,
    errors: errors.length ? errors : undefined
  });
}

// ── Public: self sign-up (account starts inactive until approved) ──────────
async function signup(req, res, body) {
  const admin = getAdmin();
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!name) return res.status(400).json({ error: "Full name is required." });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid email." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  const exists = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (exists.data) return res.status(400).json({ error: "An account with this email already exists." });
  const c = await admin.auth.admin.createUser({ email: email, password: password, email_confirm: true });
  if (c.error) return res.status(400).json({ error: c.error.message.indexOf("already") >= 0 ? "An account with this email already exists." : c.error.message });
  const co = await admin.from("companies").select("id").limit(1);
  const row = {
    id: newId(), name: name, email: email, role: "end_user",
    company_id: co.data && co.data[0] ? co.data[0].id : null,
    phone: String(body.phone || "").trim(), dept: String(body.dept || "").trim(),
    active: false, created_at: new Date().toISOString(), last_login: null, auth_id: c.data.user.id
  };
  const ins = await admin.from("users").insert(row);
  if (ins.error) { await admin.auth.admin.deleteUser(c.data.user.id); return res.status(500).json({ error: "Could not create account: " + ins.error.message }); }
  try {
    await sendMail(process.env.ADMIN_EMAIL || "randy@omnisecurityinc.com", "🆕 New User Signup — Pending Approval",
      "A new user has registered on Hoptix and is awaiting your approval.\n\nName: " + name + "\nEmail: " + email +
      "\nPhone: " + (row.phone || "—") + "\nDepartment: " + (row.dept || "—") +
      "\nRegistered At: " + new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }) + " PHT\n\nLog in to the Hoptix admin panel → Users page to approve or reject this account.");
  } catch (e) { console.error("signup notify failed", e); }
  return res.status(200).json({ ok: true });
}

// ── Public: forgot password (always answers OK so emails can't be probed) ──
async function forgot(req, res, body) {
  const admin = getAdmin();
  const email = String(body.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(200).json({ ok: true });
  try {
    const row = await admin.from("users").select("id,name,auth_id").eq("email", email).maybeSingle();
    if (row.data && row.data.auth_id) {
      const link = await admin.auth.admin.generateLink({ type: "recovery", email: email, options: { redirectTo: siteOrigin(req) + "/" } });
      const url = link.data && link.data.properties ? link.data.properties.action_link : null;
      if (url) {
        await sendMail(email, "🔑 Reset your Hoptix password",
          "Hi " + (row.data.name || "") + ",\n\nWe received a request to reset your Hoptix IT Helpdesk password.\n\nOpen this link to choose a new password (it expires in 1 hour):\n" + url +
          "\n\nIf you did not request this, you can ignore this email.\n\n— The Hoptix IT Team");
      }
    }
  } catch (e) { console.error("forgot failed", e); }
  return res.status(200).json({ ok: true });
}

// ── Manager actions ────────────────────────────────────────────────────────
async function createUser(req, res, body, caller) {
  const admin = getAdmin();
  const u = body.user || {};
  const email = String(u.email || "").trim().toLowerCase();
  const name = String(u.name || "").trim();
  if (!name || !EMAIL_RE.test(email)) return res.status(400).json({ error: "Name and a valid email are required." });
  const role = String(u.role || "end_user");
  if (role === "admin" && caller.role !== "admin") return res.status(403).json({ error: "Only an Administrator can create another Administrator." });
  const exists = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (exists.data) return res.status(400).json({ error: "An account with this email already exists." });
  const tempPw = randomPassword();
  const c = await admin.auth.admin.createUser({ email: email, password: tempPw, email_confirm: true });
  if (c.error) return res.status(400).json({ error: c.error.message });
  const row = {
    id: u.id || newId(), name: name, email: email, role: role, company_id: u.companyId || null,
    phone: String(u.phone || ""), dept: String(u.dept || ""), active: u.active !== false,
    created_at: new Date().toISOString(), last_login: null, auth_id: c.data.user.id
  };
  const ins = await admin.from("users").insert(row);
  if (ins.error) { await admin.auth.admin.deleteUser(c.data.user.id); return res.status(500).json({ error: ins.error.message }); }
  let emailSent = false;
  try {
    await sendMail(email, "🎉 Your Hoptix IT Helpdesk account is ready",
      "Hi " + name + ",\n\nAn account has been created for you on the Hoptix IT Helpdesk portal.\n\n📧 Email: " + email +
      "\n🔑 Temporary Password: " + tempPw + "\n\n⚠️ Please sign in and change your password immediately (Profile → Password).\n\n— The Hoptix IT Team");
    emailSent = true;
  } catch (e) { console.error("welcome email failed", e); }
  return res.status(200).json({ ok: true, emailSent: emailSent, user: row });
}

async function setPassword(req, res, body, caller) {
  const admin = getAdmin();
  const pw = String(body.password || "");
  if (pw.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  const row = await getUserRow(admin, body.userId);
  if (!row || !row.auth_id) return res.status(404).json({ error: "User not found." });
  if (row.role === "admin" && caller.role !== "admin") return res.status(403).json({ error: "Only an Administrator can reset an Administrator's password." });
  const r = await admin.auth.admin.updateUserById(row.auth_id, { password: pw });
  if (r.error) return res.status(400).json({ error: r.error.message });
  return res.status(200).json({ ok: true });
}

async function setEmail(req, res, body, caller) {
  const admin = getAdmin();
  const email = String(body.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid email." });
  const row = await getUserRow(admin, body.userId);
  if (!row) return res.status(404).json({ error: "User not found." });
  if (row.role === "admin" && caller.role !== "admin") return res.status(403).json({ error: "Only an Administrator can change an Administrator's email." });
  const dup = await admin.from("users").select("id").eq("email", email).neq("id", row.id).maybeSingle();
  if (dup.data) return res.status(400).json({ error: "Another account already uses this email." });
  if (row.auth_id) {
    const r = await admin.auth.admin.updateUserById(row.auth_id, { email: email, email_confirm: true });
    if (r.error) return res.status(400).json({ error: r.error.message });
  }
  const up = await admin.from("users").update({ email: email }).eq("id", row.id);
  if (up.error) return res.status(500).json({ error: up.error.message });
  return res.status(200).json({ ok: true });
}

async function deleteUser(req, res, body, caller) {
  const admin = getAdmin();
  const row = await getUserRow(admin, body.userId);
  if (!row) return res.status(200).json({ ok: true });
  if (row.id === caller.id) return res.status(400).json({ error: "You cannot delete your own account." });
  if (row.role === "admin" && caller.role !== "admin") return res.status(403).json({ error: "Only an Administrator can delete an Administrator." });
  const del = await admin.from("users").delete().eq("id", row.id);
  if (del.error) return res.status(500).json({ error: del.error.message });
  if (row.auth_id) await admin.auth.admin.deleteUser(row.auth_id);
  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET" && req.query && req.query.action === "migrate") return await migrate(req, res);
    if (req.method === "GET" && req.query && req.query.action === "migrate_attachments") return await migrateAttachments(req, res);
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const action = body.action;
    if (action === "signup") return await signup(req, res, body);
    if (action === "forgot") return await forgot(req, res, body);
    const caller = await requireCaller(req, res, MANAGER_ROLES);
    if (!caller) return;
    if (action === "create_user") return await createUser(req, res, body, caller);
    if (action === "set_password") return await setPassword(req, res, body, caller);
    if (action === "set_email") return await setEmail(req, res, body, caller);
    if (action === "delete_user") return await deleteUser(req, res, body, caller);
    return res.status(400).json({ error: "Unknown action" });
  } catch (e) {
    console.error("api/auth error", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
