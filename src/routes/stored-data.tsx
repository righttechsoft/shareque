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

// --- Get content (JSON API for inline viewing) ---
stored.get("/stored/content/:id", (c) => {
  const userId = c.get("userId") as string;
  const userToken = requireToken(c);
  if (!userToken) return c.json({ error: "Token not available" }, 400);

  const id = c.req.param("id");
  const note = getNote(id, userId, userToken);
  if (note) {
    return c.json({ type: "note", id, title: note.title, content: note.content });
  }

  const file = getStoredFile(id, userId, userToken);
  if (file) {
    return c.json({
      type: "file",
      id,
      title: file.title,
      fileName: file.fileName,
      fileMime: file.fileMime,
      fileSize: file.fileSize,
    });
  }

  return c.json({ error: "Not found" }, 404);
});

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
