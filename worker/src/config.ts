import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const ConfigSchema = z.object({
  PORT: z.coerce.number().optional(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  QUEUE_NAME: z.string().default("convert-jobs"),
  WORKER_CONCURRENCY: z.coerce.number().default(2),
  YT_DLP_BIN: z.string().default("yt-dlp"),
  YT_DLP_PROXY_URL: z.string().url().optional(),
  YT_DLP_COOKIES_PATH: z.string().optional(),
  YT_DLP_COOKIES_BASE64: z.string().optional(),
  FFMPEG_BIN: z.string().default("ffmpeg"),
  OUTPUT_DIR: z.string().default("/tmp/yt-to-mp3"),
});

export const config = ConfigSchema.parse(process.env);
