import { Hono } from "hono";
import { getUploadRequest, fulfillUploadRequest } from "../services/upload-request";
import { MinimalLayout } from "../views/layout";
import { config } from "../config";

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
          <form method="POST" action={`/upload/${token}`} enctype="multipart/form-data">
            <input type="hidden" name="type" value="file" />
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

upload.post("/:token", async (c) => {
  const token = c.req.param("token");
  const body = await c.req.parseBody();
  const type = body.type as string;

  let result;
  if (type === "file") {
    const file = body.file as File;
    if (!file || file.size === 0) {
      return c.html(
        <MinimalLayout title="Error">
          <div style="max-width:600px;margin:4rem auto">
            <div class="alert alert-error">Please select a file.</div>
            <a href={`/upload/${token}`}>Try again</a>
          </div>
        </MinimalLayout>
      );
    }
    if (file.size > config.maxFileSize) {
      return c.html(
        <MinimalLayout title="Error">
          <div style="max-width:600px;margin:4rem auto">
            <div class="alert alert-error">
              File too large. Maximum size is {config.maxFileSize / 1024 / 1024}MB.
            </div>
            <a href={`/upload/${token}`}>Try again</a>
          </div>
        </MinimalLayout>
      );
    }
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    result = await fulfillUploadRequest(token, {
      type: "file",
      fileData: fileBuffer,
      fileName: file.name,
      fileMime: file.type || "application/octet-stream",
      fileSize: file.size,
    });
  } else {
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
    result = await fulfillUploadRequest(token, { type: "text", text });
  }

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
});

export default upload;
