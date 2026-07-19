/* ============================================================
   Air Note — Admin Dashboard config
   ------------------------------------------------------------
   The ONLY place you need to edit to get the dashboard running.

   1. Paste your Supabase anon (public) key below. It is safe to
      commit — it is a public key by design, and every read is
      gated by Row Level Security (see docs/supabase-admin-setup.sql).
      Do NOT ever paste a service_role key here.

   2. If your real table / column names differ from the guesses
      below, adjust them. The dashboard also auto-probes the
      capture-table candidates and skips anything that isn't there.
   ============================================================ */

window.ADMIN_CONFIG = {
  // Same Supabase project as the mobile app.
  SUPABASE_URL: "https://pukxgbtwamgifdjhyckb.supabase.co",

  // 👇 PASTE YOUR ANON KEY HERE (Supabase → Project settings → API → anon public)
  SUPABASE_ANON_KEY: "PASTE_YOUR_SUPABASE_ANON_KEY_HERE",

  tables: {
    profiles: "profiles",
    analytics: "analytics_events",
    // Tried in order; first one that exists is used for capture counts/lists.
    captureCandidates: ["captures", "meetings", "notes", "recordings", "transcripts"],
  },

  columns: {
    profileId: "id",       // profiles PK, equals auth.users.id
    isAdmin: "is_admin",
  },
};
