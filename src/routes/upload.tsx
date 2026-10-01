import { Hono } from "hono";
import { getUploadRequest, fulfillUploadRequest } from "../services/upload-request";
import { MinimalLayout } from "../views/layout";
import { maxUploadBytes } from "../config";
import { receiveUpload } from "../services/upload-stream";
import { FileTooLargeError } from "../crypto/encryption";

const upload = new Hono();

upload.get("/:token", (c) => {
  const token = c.req.param("token");
  const request = getUploadRequest(token);

  if (!request) {
    return c.html(
      <MinimalLayout title="Invalid Link">
        <div class="text-center" style="margin-top:4rem">
          <h2>Invalid or Expired Link</h2>
          <p class="text-muted">This upload link is no longer valid.</p>
        </div>
      </MinimalLayout>,
      404
    );
  }

  return c.html(
    <MinimalLayout title="Upload Data">
      <div style="max-width:600px;margin:4rem auto">
        <h2>Upload Data</h2>
        <p class="text-muted">Someone has requested you to share data with them securely.</p>

        <div class="tabs">
          <button class="active" data-tab="upload-text">Text</button>
          <button data-tab="upload-file">File</button>
        </div>

        <div class="tab-content active" id="tab-upload-text">
          <form method="POST" action={`/upload/${token}`} enctype="multipart/form-data">
            <input type="hidden" name="type" value="text" />
            <label>
              Text Content
              <textarea name="text" rows={8} required placeholder="Paste your text here..." />
            </label>
            <button type="submit">Upload</button>
          </form>
        </div>

        <div class="tab-content" id="tab-upload-file">
          <form method="POST" action={`/upload/${token}/file`} data-stream-upload data-max-size={maxUploadBytes()}>
            <label>
              File
              <input type="file" name="file" required />
            </label>
            <button type="submit">Upload</button>
          </form>
        </div>
      </div>
    </MinimalLayout>
  );
});

function uploadResultPage(c: any, result: { ok: true } | { ok: false; error: string }) {
  if (!result.ok) {
    return c.html(
      <MinimalLayout title="Error">
        <div style="max-width:600px;margin:4rem auto">
          <div class="alert alert-error">{result.error}</div>
        </div>
      </MinimalLayout>
    );
  }

  return c.html(
    <MinimalLayout title="Upload Complete">
      <div class="text-center" style="margin-top:4rem">
        <h2>Upload Complete!</h2>
        <p class="text-muted">
          Your data has been encrypted and the requester has been notified.
        </p>
      </div>
    </MinimalLayout>
  );
}

upload.post("/:token", async (c) => {
  const token = c.req.param("token");
  const body = await c.req.parseBody();
  const text = body.text as string;
  if (!text?.trim()) {
    return c.html(
      <MinimalLayout title="Error">
        <div style="max-width:600px;margin:4rem auto">
          <div class="alert alert-error">Please enter some text.</div>
          <a href={`/upload/${token}`}>Try again</a>
        </div>
      </MinimalLayout>
    );
  }
  return uploadResultPage(c, await fulfillUploadRequest(token, { type: "text", text }));
});

upload.post("/:token/file", async (c) => {
  const token = c.req.param("token");
  let received;
  try {
    received = await receiveUpload(c, token, (raw) =>
      fulfillUploadRequest(token, {
        type: "file",
        source: raw.source,
        maxBytes: raw.maxBytes,
        fileName: raw.fileName,
        fileMime: raw.fileMime,
      })
    );
  } catch (err) {
    const message =
      err instanceof FileTooLargeError
        ? `File too large. Maximum size is ${Math.round(maxUploadBytes() / 1024 / 1024)}MB.`
        : err instanceof Error && err.message === "Empty file"
          ? "Please select a file."
          : "Upload failed.";
    if (message === "Upload failed.") console.error("[upload]", err);
    return c.html(
      <MinimalLayout title="Error">
        <div style="max-width:600px;margin:4rem auto">
          <div class="alert alert-error">{message}</div>
          <a href={`/upload/${token}`}>Try again</a>
        </div>
      </MinimalLayout>
    );
  }
  if (!received.ok) {
    return c.html(
      <MinimalLayout title="Error">
        <div style="max-width:600px;margin:4rem auto">
          <div class="alert alert-error">
            {received.tooLarge ? `File too large. Maximum size is ${Math.round(maxUploadBytes() / 1024 / 1024)}MB.` : received.error}
          </div>
          <a href={`/upload/${token}`}>Try again</a>
        </div>
      </MinimalLayout>
    );
  }
  if (!received.done) return c.body(null, 204);
  return uploadResultPage(c, received.result);
});

export default upload;
