import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { config } from "./config";
import { initSchema } from "./db/schema";
import { startCleanupJob } from "./jobs/cleanup";
import { clearManageSessions } from "./auth/session";
import manageRoutes from "./routes/admin";
import authRoutes from "./routes/auth";
import dashboardRoutes from "./routes/dashboard";
import viewRoutes from "./routes/view";
import uploadRoutes from "./routes/upload";
import { MinimalLayout } from "./views/layout";

// Initialize database
initSchema();

// Clear management sessions on startup (require fresh login each restart)
clearManageSessions();

const app = new Hono();

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
