/**
 * Admin second factor (TOTP via Supabase Auth MFA).
 *
 * Opt-in with ADMIN_REQUIRE_MFA=1 so turning it on is a deliberate step: the
 * first time an admin signs in after enabling it, /admin/mfa walks them
 * through enrolling an authenticator app; every later sign-in asks for a code.
 * While the flag is off, admin access keeps working exactly as before.
 */
export function isAdminMfaRequired(): boolean {
  return process.env.ADMIN_REQUIRE_MFA === '1'
}
