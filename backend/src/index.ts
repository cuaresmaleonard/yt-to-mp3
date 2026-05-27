import crypto from "node:crypto";
import fs from "node:fs/promises";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import jwt from "jsonwebtoken";
import { Queue } from "bullmq";
import { config } from "./config.js";
import { initDb, pool } from "./db.js";
import { resolvePrincipal } from "./identity.js";
import { consumeRateLimit } from "./rate-limit.js";
import { CreateJobSchema, isLikelyYouTubeUrl } from "./schemas.js";

const app = express();
const queue = new Queue(config.QUEUE_NAME, {
  connection: { url: config.REDIS_URL },
});

function sanitizeDownloadFileName(title: string | null | undefined): string {
  const fallback = "download.mp3";
  if (!title) {
    return fallback;
  }

  const baseName = title
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  if (!baseName) {
    return fallback;
  }

  return `${baseName}.mp3`;
}

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/jobs", async (req, res) => {
  const principal = resolvePrincipal(req, res);
  const body = CreateJobSchema.safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  if (!isLikelyYouTubeUrl(body.data.url)) {
    res
      .status(400)
      .json({ error: "Only YouTube URLs are currently supported" });
    return;
  }

  const rateKey = `${principal.type}:${principal.id}`;
  const max =
    principal.type === "guest"
      ? config.GUEST_RATE_LIMIT_PER_HOUR
      : config.USER_RATE_LIMIT_PER_HOUR;
  const limitResult = consumeRateLimit(rateKey, max);
  if (!limitResult.allowed) {
    res.status(429).json({
      error:
        "Rate limit exceeded. Try again later or sign in for higher limits.",
    });
    return;
  }

  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO jobs (id, source_url, principal_type, principal_id, status) VALUES ($1, $2, $3, $4, 'queued')`,
    [id, body.data.url, principal.type, principal.id],
  );

  await queue.add("convert", {
    id,
    sourceUrl: body.data.url,
    principalType: principal.type,
    principalId: principal.id,
    maxVideoSeconds: config.MAX_VIDEO_SECONDS,
    downloadTtlSeconds: config.DOWNLOAD_TTL_SECONDS,
  });

  res.status(202).json({
    id,
    status: "queued",
    principalType: principal.type,
    remainingThisHour: limitResult.remaining,
  });
});

app.get("/api/jobs", async (req, res) => {
  const principal = resolvePrincipal(req, res);
  const result = await pool.query(
    `SELECT id, source_url, status, error_message, title, duration_seconds, created_at, updated_at
     FROM jobs
     WHERE principal_type = $1 AND principal_id = $2
     ORDER BY created_at DESC
     LIMIT 50`,
    [principal.type, principal.id],
  );

  res.json({ items: result.rows, principalType: principal.type });
});

app.get("/api/jobs/:id", async (req, res) => {
  const principal = resolvePrincipal(req, res);

  const result = await pool.query(
    `SELECT id, source_url, status, error_message, title, duration_seconds, created_at, updated_at, expires_at
     FROM jobs
     WHERE id = $1 AND principal_type = $2 AND principal_id = $3`,
    [req.params.id, principal.type, principal.id],
  );

  const row = result.rows[0];
  if (!row) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.json(row);
});

app.post("/api/jobs/:id/download-token", async (req, res) => {
  const principal = resolvePrincipal(req, res);

  const result = await pool.query(
    `SELECT id, status, output_path, expires_at
     FROM jobs
     WHERE id = $1 AND principal_type = $2 AND principal_id = $3`,
    [req.params.id, principal.type, principal.id],
  );

  const row = result.rows[0];
  if (!row) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (row.status !== "done" || !row.output_path) {
    res.status(409).json({ error: "Job is not ready for download" });
    return;
  }

  const token = jwt.sign(
    {
      jobId: row.id,
      principalType: principal.type,
      principalId: principal.id,
      outputPath: row.output_path,
    },
    config.TOKEN_SECRET,
    { expiresIn: "10m" },
  );

  res.json({ token });
});

app.get("/api/download/:token", async (req, res) => {
  try {
    const payload = jwt.verify(req.params.token, config.TOKEN_SECRET) as {
      jobId: string;
      principalType: string;
      principalId: string;
      outputPath: string;
    };

    const principal = resolvePrincipal(req, res);
    if (
      principal.type !== payload.principalType ||
      principal.id !== payload.principalId
    ) {
      res.status(403).json({ error: "Token is not valid for current session" });
      return;
    }

    const result = await pool.query(
      `SELECT id, title, output_path, expires_at FROM jobs WHERE id = $1 AND principal_type = $2 AND principal_id = $3`,
      [payload.jobId, principal.type, principal.id],
    );
    const row = result.rows[0];

    if (
      !row ||
      !row.output_path ||
      new Date(row.expires_at).getTime() < Date.now()
    ) {
      res.status(410).json({ error: "Download expired or unavailable" });
      return;
    }

    try {
      await fs.access(row.output_path);
    } catch {
      res.status(410).json({ error: "File is no longer available" });
      return;
    }

    res.download(row.output_path, sanitizeDownloadFileName(row.title));
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

async function main(): Promise<void> {
  await initDb();
  const listenPort = config.PORT ?? config.BACKEND_PORT;
  app.listen(listenPort, () => {
    console.log(`backend listening on ${listenPort}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
