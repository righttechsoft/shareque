import { Hono } from "hono";
import { authGuard } from "../middleware/auth-guard";
import {
  createNote,
  createStoredFile,
  getNote,
  getStoredFile,
  getStoredFileMeta,
  updateNote,
  deleteStoredItem,
  createGroup,
  renameGroup,
  deleteGroup,
  moveStoredItem,
} from "../services/stored-data";
import { Layout } from "../views/layout";
import { maxUploadBytes } from "../config";
import { receiveUpload } from "../services/upload-stream";
import { FileTooLargeError } from "../crypto/encryption";
import { Readable } from "node:stream";

const stored = new Hono();

stored.use("/stored/*", authGuard);

function requireToken(c: any): Buffer | null {
  const token = c.get("userToken") as Buffer | undefined;
  if (!token) return null;
  return token;
}

// --- Create Note ---
stored.post("/stored/note", async (c) => {
  const userId = c.get("userId") as string;
  const userToken = requireToken(c);
  if (!userToken) return c.redirect("/dashboard?tab=stored");

  const body = await c.req.parseBody();
  const title = (body.title as string)?.trim();
  const content = body.content as string;

  if (!title || !content?.trim()) return c.redirect("/dashboard?tab=stored");

  createNote({ userId, title, content, userToken });
  return c.redirect("/dashboard?tab=stored");
});

// --- View/Edit Note ---
stored.get("/stored/note/:id", (c) => {
  const userId = c.get("userId") as string;
  const userToken = requireToken(c);
  if (!userToken) return c.redirect("/dashboard?tab=stored");

  const id = c.req.param("id");
  const note = getNote(id, userId, userToken);
  if (!note) {
    return c.html(
      <Layout title="Not Found">
        <div class="alert alert-error">Note not found.</div>
        <a href="/dashboard">Back to Dashboard</a>
      </Layout>,
      404
    );
  }

  return c.html(
    <Layout title={`Edit: ${note.title}`}>
      <h2>Edit Note</h2>
      <form method="POST" action={`/stored/note/${id}`}>
        <label>
          Title
          <input type="text" name="title" required value={note.title} />
        </label>
        <label>
          Content
          <textarea name="content" rows={12} required>{note.content}</textarea>
        </label>
        <div class="actions">
          <button type="submit">Save Changes</button>
          <a href="/dashboard" class="outline" role="button">Cancel</a>
        </div>
      </form>
    </Layout>
  );
});

// --- Update Note ---
stored.post("/stored/note/:id", async (c) => {
  const userId = c.get("userId") as string;
  const userToken = requireToken(c);
  if (!userToken) return c.redirect("/dashboard?tab=stored");

  const id = c.req.param("id");
  const body = await c.req.parseBody();
  const title = (body.title as string)?.trim();
  const content = body.content as string;

  if (!title || !content?.trim()) return c.redirect(`/stored/note/${id}`);

  updateNote(id, userId, title, content, userToken);
  return c.redirect("/dashboard?tab=stored");
});

// --- Upload Stored File ---
stored.post("/stored/file", async (c) => {
  const userId = c.get("userId") as string;
  const userToken = requireToken(c);
  if (!userToken) return c.redirect("/dashboard?tab=stored");

  const tooLarge = (
    <Layout title="Error">
      <div class="alert alert-error">
        File too large. Maximum size is {Math.round(maxUploadBytes() / 1024 / 1024)}MB.
      </div>
      <a href="/dashboard">Back to Dashboard</a>
    </Layout>
  );
  const title = new URLSearchParams(c.req.header("X-Upload-Fields") || "").get("title")?.trim();
  if (!title) return c.redirect("/dashboard?tab=stored");

  let received;
  try {
    received = await receiveUpload(c, userId, (raw) =>
      createStoredFile({
        userId,
        title,
        source: raw.source,
        maxBytes: raw.maxBytes,
        fileName: raw.fileName,
        fileMime: raw.fileMime,
        userToken,
      })
    );
  } catch (err) {
    if (err instanceof FileTooLargeError) return c.html(tooLarge);
    if (err instanceof Error && err.message === "Empty file") return c.redirect("/dashboard?tab=stored");
    throw err;
  }
  if (!received.ok) {
    if (received.tooLarge) return c.html(tooLarge);
    return c.html(
      <Layout title="Error">
        <div class="alert alert-error">{received.error}</div>
        <a href="/dashboard">Back to Dashboard</a>
      </Layout>
    );
  }
  if (!received.done) return c.body(null, 204);

  return c.redirect("/dashboard?tab=stored");
});

// --- Get content (HTML fragment for htmx) ---
stored.get("/stored/content/:id", (c) => {
  const userId = c.get("userId") as string;
  const userToken = requireToken(c);
  if (!userToken) return c.html(<p class="text-muted">Token not available. Please re-login.</p>);

  const id = c.req.param("id");
  const note = getNote(id, userId, userToken);
  if (note) {
    return c.html(
      <>
        <h3 style="margin-top:0">{note.title}</h3>
        <pre style="white-space:pre-wrap;word-break:break-word">{note.content}</pre>
        <div class="stored-content-actions">
          <a href={`/stored/note/${id}`} class="outline btn-sm" role="button">Edit</a>
          <button type="button" class="outline btn-sm copy-btn" data-copy={note.content}>Copy</button>
          <form method="POST" action={`/stored/delete/${id}`} style="display:inline" onsubmit="return confirm('Delete this item?')">
            <button type="submit" class="outline secondary btn-sm">Delete</button>
          </form>
        </div>
      </>
    );
  }

  const file = getStoredFileMeta(id, userId);
  if (file) {
    return c.html(
      <>
        <h3 style="margin-top:0">{file.title}</h3>
        <div class="stored-file-info">
          <p><strong>{file.fileName}</strong></p>
          <p class="file-meta">{file.fileMime} &middot; {formatSize(file.fileSize || 0)}</p>
        </div>
        <div class="stored-content-actions">
          <a href={`/stored/file/${id}`} class="outline btn-sm" role="button">Download</a>
          <form method="POST" action={`/stored/delete/${id}`} style="display:inline" onsubmit="return confirm('Delete this item?')">
            <button type="submit" class="outline secondary btn-sm">Delete</button>
          </form>
        </div>
      </>
    );
  }

  return c.html(<p class="alert alert-error">Item not found.</p>, 404);
});

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// --- Download Stored File ---
stored.get("/stored/file/:id", (c) => {
  const userId = c.get("userId") as string;
  const userToken = requireToken(c);
  if (!userToken) return c.redirect("/dashboard?tab=stored");

  const id = c.req.param("id");
  const file = getStoredFile(id, userId, userToken);
  if (!file) {
    return c.html(
      <Layout title="Not Found">
        <div class="alert alert-error">File not found.</div>
        <a href="/dashboard">Back to Dashboard</a>
      </Layout>,
      404
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": file.fileMime,
    "Content-Disposition": `attachment; filename="${file.fileName.replace(/"/g, '\\"')}"`,
  };
  if (file.fileSize) headers["Content-Length"] = file.fileSize.toString();
  return new Response(Readable.toWeb(file.fileStream) as any, { headers });
});

// --- Delete Stored Item ---
stored.post("/stored/delete/:id", (c) => {
  const userId = c.get("userId") as string;
  const id = c.req.param("id");
  deleteStoredItem(id, userId);
  return c.redirect("/dashboard?tab=stored");
});

// --- Create Group ---
stored.post("/stored/group", async (c) => {
  const userId = c.get("userId") as string;
  const userToken = requireToken(c);
  if (!userToken) return c.redirect("/dashboard?tab=stored");

  const body = await c.req.parseBody();
  const name = (body.name as string)?.trim();
  if (!name) return c.redirect("/dashboard?tab=stored");

  createGroup(userId, name, userToken);
  return c.redirect("/dashboard?tab=stored");
});

// --- Rename Group ---
stored.post("/stored/group/:id/rename", async (c) => {
  const userId = c.get("userId") as string;
  const userToken = requireToken(c);
  if (!userToken) return c.redirect("/dashboard?tab=stored");

  const id = c.req.param("id");
  const body = await c.req.parseBody();
  const name = (body.name as string)?.trim();
  if (!name) return c.redirect("/dashboard?tab=stored");

  renameGroup(id, userId, name, userToken);
  return c.redirect("/dashboard?tab=stored");
});

// --- Delete Group (items reassigned to Ungrouped) ---
stored.post("/stored/group/:id/delete", (c) => {
  const userId = c.get("userId") as string;
  const id = c.req.param("id");
  deleteGroup(id, userId);
  return c.redirect("/dashboard?tab=stored");
});

// --- Move Stored Item to Group ---
stored.post("/stored/item/:id/move", async (c) => {
  const userId = c.get("userId") as string;
  const id = c.req.param("id");
  const body = await c.req.parseBody();
  const raw = (body.group_id as string) || "";
  const groupId = raw.trim() === "" ? null : raw.trim();
  moveStoredItem(id, userId, groupId);
  return c.redirect("/dashboard?tab=stored");
});

export default stored;
