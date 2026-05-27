import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const ConfigSchema = z.object({
  PORT: z.coerce.number().optional(),
  BACKEND_PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  QUEUE_NAME: z.string().default("convert-jobs"),
  GUEST_COOKIE_SECRET: z.string().min(8),
  TOKEN_SECRET: z.string().min(8),
  MAX_VIDEO_SECONDS: z.coerce.number().default(900),
  DOWNLOAD_TTL_SECONDS: z.coerce.number().default(3600),
  GUEST_RATE_LIMIT_PER_HOUR: z.coerce.number().default(3),
  USER_RATE_LIMIT_PER_HOUR: z.coerce.number().default(15),
});

export const config = ConfigSchema.parse(process.env);
