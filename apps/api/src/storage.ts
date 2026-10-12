import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** Penyimpanan berkas: `local` (volume) atau `s3` (Garage/SeaweedFS/S3 mana pun). Kunci objek sama di kedua driver. */
export interface Storage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Hapus objek; tidak error bila sudah tidak ada. */
  del(key: string): Promise<void>;
}

export class LocalStorage implements Storage {
  constructor(private dir: string) {}
  private abs(key: string) {
    const p = path.resolve(this.dir, key);
    if (!p.startsWith(path.resolve(this.dir) + path.sep)) throw new Error("Kunci berkas tidak valid");
    return p;
  }
  async put(key: string, data: Buffer, _contentType?: string) {
    const p = this.abs(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data);
  }
  get(key: string) { return readFile(this.abs(key)); }
  async del(key: string) { await rm(this.abs(key), { force: true }); }
}

export class S3Storage implements Storage {
  private c: S3Client;
  constructor(private bucket: string, opts: { endpoint: string; region: string; accessKeyId: string; secretAccessKey: string }) {
    this.c = new S3Client({
      endpoint: opts.endpoint, region: opts.region, forcePathStyle: true, // Garage memakai path-style
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    });
  }
  async put(key: string, data: Buffer, contentType: string) {
    await this.c.send(new PutObjectCommand({ Bucket: this.bucket, Key: key.split(path.sep).join("/"), Body: data, ContentType: contentType }));
  }
  async get(key: string) {
    const r = await this.c.send(new GetObjectCommand({ Bucket: this.bucket, Key: key.split(path.sep).join("/") }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async del(key: string) {
    await this.c.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key.split(path.sep).join("/") }));
  }
}

let current: Storage | undefined;
export function storage(): Storage {
  if (current) return current;
  if ((process.env.STORAGE_DRIVER ?? "local") === "s3") {
    const need = (k: string) => process.env[k] || (() => { throw new Error(`${k} wajib bila STORAGE_DRIVER=s3`); })();
    current = new S3Storage(need("S3_BUCKET"), {
      endpoint: need("S3_ENDPOINT"), region: process.env.S3_REGION ?? "garage",
      accessKeyId: need("S3_ACCESS_KEY"), secretAccessKey: need("S3_SECRET_KEY"),
    });
  } else {
    current = new LocalStorage(path.resolve(process.env.UPLOAD_DIR ?? "uploads"));
  }
  return current;
}
export const setStorage = (s: Storage | undefined) => { current = s; };
