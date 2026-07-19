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

  // anon (public) key — safe to commit; all access is gated by RLS.
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1a3hnYnR3YW1naWZkamh5Y2tiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNDYyMDcsImV4cCI6MjA5OTkyMjIwN30.D8kciRWUGMTLjbmUUoLemE4EQnZT-5qJEl97VPMkNZ0",

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
