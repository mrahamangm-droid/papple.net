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
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z.string().min(1).max(100).optional(),
};

const rateLimitShape = {
  UPSTASH_REDIS_REST_URL: serverShape.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: serverShape.UPSTASH_REDIS_REST_TOKEN,
};

const serviceShape = {
  NEXT_PUBLIC_SUPABASE_URL: publicShape.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: serverShape.SUPABASE_SERVICE_ROLE_KEY,
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

/** Only what the rate limiter reads, so anonymous search never fails on unrelated unset config (storage, email). */
export const parseRateLimitEnv = (raw: Raw): Pick<ServerEnv, "UPSTASH_REDIS_REST_URL" | "UPSTASH_REDIS_REST_TOKEN"> => parse(rateLimitShape, raw);

/** Only what the service-role client reads, so server code that needs the database never fails on unset storage config. */
export const parseServiceEnv = (raw: Raw): Pick<ServerEnv, "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"> => parse(serviceShape, raw);
