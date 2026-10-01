import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { randomBytes } from "node:crypto";
import { generateKey, encryptStreamToFile, decryptFileStream, decryptFileRange, FileTooLargeError } from "./encryption";

const dir = mkdtempSync(join(tmpdir(), "shareque-enc-"));

async function readAll(s: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of s) chunks.push(c);
  return Buffer.concat(chunks);
}

test("round trip", async () => {
  const key = generateKey();
  const data = randomBytes(300_000);
  const dest = join(dir, "a.enc");
  const { iv, authTag, size } = await encryptStreamToFile(Readable.from([data.subarray(0, 100_000), data.subarray(100_000)]), key, dest, 1_000_000);
  expect(size).toBe(data.length);
  expect((await readAll(decryptFileStream(dest, key, iv, authTag))).equals(data)).toBe(true);
});

test("exceeding maxBytes rejects and leaves no file", async () => {
  const dest = join(dir, "b.enc");
  await expect(
    encryptStreamToFile(Readable.from([randomBytes(5000), randomBytes(5000)]), generateKey(), dest, 6000)
  ).rejects.toBeInstanceOf(FileTooLargeError);
  expect(existsSync(dest)).toBe(false);
});

test("tampered ciphertext errors the decrypt stream", async () => {
  const key = generateKey();
  const dest = join(dir, "c.enc");
  const { iv, authTag } = await encryptStreamToFile(Readable.from([randomBytes(10_000)]), key, dest, 1_000_000);
  const buf = readFileSync(dest);
  buf[100] ^= 1;
  writeFileSync(dest, buf);
  await expect(readAll(decryptFileStream(dest, key, iv, authTag))).rejects.toThrow();
});

test("range decrypt equals plaintext slice", async () => {
  const key = generateKey();
  const data = randomBytes(300_000);
  const dest = join(dir, "d.enc");
  const { iv } = await encryptStreamToFile(Readable.from([data]), key, dest, 1_000_000);
  const last = data.length - 1;
  for (const [s, e] of [[0, 0], [1, 17], [15, 16], [16, 31], [4097, 70001], [last, last], [last - 40, last]]) {
    expect(decryptFileRange(dest, key, iv, s, e).equals(data.subarray(s, e + 1))).toBe(true);
  }
});

test("cleanup", () => rmSync(dir, { recursive: true, force: true }));
