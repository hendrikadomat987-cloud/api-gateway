/**
 * Guard that prevents staging smoke tests from running accidentally.
 *
 * Call assertSmokeTestsEnabled() at the top of any smoke runner or smoke-aware
 * code path. Throws if the opt-in flag is not explicitly set.
 */
export function assertSmokeTestsEnabled(): void {
  if (process.env.ENABLE_STAGING_SMOKE_TESTS !== 'true') {
    throw new Error(
      'Staging smoke tests are disabled. ' +
        'Set ENABLE_STAGING_SMOKE_TESTS=true to enable. ' +
        'This flag is intentionally off by default to prevent accidental live execution.',
    );
  }
}
