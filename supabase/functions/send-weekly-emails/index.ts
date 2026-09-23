// send-weekly-emails — called by pg_cron:
//   instructor-reminder  Sundays 10:00 UTC (job "instructor-schedule-reminder")
//   owner-summary        Mondays 07:00 UTC (job "owner-weekly-summary")
//
// Brought into this repo on 2026-09-23 (it previously existed only as deployed
// version 3). Changes from that version, found in the database audit:
//   * It had no authentication, and its response listed instructors' names and
//     email addresses. It now requires the CRON_SECRET the cron jobs send, and
//     the response carries counts only.
//   * It filtered studios on `is_active`, a column that does not exist (it is
//     `active`), so it found no studios and nothing was ever sent.
//   * The owner lookup asked for role 'owner', which no one has; it is 'admin'.
//   * "Revenue" added the class list price for every booking — pack credits,
//     memberships and comps included — which overstated takings. Replaced with
//     "Checked in", a real count now that check-in exists.

import { Resend } from "npm:resend";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const resend = new Resend(Deno.env.get("RESEND_API_KEY") as string);
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") as string;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;
const CRON_SECRET = Deno.env.get("CRON_SECRET") as string;

// ─── Branding (copied from send-email) ───

interface StudioBrand {
  name: string;
  slug: string;
  from: string;
  siteUrl: string;
  adminUrl: string;
  colors: {
    primary: string;
    primaryText: string;
    accent: string;
    accentText: string;
    bg: string;
    surface: string;
    border: string;
    footer: string;
    footerText: string;
    footerAccent: string;
    bodyText: string;
    headingText: string;
  };
}

const FALLBACK_BRAND: StudioBrand = {
  name: "Forma",
  slug: "forma",
  from: "Forma <admin@useforma.co.uk>",
  siteUrl: "https://useforma.co.uk",
  adminUrl: "https://useforma.co.uk",
  colors: {
    primary: "#000000", primaryText: "#FFFFFF", accent: "#000000",
    accentText: "#FFFFFF", bg: "#F5F5F5", surface: "#FFFFFF",
    border: "#E5E5E5", footer: "#000000", footerText: "#999999",
    footerAccent: "#FFFFFF", bodyText: "#666666", headingText: "#000000",
  },
};

interface StudioRow {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  admin_domain: string | null;
  email_from: string | null;
  branding: Record<string, unknown> | null;
}

function buildBrand(studio: StudioRow): StudioBrand {
  // Branding keeps colours under `colors` (as send-email reads them).
  const branding = (studio.branding || {}) as Record<string, unknown>;
  const b = ((branding.colors as Record<string, string>) || branding) as Record<string, string>;
  const domain = studio.domain || "useforma.co.uk";
  const emailFrom = studio.email_from || `${studio.slug}@useforma.co.uk`;
  const hasColors = b.cocoa || b.primary || b.gold || b.accent;

  const base = {
    name: studio.name,
    slug: studio.slug,
    from: `${studio.name} <${emailFrom}>`,
    siteUrl: `https://${domain}`,
    adminUrl: `https://${studio.admin_domain || `admin.${domain}`}`,
  };

  if (!hasColors) {
    return { ...base, colors: FALLBACK_BRAND.colors };
  }

  return {
    ...base,
    colors: {
      primary: b.cocoa || b.primary || FALLBACK_BRAND.colors.primary,
      primaryText: b.wheat || b.primaryText || FALLBACK_BRAND.colors.primaryText,
      accent: b.gold || b.accent || FALLBACK_BRAND.colors.accent,
      accentText: b.cocoa || b.accentText || FALLBACK_BRAND.colors.accentText,
      bg: b.cream || b.bg || FALLBACK_BRAND.colors.bg,
      surface: FALLBACK_BRAND.colors.surface,
      border: b.sand || b.border || FALLBACK_BRAND.colors.border,
      footer: b.charcoal || b.footer || FALLBACK_BRAND.colors.footer,
      footerText: b.warmGrey || b.footerText || FALLBACK_BRAND.colors.footerText,
      footerAccent: b.gold || b.footerAccent || FALLBACK_BRAND.colors.footerAccent,
      bodyText: b.warmGrey || b.bodyText || FALLBACK_BRAND.colors.bodyText,
      headingText: b.cocoa || b.headingText || FALLBACK_BRAND.colors.headingText,
    },
  };
}

// ─── Email layout helpers ───

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function layout(content: string, brand: StudioBrand): string {
  const c = brand.colors;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background-color:${c.bg};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:${c.bg};">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
        <tr><td align="center" style="padding:24px 0 20px;background-color:${c.primary};border-radius:16px 16px 0 0;">
          <h1 style="margin:0;font-size:22px;font-weight:600;color:${c.primaryText};letter-spacing:0.06em;text-transform:uppercase;">${esc(brand.name)}</h1>
        </td></tr>
        <tr><td style="padding:32px 28px;background-color:${c.surface};border-left:1px solid ${c.border};border-right:1px solid ${c.border};">
          ${content}
        </td></tr>
        <tr><td align="center" style="padding:20px 28px;background-color:${c.footer};border-radius:0 0 16px 16px;">
          <p style="margin:0;font-size:12px;color:${c.footerText};line-height:1.5;">
            ${esc(brand.name)}<br/><a href="${brand.siteUrl}" style="color:${c.footerAccent};text-decoration:none;">${brand.siteUrl.replace("https://", "")}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function ctaButton(href: string, label: string, brand: StudioBrand): string {
  const c = brand.colors;
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td align="center">
    <a href="${href}" style="display:inline-block;padding:12px 32px;background-color:${c.accent};color:${c.accentText};font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;text-decoration:none;border-radius:50px;">${label}</a>
  </td></tr></table>`;
}

function statBlock(label: string, value: string, change?: string, brand?: StudioBrand): string {
  const c = brand?.colors || FALLBACK_BRAND.colors;
  const changeHtml = change
    ? `<div style="font-size:11px;color:${change.startsWith("+") || change.startsWith("↑") ? "#22c55e" : change.startsWith("-") || change.startsWith("↓") ? "#ef4444" : c.bodyText};margin-top:2px;">${change}</div>`
    : "";
  return `<td align="center" style="padding:8px 12px;">
    <div style="font-size:22px;font-weight:700;color:${c.headingText};">${value}</div>
    <div style="font-size:11px;color:${c.bodyText};text-transform:uppercase;letter-spacing:0.06em;margin-top:4px;">${label}</div>
    ${changeHtml}
  </td>`;
}

// ─── Date helpers ───

function mondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const jsDay = d.getDay();
  const offset = jsDay === 0 ? -6 : 1 - jsDay;
  d.setDate(d.getDate() + offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

function sundayOfWeek(monday: Date): Date {
  const d = new Date(monday);
  d.setDate(d.getDate() + 6);
  return d;
}

function dateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}

function pctChange(curr: number, prev: number): string {
  if (prev === 0) return curr > 0 ? "↑ new" : "–";
  const pct = Math.round(((curr - prev) / prev) * 100);
  if (pct > 0) return `↑ ${pct}%`;
  if (pct < 0) return `↓ ${Math.abs(pct)}%`;
  return "– same";
}

// ─── Supabase client ───

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function activeStudios(supabase: ReturnType<typeof getSupabase>): Promise<StudioRow[]> {
  const { data, error } = await supabase
    .from("studios")
    .select("id, name, slug, domain, admin_domain, email_from, branding")
    .eq("active", true);
  if (error) throw new Error(`Failed to load studios: ${error.message}`);
  return (data ?? []) as StudioRow[];
}

// ─── Instructor reminder ───

async function sendInstructorReminders() {
  const supabase = getSupabase();
  let sent = 0;
  let failed = 0;

  const studios = await activeStudios(supabase);

  const today = new Date();
  const nextMonday = mondayOfWeek(today);
  nextMonday.setDate(nextMonday.getDate() + 7);
  const nextSunday = sundayOfWeek(nextMonday);

  for (const studio of studios) {
    const brand = buildBrand(studio);

    const { data: instructors } = await supabase
      .from("instructors")
      .select("id, name, profile_id")
      .eq("studio_id", studio.id);

    if (!instructors || instructors.length === 0) continue;

    const { data: slots } = await supabase
      .from("schedule")
      .select("instructor_id")
      .eq("studio_id", studio.id)
      .eq("is_active", true);

    const instructorsWithSlots = new Set(
      (slots || []).map((s: { instructor_id: string }) => s.instructor_id)
    );

    const { data: adminMembership } = await supabase
      .from("studio_memberships")
      .select("profiles(full_name)")
      .eq("studio_id", studio.id)
      .eq("role", "admin")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const adminName =
      (adminMembership?.profiles as unknown as { full_name: string } | null)?.full_name || "your studio admin";

    for (const instructor of instructors) {
      if (instructorsWithSlots.has(instructor.id)) continue;
      if (!instructor.profile_id) continue;

      const { data: profile } = await supabase
        .from("profiles")
        .select("email")
        .eq("id", instructor.profile_id)
        .single();

      if (!profile?.email) continue;

      const firstName = instructor.name.split(" ")[0];
      const weekStr = `${formatDate(nextMonday)} – ${formatDate(nextSunday)}`;

      const html = layout(`
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:${brand.colors.headingText};">
          Hi ${esc(firstName)},
        </h2>
        <p style="margin:0 0 16px;font-size:14px;color:${brand.colors.bodyText};line-height:1.6;">
          You don't have any classes scheduled for next week (${weekStr}) at ${esc(brand.name)}.
        </p>
        <p style="margin:0 0 4px;font-size:14px;color:${brand.colors.bodyText};line-height:1.6;">
          If this isn't right, please ask ${esc(adminName)} to update the timetable.
        </p>
      `, brand);

      const { error } = await resend.emails.send({
        from: brand.from,
        to: [profile.email],
        subject: `No classes next week — ${brand.name}`,
        html,
      });
      if (error) {
        failed++;
        console.error(`[send-weekly-emails] Reminder failed for instructor ${instructor.id}:`, error);
      } else {
        sent++;
      }
    }
  }

  return { sent, failed };
}

// ─── Owner weekly summary ───

async function sendOwnerSummaries() {
  const supabase = getSupabase();
  let sent = 0;
  let failed = 0;

  const studios = await activeStudios(supabase);

  const today = new Date();
  const thisMonday = mondayOfWeek(today);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(lastMonday.getDate() - 7);
  const lastSunday = sundayOfWeek(lastMonday);

  const prevMonday = new Date(lastMonday);
  prevMonday.setDate(prevMonday.getDate() - 7);
  const prevSunday = sundayOfWeek(prevMonday);

  for (const studio of studios) {
    const brand = buildBrand(studio);
    const sid = studio.id;

    // Last week bookings
    const { data: lastWeekBookings } = await supabase
      .from("bookings")
      .select("id, profile_id, status, attendance_status, schedule(classes(name))")
      .eq("studio_id", sid)
      .gte("date", dateStr(lastMonday))
      .lte("date", dateStr(lastSunday));

    const lwAll = lastWeekBookings || [];
    const lwConfirmed = lwAll.filter((b: { status: string }) => b.status === "confirmed");
    const lwCancelled = lwAll.filter((b: { status: string }) => b.status === "cancelled");

    const totalBookings = lwConfirmed.length;
    const uniqueAttendees = new Set(lwConfirmed.map((b: { profile_id: string }) => b.profile_id)).size;
    const checkedIn = lwConfirmed.filter((b: { attendance_status: string | null }) => b.attendance_status === "attended").length;
    const cancellationRate = lwAll.length > 0 ? Math.round((lwCancelled.length / lwAll.length) * 100) : 0;

    // Previous week (comparison)
    const { data: prevWeekBookings } = await supabase
      .from("bookings")
      .select("id, profile_id, status, attendance_status")
      .eq("studio_id", sid)
      .gte("date", dateStr(prevMonday))
      .lte("date", dateStr(prevSunday));

    const pwConfirmed = (prevWeekBookings || []).filter((b: { status: string }) => b.status === "confirmed");
    const prevBookings = pwConfirmed.length;
    const prevAttendees = new Set(pwConfirmed.map((b: { profile_id: string }) => b.profile_id)).size;
    const prevCheckedIn = pwConfirmed.filter((b: { attendance_status: string | null }) => b.attendance_status === "attended").length;

    // Top class
    const classCounts: Record<string, { name: string; count: number }> = {};
    for (const b of lwConfirmed) {
      const sched = b.schedule as unknown as { classes: { name?: string } } | null;
      const name = sched?.classes?.name;
      if (!name) continue;
      if (!classCounts[name]) classCounts[name] = { name, count: 0 };
      classCounts[name].count++;
    }
    const topClass = Object.values(classCounts).sort((a, b) => b.count - a.count)[0] || null;

    // This week outlook
    const { data: thisWeekSlots } = await supabase
      .from("schedule")
      .select("id, classes(capacity)")
      .eq("studio_id", sid)
      .eq("is_active", true);

    const classesScheduled = (thisWeekSlots || []).length;
    let totalCapacity = 0;
    for (const slot of (thisWeekSlots || [])) {
      const cls = slot.classes as unknown as { capacity: number } | null;
      totalCapacity += cls?.capacity || 10;
    }

    const c = brand.colors;
    const weekStr = `${formatDate(lastMonday)} – ${formatDate(lastSunday)}`;

    const html = layout(`
      <h2 style="margin:0 0 4px;font-size:20px;font-weight:600;color:${c.headingText};">
        Weekly Summary
      </h2>
      <p style="margin:0 0 20px;font-size:13px;color:${c.bodyText};">
        ${weekStr}
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${c.border};border-radius:12px;overflow:hidden;margin-bottom:20px;">
        <tr>
          ${statBlock("Bookings", String(totalBookings), pctChange(totalBookings, prevBookings), brand)}
          ${statBlock("Attendees", String(uniqueAttendees), pctChange(uniqueAttendees, prevAttendees), brand)}
          ${statBlock("Checked in", String(checkedIn), pctChange(checkedIn, prevCheckedIn), brand)}
        </tr>
      </table>

      <p style="margin:0 0 16px;font-size:13px;color:${c.bodyText};">
        Cancellation rate: <strong style="color:${c.headingText};">${cancellationRate}%</strong>
        ${topClass ? ` &middot; Top class: <strong style="color:${c.headingText};">${esc(topClass.name)}</strong> (${topClass.count} bookings)` : ""}
      </p>

      <div style="padding:14px 16px;background-color:${c.bg};border-radius:10px;margin-bottom:20px;">
        <p style="margin:0;font-size:13px;font-weight:600;color:${c.headingText};">
          This week
        </p>
        <p style="margin:4px 0 0;font-size:13px;color:${c.bodyText};">
          ${classesScheduled} classes scheduled &middot; ${totalCapacity} total spots
        </p>
      </div>

      ${ctaButton(brand.adminUrl + "/dashboard", "View dashboard", brand)}
    `, brand);

    const { data: adminMembers } = await supabase
      .from("studio_memberships")
      .select("profiles(email)")
      .eq("studio_id", sid)
      .eq("role", "admin");

    for (const member of (adminMembers || [])) {
      const profile = member.profiles as unknown as { email: string } | null;
      if (!profile?.email) continue;

      const { error } = await resend.emails.send({
        from: brand.from,
        to: [profile.email],
        subject: `Weekly summary — ${brand.name}`,
        html,
      });
      if (error) {
        failed++;
        console.error(`[send-weekly-emails] Summary failed for studio ${sid}:`, error);
      } else {
        sent++;
      }
    }
  }

  return { sent, failed };
}

// ─── Main handler ───

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  // Only pg_cron (which sends the Vault CRON_SECRET) may run this.
  if (!CRON_SECRET || req.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  try {
    const body = await req.json();
    const type = body.type as string;

    let result;
    switch (type) {
      case "instructor-reminder":
        result = await sendInstructorReminders();
        break;
      case "owner-summary":
        result = await sendOwnerSummaries();
        break;
      default:
        return new Response(
          JSON.stringify({ error: "Unknown type. Use 'instructor-reminder' or 'owner-summary'." }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[send-weekly-emails] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
