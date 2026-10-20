import { secureStorage } from './storage';
import { track, JOURNEYS } from '../analytics/analytics';

/**
 * Cleanup utility to wipe sensitive data on logout or account deletion.
 */
export const cleanupSensitiveData = async (): Promise<void> => {
  try {
    await secureStorage.clear();
    // Here we can also add cleanup for other storage engines if used (e.g., AsyncStorage)
    console.log('[Cleanup] Sensitive data cleanup completed.');
    // §mobile analytics: the sign-out routine is the only place a session is
    // torn down, so it is where `Logout Completed` belongs. Emitted after the
    // wipe so a failed cleanup does not report a logout that did not happen.
    track({ name: 'Logout Completed', params: { journey: JOURNEYS.shared } });
  } catch (error) {
    console.error('[Cleanup] Error during sensitive data cleanup:', error);
    throw error;
  }
};

/**
 * Specific utility to check if the user has a stored session.
 */
export const hasStoredSession = async (): Promise<boolean> => {
  const token = await secureStorage.getItem('auth_token');
  return !!token;
};
