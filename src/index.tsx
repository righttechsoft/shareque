import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { bodyLimit } from "hono/body-limit";
import { config } from "./config";
import { initSchema, runMigrations } from "./db/schema";
import { startCleanupJob } from "./jobs/cleanup";
import { clearManageSessions } from "./auth/session";
import { securityHeaders } from "./middleware/security-headers";
import { csrfProtection } from "./middleware/csrf";
import { rateLimit } from "./middleware/rate-limit";
import manageRoutes from "./routes/admin";
import authRoutes from "./routes/auth";
import dashboardRoutes from "./routes/dashboard";
import viewRoutes from "./routes/view";
import uploadRoutes from "./routes/upload";
import { MinimalLayout } from "./views/layout";

// Initialize database
initSchema();
runMigrations();

// Clear management sessions on startup (require fresh login each restart)
clearManageSessions();

const app = new Hono();

// Security headers on all routes
app.use("*", securityHeaders);

// CSRF protection on all routes
app.use("*", csrfProtection);

// Default body limit (1MB) on all routes
app.use("*", bodyLimit({ maxSize: 1024 * 1024 }));

// Higher body limit for file upload routes
app.use(
  "/share/file",
  bodyLimit({ maxSize: config.maxFileSize + 1024 * 1024 })
);
app.use(
  "/upload/*",
  bodyLimit({ maxSize: config.maxFileSize + 1024 * 1024 })
);

// Rate limiting on auth endpoints (10 req / 15 min)
const authRateLimit = rateLimit("auth", { max: 10, windowMs: 15 * 60 * 1000 });
app.use("/login", authRateLimit);
app.use("/set-password/*", authRateLimit);
app.use("/verify-2fa", authRateLimit);
app.use("/setup-2fa", authRateLimit);
app.use("/manage/login", authRateLimit);
app.use("/manage/verify-2fa", authRateLimit);
app.use("/manage/setup-2fa", authRateLimit);

// Rate limiting on view content endpoint (20 req / 15 min)
app.use("/view/*/content", rateLimit("view", { max: 20, windowMs: 15 * 60 * 1000 }));

// Static files
app.use("/style.css", serveStatic({ root: "./public" }));
app.use("/client.js", serveStatic({ root: "./public" }));
app.use("/webauthn.js", serveStatic({ root: "./public" }));
app.use("/logo.png", serveStatic({ root: "./public" }));
app.use("/apple-touch-icon.png", serveStatic({ root: "./public" }));
app.use("/favicon-32x32.png", serveStatic({ root: "./public" }));
app.use("/favicon-16x16.png", serveStatic({ root: "./public" }));
app.use("/site.webmanifest", serveStatic({ root: "./public" }));

// Routes
app.route("/manage", manageRoutes);
app.route("/", authRoutes);
app.route("/", dashboardRoutes);
app.route("/view", viewRoutes);
app.route("/upload", uploadRoutes);

// Root redirect
app.get("/", (c) => c.redirect("/dashboard"));

// 404
app.notFound((c) => {
  return c.html(
    <MinimalLayout title="Not Found">
      <div class="text-center" style="margin-top:4rem">
        <h2>404 - Not Found</h2>
        <p class="text-muted">The page you're looking for doesn't exist.</p>
        <a href="/dashboard">Go to Dashboard</a>
      </div>
    </MinimalLayout>,
    404
  );
});

// Error handler
app.onError((err, c) => {
  console.error("[error]", err);
  return c.html(
    <MinimalLayout title="Error">
      <div class="text-center" style="margin-top:4rem">
        <h2>Something went wrong</h2>
        <p class="text-muted">An unexpected error occurred.</p>
        <a href="/dashboard">Go to Dashboard</a>
      </div>
    </MinimalLayout>,
    500
  );
});

// Start cleanup job
startCleanupJob(config.cleanupInterval);

// Start server
console.log(`[shareque] Starting on ${config.host}:${config.port}`);

export default {
  port: config.port,
  hostname: config.host,
  fetch: app.fetch,
};
