import { cleanupExpiredShares } from "../services/share";
import { cleanupExpiredRequests } from "../services/upload-request";
import { cleanExpiredSessions } from "../auth/session";

export function startCleanupJob(intervalMinutes: number) {
  const run = () => {
    try {
      const shares = cleanupExpiredShares();
      const requests = cleanupExpiredRequests();
      const sessions = cleanExpiredSessions();
      if (shares || requests || sessions) {
        console.log(
          `[cleanup] Removed: ${shares} shares, ${requests} requests, ${sessions} sessions`
        );
      }
    } catch (err) {
      console.error("[cleanup] Error:", err);
    }
  };

  // Run once on startup
  run();

  // Schedule periodic cleanup
  setInterval(run, intervalMinutes * 60 * 1000);
  console.log(`[cleanup] Scheduled every ${intervalMinutes} minutes`);
}
