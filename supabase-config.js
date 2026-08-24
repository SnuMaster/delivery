/**
 * Public browser configuration only.
 *
 * Supabase publishable keys are designed to be visible in a browser. Database
 * Row Level Security (see supabase/migrations) is what protects each account's
 * data. Never add a service-role key, a mail password, or an OAuth client
 * secret to this file.
 */
export const SUPABASE_CONFIG = Object.freeze({
  url: 'https://grfejqvzibeqezfwshhj.supabase.co',
  publishableKey: 'sb_publishable_PEMmRrjC31ywiodKif6czg__eeyYWAd',
});

/**
 * A Google OAuth client ID is public, but it is intentionally left blank until
 * the owner creates one for this site's exact origin. Gmail mailbox access is
 * never enabled by hiding a client secret in this static site.
 */
export const GMAIL_CONFIG = Object.freeze({
  clientId: '',
});
