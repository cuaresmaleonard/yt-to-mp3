import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Worker } from "bullmq";
import { Pool } from "pg";
import { config } from "./config.js";

type ConvertPayload = {
  id: string;
  sourceUrl: string;
  principalType: "guest" | "user";
  principalId: string;
  maxVideoSeconds: number;
  downloadTtlSeconds: number;
};

const pool = new Pool({ connectionString: config.DATABASE_URL });

const YT_DLP_COMMON_ARGS = [
  "--no-playlist",
  "--force-ipv4",
  "--extractor-args",
  "youtube:player_client=android,web",
  "--retries",
  "10",
  "--fragment-retries",
  "10",
  "--sleep-requests",
  "1",
];

let resolvedCookiesPath: string | null = null;

async function getCookiesPath(): Promise<string | null> {
  if (resolvedCookiesPath) {
    return resolvedCookiesPath;
  }

  if (config.YT_DLP_COOKIES_PATH) {
    resolvedCookiesPath = config.YT_DLP_COOKIES_PATH;
    return resolvedCookiesPath;
  }

  if (!config.YT_DLP_COOKIES_BASE64) {
    return null;
  }

  const filePath = path.join("/tmp", `yt-dlp-cookies-${randomUUID()}.txt`);
  const decoded = Buffer.from(config.YT_DLP_COOKIES_BASE64, "base64").toString(
    "utf8",
  );

  await fs.writeFile(filePath, decoded, { encoding: "utf8", mode: 0o600 });
  resolvedCookiesPath = filePath;
  return resolvedCookiesPath;
}

async function buildYtDlpArgs(extraArgs: string[]): Promise<string[]> {
  const args: string[] = [];

  if (config.YT_DLP_PROXY_URL) {
    args.push("--proxy", config.YT_DLP_PROXY_URL);
  }

  const cookiesPath = await getCookiesPath();
  if (cookiesPath) {
    args.push("--cookies", cookiesPath);
  }

  args.push(...extraArgs);
  return args;
}

async function cleanupExpiredArtifacts(): Promise<void> {
  const result = await pool.query(
    `SELECT id, output_path FROM jobs WHERE expires_at IS NOT NULL AND expires_at < NOW()`,
  );

  for (const row of result.rows as Array<{
    id: string;
    output_path: string | null;
  }>) {
    if (row.output_path) {
      try {
        await fs.unlink(row.output_path);
      } catch {
        // Ignore missing files and continue cleanup.
      }
    }

    await pool.query(`DELETE FROM jobs WHERE id = $1`, [row.id]);
  }
}

function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr || `Command failed with exit code ${code}`));
      }
    });
  });
}

async function fetchDuration(url: string): Promise<number> {
  const output = await runCommand(
    config.YT_DLP_BIN,
    await buildYtDlpArgs(["--print", "duration", ...YT_DLP_COMMON_ARGS, url]),
  );
  const duration = Number(
    output.split("\n").find((line) => line.trim().length > 0),
  );
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Unable to determine video duration");
  }
  return duration;
}

async function convertToMp3(
  job: ConvertPayload,
): Promise<{ outputPath: string; duration: number; title: string }> {
  await fs.mkdir(config.OUTPUT_DIR, { recursive: true });

  const duration = await fetchDuration(job.sourceUrl);
  if (duration > job.maxVideoSeconds) {
    throw new Error(
      `Video exceeds max duration of ${job.maxVideoSeconds} seconds`,
    );
  }

  const target = path.join(config.OUTPUT_DIR, `${job.id}.mp3`);
  const title = await runCommand(
    config.YT_DLP_BIN,
    await buildYtDlpArgs([
      "--print",
      "title",
      ...YT_DLP_COMMON_ARGS,
      job.sourceUrl,
    ]),
  );

  const args = await buildYtDlpArgs([
    "-x",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",
    "-o",
    target,
    ...YT_DLP_COMMON_ARGS,
    job.sourceUrl,
  ]);

  await runCommand(config.YT_DLP_BIN, args);

  return {
    outputPath: target,
    duration,
    title: title.split("\n")[0]?.trim() || "Unknown Title",
  };
}

async function markProcessing(id: string): Promise<void> {
  await pool.query(
    `UPDATE jobs SET status = 'processing', updated_at = NOW() WHERE id = $1`,
    [id],
  );
}

async function markDone(
  id: string,
  outputPath: string,
  duration: number,
  title: string,
  ttlSeconds: number,
): Promise<void> {
  await pool.query(
    `UPDATE jobs
     SET status = 'done', output_path = $2, duration_seconds = $3, title = $4, updated_at = NOW(), expires_at = NOW() + ($5 || ' seconds')::interval
     WHERE id = $1`,
    [id, outputPath, duration, title, ttlSeconds.toString()],
  );
}

async function markFailed(id: string, message: string): Promise<void> {
  await pool.query(
    `UPDATE jobs SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1`,
    [id, message.slice(0, 1000)],
  );
}

const worker = new Worker(
  config.QUEUE_NAME,
  async (bullJob) => {
    const payload = bullJob.data as ConvertPayload;

    await markProcessing(payload.id);

    try {
      const converted = await convertToMp3(payload);
      await markDone(
        payload.id,
        converted.outputPath,
        converted.duration,
        converted.title,
        payload.downloadTtlSeconds,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown conversion error";
      await markFailed(payload.id, message);
      throw error;
    }
  },
  {
    concurrency: config.WORKER_CONCURRENCY,
    connection: { url: config.REDIS_URL },
  },
);

worker.on("ready", () => {
  console.log("worker ready");
});

worker.on("error", (error) => {
  console.error(error);
});

if (config.PORT) {
  const healthServer = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(200, { "content-type": "text/plain" });
    res.end("worker alive");
  });

  healthServer.listen(config.PORT, () => {
    console.log(`worker health server listening on ${config.PORT}`);
  });
}

setInterval(() => {
  void cleanupExpiredArtifacts().catch((error) => {
    console.error("cleanup task failed", error);
  });
}, 60_000);
