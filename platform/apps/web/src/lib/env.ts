import { z, type ZodTypeAny } from "zod";

const publicShape = {
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
};

const serverShape = {
  ...publicShape,
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  SENTRY_DSN: z.string().url().optional(),
};

export type ServerEnv = z.infer<z.ZodObject<typeof serverShape>>;
export type PublicEnv = z.infer<z.ZodObject<typeof publicShape>>;
type Raw = Record<string, string | undefined>;

function parse<S extends Record<string, ZodTypeAny>>(shape: S, raw: Raw) {
  const picked: Raw = {};
  for (const key of Object.keys(shape)) picked[key] = raw[key] === "" ? undefined : raw[key];
  const result = z.object(shape).safeParse(picked);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((i) => String(i.path[0])))];
    throw new Error(`Invalid or missing environment variables: ${keys.join(", ")}`);
  }
  return result.data;
}

export const parseServerEnv = (raw: Raw): ServerEnv => parse(serverShape, raw) as ServerEnv;
export const parsePublicEnv = (raw: Raw): PublicEnv => parse(publicShape, raw) as PublicEnv;
