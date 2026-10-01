import type { Context } from "hono";
import { PassThrough, Readable } from "node:stream";
import { once } from "node:events";
import { maxUploadBytes } from "../config";

export type RawUpload =
  | { ok: true; source: Readable; fileName: string; fileMime: string; fields: Record<string, string>; maxBytes: number }
  | { ok: false; error: string; tooLarge?: boolean };

// The browser sends the file as the raw request body (see client.js stream upload)
export function readRawUpload(c: Context): RawUpload {
  const contentType = c.req.header("Content-Type") || "";
  if (contentType.startsWith("multipart/form-data") || contentType.startsWith("application/x-www-form-urlencoded")) {
    return { ok: false, error: "Upload requires JavaScript. Please enable it and reload the page." };
  }
  const body = c.req.raw.body;
  if (!body) return { ok: false, error: "Please select a file." };

  const maxBytes = maxUploadBytes();
  const len = parseInt(c.req.header("Content-Length") || "", 10);
  if (!isNaN(len) && len > maxBytes) return { ok: false, error: "File too large", tooLarge: true };

  let fileName = "upload";
  try {
    fileName = decodeURIComponent(c.req.header("X-File-Name") || "");
  } catch {}
  fileName = fileName.split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g, "") || "upload";

  const fields = Object.fromEntries(new URLSearchParams(c.req.header("X-Upload-Fields") || ""));
  return {
    ok: true,
    source: Readable.fromWeb(body as any),
    fileName,
    fileMime: contentType || "application/octet-stream",
    fields,
    maxBytes,
  };
}

interface Session {
  pass: PassThrough;
  total: number;
  received: number;
  busy: boolean;
  ended: boolean;
  settled: boolean;
  last: number;
  promise: Promise<any>;
  done: Promise<void>;
}

// ponytail: in-memory, uploads in flight are lost on restart and this assumes a single process
const sessions = new Map<string, Session>();
const INTERRUPTED = new Error("Upload interrupted");

// Drop a session and make the service's pipeline settle (it unlinks the partial .enc file).
// Returns the service result if it finished on its own before the file was complete,
// null if it only failed because of our abort. Throws the service's own error otherwise.
async function abortSession(key: string, s: Session): Promise<{ result: any } | null> {
  sessions.delete(key);
  if (!s.pass.destroyed) s.pass.destroy(INTERRUPTED);
  try {
    return { result: await s.promise };
  } catch (err) {
    if (err === INTERRUPTED) return null;
    throw err;
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [key, s] of sessions) {
    if (now - s.last > 10 * 60 * 1000) abortSession(key, s).catch(() => {});
  }
}, 60_000).unref();

type ReceiveResult<T> =
  | { ok: false; error: string; tooLarge?: boolean }
  | { ok: true; done: false }
  | { ok: true; done: true; result: T };

// Receives one chunk of a chunked upload. The first chunk starts the service call (start) with a
// PassThrough as source, later chunks are written into it, the last chunk ends it and awaits the result.
export async function receiveUpload<T>(
  c: Context,
  scope: string,
  start: (raw: Extract<RawUpload, { ok: true }>) => Promise<T>
): Promise<ReceiveResult<T>> {
  const raw = readRawUpload(c);
  if (!raw.ok) return raw;

  const uploadId = c.req.header("X-Upload-Id") || "";
  const offsetStr = c.req.header("X-Upload-Offset") || "";
  const totalStr = c.req.header("X-Upload-Total") || "";
  if (!/^[\w-]{8,64}$/.test(uploadId) || !/^\d+$/.test(offsetStr) || !/^\d+$/.test(totalStr)) {
    return { ok: false, error: "Invalid upload request." };
  }
  const offset = parseInt(offsetStr, 10);
  const total = parseInt(totalStr, 10);
  if (total > maxUploadBytes()) return { ok: false, error: "File too large", tooLarge: true };

  const key = `${scope}:${uploadId}`;
  const outOfSequence = { ok: false as const, error: "Upload out of sequence. Please try again." };
  let s = sessions.get(key);
  if (offset === 0) {
    if (s) return outOfSequence;
    const pass = new PassThrough();
    pass.on("error", () => {}); // the service's pipeline reports errors; never leave 'error' unhandled
    const session: Session = {
      pass, total, received: 0, busy: false, ended: false, settled: false, last: Date.now(),
      promise: undefined as any, done: undefined as any,
    };
    session.promise = start({ ...raw, source: pass });
    session.done = session.promise.then(
      () => { session.settled = true; },
      () => { session.settled = true; }
    );
    sessions.set(key, session);
    s = session;
  } else {
    if (!s || s.busy) return outOfSequence;
    if (offset !== s.received || total !== s.total) {
      await abortSession(key, s);
      return outOfSequence;
    }
  }

  const session = s;
  session.busy = true;
  let failure: string | null = null;
  try {
    for await (const chunk of raw.source) {
      if (session.pass.destroyed || session.settled) { failure = "Upload interrupted. Please try again."; break; }
      if (session.received + chunk.length > session.total) { failure = "Upload exceeds the declared size."; break; }
      session.received += chunk.length;
      session.last = Date.now();
      if (!session.pass.write(chunk)) {
        // the signal removes the losing listeners so they do not pile up across chunks
        const ac = new AbortController();
        const wait = (ev: string) => once(session.pass, ev, { signal: ac.signal }).catch(() => {});
        await Promise.race([wait("drain"), wait("close"), session.done]);
        ac.abort();
      }
    }
  } catch {
    failure = "Upload interrupted. Please try again.";
  } finally {
    session.busy = false;
  }
  if (!failure && session.settled && !session.ended && session.received < session.total) {
    failure = "Upload interrupted. Please try again.";
  }

  if (failure) {
    const early = await abortSession(key, session);
    return early ? { ok: true, done: true, result: early.result } : { ok: false, error: failure };
  }

  if (session.received === session.total) {
    session.ended = true;
    session.pass.end();
    sessions.delete(key);
    return { ok: true, done: true, result: await session.promise };
  }
  return { ok: true, done: false };
}
