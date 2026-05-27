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
  FFMPEG_BIN: z.string().default("ffmpeg"),
  OUTPUT_DIR: z.string().default("/tmp/yt-to-mp3"),
});

export const config = ConfigSchema.parse(process.env);
