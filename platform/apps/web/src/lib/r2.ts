import "server-only";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { parseServerEnv } from "./env";
import { createStorage, type VerifyDeps } from "./storage";

let cached: { client: S3Client; bucket: string } | undefined;
function r2() {
  if (!cached) {
    const env = parseServerEnv(process.env);
    cached = {
      bucket: env.R2_BUCKET,
      client: new S3Client({
        region: "auto",
        endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
      }),
    };
  }
  return cached;
}

/** Buckets are private; all access is through short-lived signed URLs minted here. */
export const storage = createStorage({
  presignGet: (key, ttl) => {
    const { client, bucket } = r2();
    return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: ttl });
  },
  presignPut: (key, mime, size, ttl) => {
    const { client, bucket } = r2();
    // Content-Type and Content-Length are signed, so the uploader cannot change them.
    return getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: mime, ContentLength: size }), {
      expiresIn: ttl,
      signableHeaders: new Set(["content-type", "content-length"]),
    });
  },
});

export const verifyDeps: VerifyDeps = {
  async readHead(key, bytes) {
    const { client, bucket } = r2();
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${bytes - 1}` }));
      const head = new Uint8Array(await res.Body!.transformToByteArray());
      const total = Number(res.ContentRange?.split("/")[1] ?? res.ContentLength ?? 0);
      return { head, size: total };
    } catch {
      return null;
    }
  },
  async remove(key) {
    const { client, bucket } = r2();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  },
};
