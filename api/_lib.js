// api/_lib.js — shared server helpers (files starting with "_" are NOT deployed as endpoints)
// Needs these Vercel environment variables:
//   VITE_SUPABASE_URL           (already set)
//   SUPABASE_SERVICE_ROLE_KEY   (NEW — Supabase → Project Settings → API → service_role secret)
// NEVER prefix the service role key with VITE_ — that would expose it to the browser.

import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

export const STAFF_ROLES = ["admin", "it_manager", "it_technician"];
export const MANAGER_ROLES = ["admin", "it_manager"];

let _admin = null;
export function getAdmin() {
  if (_admin) return _admin;
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Server not configured: SUPABASE_SERVICE_ROLE_KEY is missing in Vercel.");
  _admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _admin;
}

// Verifies the caller's Supabase sign-in token (signed by Supabase, cannot be forged)
// and returns their row from the users table. Returns null if not signed in / inactive.
export async function getCaller(req) {
  const h = req.headers["authorization"] || req.headers["Authorization"] || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return null;
  const admin = getAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data || !data.user) return null;
  const r = await admin.from("users").select("*").eq("auth_id", data.user.id).maybeSingle();
  if (r.error || !r.data || !r.data.active) return null;
  return r.data;
}

export async function requireCaller(req, res, roles) {
  let caller = null;
  try { caller = await getCaller(req); } catch (e) { res.status(500).json({ error: e.message }); return null; }
  if (!caller) { res.status(401).json({ error: "Please sign in again." }); return null; }
  if (roles && roles.indexOf(caller.role) < 0) { res.status(403).json({ error: "You do not have permission to do this." }); return null; }
  return caller;
}

// For cron jobs: Vercel sends "Authorization: Bearer <CRON_SECRET>" automatically when CRON_SECRET is set.
export function cronAllowed(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // not configured yet — keep old behaviour
  const h = req.headers["authorization"] || "";
  return h === "Bearer " + secret || (req.query && req.query.key === secret);
}

export async function sendMail(to, subject, text) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error("Gmail credentials not configured");
  const transporter = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: user, pass: pass } });
  const toArr = Array.isArray(to) ? to : [to];
  const info = await transporter.sendMail({
    from: '"Hoptix IT Helpdesk" <' + user + ">",
    replyTo: '"Hoptix IT Helpdesk" <' + user + ">",
    to: toArr.join(", "),
    subject: subject || "(no subject)",
    text: text || ""
  });
  return info.messageId;
}

export function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(14);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += chars[bytes[i] % chars.length];
  return out + "!7";
}

export function newId() {
  return "id_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
}

export function siteOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return proto + "://" + host;
}
