// =====================================================================
// App settings — the only file you need to edit.
// =====================================================================
window.APP_CONFIG = {
  // Supabase → Connect (or Settings → API) → Project URL
  SUPABASE_URL: 'https://dhsjpxmuqqktenismiak.supabase.co',

  // Supabase → Connect (or Settings → API) → anon / public key
  // (safe to put here — the database security rules protect the data;
  //  NEVER put the service_role key in this file)
  SUPABASE_ANON_KEY: 'sb_publishable_KTo2Yq_otY_tTyWD9u8ENQ_1CP7fdes',

  // n8n webhook that saves photos to Google Drive (filled in once the n8n
  // workflow is built). Leave empty until then — the app still works.
  N8N_PHOTO_WEBHOOK: '',

  APP_NAME: 'Naturals Complaint Desk'
};
