/* Momentum Cloud – Supabase Auth und nutzergetrennte Datensynchronisierung */
(function () {
  "use strict";

  const SUPABASE_URL = "https://uytacdogqercenlgbpgb.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_NmRBqjT43mYeYS_WJNsx2w_NmhfzIkg";
  const APP_REDIRECT_URL = "https://solidmolid.github.io/momentum/";

  if (!window.supabase?.createClient) {
    window.MomentumCloud = { available: false, error: "Die Cloud-Verbindung konnte nicht geladen werden." };
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "momentum_cloud_session",
    },
  });

  const unwrap = ({ data, error }) => {
    if (error) throw error;
    return data;
  };

  window.MomentumCloud = {
    available: true,

    async session() {
      const data = unwrap(await client.auth.getSession());
      return data.session;
    },

    onAuthChange(callback) {
      return client.auth.onAuthStateChange((_event, session) => callback(session));
    },

    async signUp(email, password, displayName) {
      return unwrap(await client.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName },
          emailRedirectTo: APP_REDIRECT_URL,
        },
      }));
    },

    async signIn(email, password) {
      return unwrap(await client.auth.signInWithPassword({ email, password }));
    },

    async signOut() {
      unwrap(await client.auth.signOut());
    },

    async sendPasswordReset(email) {
      unwrap(await client.auth.resetPasswordForEmail(email, {
        redirectTo: APP_REDIRECT_URL,
      }));
    },

    async loadState(userId) {
      const data = unwrap(await client
        .from("user_states")
        .select("state, updated_at")
        .eq("user_id", userId)
        .maybeSingle());
      return data;
    },

    async saveState(userId, state) {
      return unwrap(await client
        .from("user_states")
        .upsert({ user_id: userId, state }, { onConflict: "user_id" })
        .select("updated_at")
        .single());
    },

    async profile(userId) {
      return unwrap(await client
        .from("profiles")
        .select("id, display_name, email, status, created_at, last_seen_at")
        .eq("id", userId)
        .single());
    },

    async touchProfile(userId) {
      return unwrap(await client
        .from("profiles")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", userId)
        .select("id, display_name, email, status, created_at, last_seen_at")
        .single());
    },

    async isAdmin() {
      const data = unwrap(await client.rpc("is_admin"));
      return data === true;
    },

    async listProfiles() {
      return unwrap(await client
        .from("profiles")
        .select("id, display_name, email, status, created_at, last_seen_at")
        .order("created_at", { ascending: false }));
    },
  };
})();
