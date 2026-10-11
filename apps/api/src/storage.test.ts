import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { LocalStorage, S3Storage } from "./storage.js";

test("LocalStorage: simpan/baca dan tolak path traversal", async () => {
  const s = new LocalStorage(mkdtempSync(path.join(tmpdir(), "st-")));
  await s.put("2026/10/a.jpg", Buffer.from("abc"), "image/jpeg");
  assert.equal((await s.get("2026/10/a.jpg")).toString(), "abc");
  await assert.rejects(s.put("../luar.txt", Buffer.from("x"), "text/plain"));
});

// S3 tiruan minimal (path-style PUT/GET) — hanya menguji pengkabelan klien, BUKAN Garage asli.
test("S3Storage: PUT/GET path-style ke endpoint S3-compatible", async () => {
  const objs = new Map<string, { body: Buffer; type: string }>();
  const srv = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c)).on("end", () => {
      const key = decodeURIComponent(req.url!.split("?")[0]);
      if (req.method === "PUT") {
        // aws-sdk dapat memakai aws-chunked; ambil payload apa adanya lalu buang bingkai chunk bila ada
        let body = Buffer.concat(chunks);
        if (req.headers["content-encoding"]?.includes("aws-chunked") || req.headers["x-amz-content-sha256"]?.toString().startsWith("STREAMING")) {
          const t = body.toString("latin1");
          const m = /^[0-9a-f]+(;[^\r\n]*)?\r\n/.exec(t);
          if (m) body = body.subarray(m[0].length, m[0].length + parseInt(t.split("\r\n")[0], 16));
        }
        objs.set(key, { body, type: String(req.headers["content-type"]) });
        res.end();
      } else if (req.method === "GET" && objs.has(key)) {
        res.setHeader("content-type", objs.get(key)!.type);
        res.end(objs.get(key)!.body);
      } else { res.statusCode = 404; res.end("<Error><Code>NoSuchKey</Code></Error>"); }
    });
  });
  await new Promise<void>((r) => srv.listen(0, r));
  try {
    const s = new S3Storage("crm", { endpoint: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, region: "garage", accessKeyId: "k", secretAccessKey: "s" });
    await s.put("2026/10/b.jpg", Buffer.from("isi-foto"), "image/jpeg");
    assert.ok(objs.has("/crm/2026/10/b.jpg"), "path-style: /bucket/key");
    assert.equal((await s.get("2026/10/b.jpg")).toString(), "isi-foto");
    await assert.rejects(s.get("tidak/ada.jpg"));
  } finally { srv.close(); }
});
