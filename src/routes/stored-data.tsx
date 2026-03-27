import { Hono } from "hono";
import { authGuard } from "../middleware/auth-guard";
import { createNote, createStoredFile, getNote, getStoredFile, updateNote, deleteStoredItem } from "../services/stored-data";
import { Layout } from "../views/layout";
import { config } from "../config";

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

  const body = await c.req.parseBody();
  const title = (body.title as string)?.trim();
  const file = body.file as File;

  if (!title || !file || file.size === 0) return c.redirect("/dashboard?tab=stored");
  if (file.size > config.maxFileSize) {
    return c.html(
      <Layout title="Error">
        <div class="alert alert-error">
          File too large. Maximum size is {config.maxFileSize / 1024 / 1024}MB.
        </div>
        <a href="/dashboard">Back to Dashboard</a>
      </Layout>
    );
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  createStoredFile({
    userId,
    title,
    fileData: fileBuffer,
    fileName: file.name,
    fileMime: file.type || "application/octet-stream",
    fileSize: file.size,
    userToken,
  });

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

  const file = getStoredFile(id, userId, userToken);
  if (file) {
    return c.html(
      <>
        <h3 style="margin-top:0">{file.title}</h3>
        <div class="stored-file-info">
          <p><strong>{file.fileName}</strong></p>
          <p class="file-meta">{file.fileMime} &middot; {formatSize(file.fileSize)}</p>
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

  return new Response(file.fileData, {
    headers: {
      "Content-Type": file.fileMime,
      "Content-Disposition": `attachment; filename="${file.fileName.replace(/"/g, '\\"')}"`,
      "Content-Length": file.fileData.length.toString(),
    },
  });
});

// --- Delete Stored Item ---
stored.post("/stored/delete/:id", (c) => {
  const userId = c.get("userId") as string;
  const id = c.req.param("id");
  deleteStoredItem(id, userId);
  return c.redirect("/dashboard?tab=stored");
});

export default stored;
