# yt-to-mp3

Standalone YouTube-to-MP3 web app scaffold with optional sign-in, queue worker processing, and local Docker-first deployment.

## Services

- `frontend` - Next.js UI for guest and signed-in job submission.
- `backend` - Express API for job creation/status/download tokens.
- `worker` - BullMQ worker for conversion pipeline (`yt-dlp` + `ffmpeg`).
- `redis` - Queue broker.
- `postgres` - Job metadata storage.

## Architecture Sequence

```mermaid
sequenceDiagram
	autonumber
	participant U as User Browser
	participant F as Frontend (Next.js)
	participant B as Backend API (Express)
	participant R as Redis/BullMQ
	participant W as Worker
	participant P as Postgres
	participant S as Shared Media Volume

	U->>F: Submit YouTube URL
	F->>B: POST /api/jobs
	B->>P: Insert job (queued)
	B->>R: Enqueue convert job
	B-->>F: 202 Accepted + jobId

	loop Every 3s until done/failed
		F->>B: GET /api/jobs/:id
		B->>P: Read job status
		B-->>F: queued/processing/done/failed
	end

	R-->>W: Deliver queued job
	W->>P: Update status = processing
	W->>W: yt-dlp fetch metadata + extract mp3
	W->>S: Write output mp3 file
	W->>P: Update status = done + output_path + title + expires_at

	U->>F: Click Download MP3
	F->>B: POST /api/jobs/:id/download-token
	B-->>F: Signed token (JWT)
	F->>B: GET /api/download/:token
	B->>P: Verify ownership + expiry + output_path
	B->>S: Read mp3 file
	B-->>U: Stream file (video title as filename)
```

## Quick Start

1. Copy `.env.example` to `.env` and adjust values.
2. Run `docker compose up --build` from the project root.
3. Open `http://localhost:3000`.

## Notes

- This scaffold enforces a 15-minute max duration by default.
- Guest mode is enabled via signed cookie sessions.
- Signed-in mode is currently header-based placeholder (`x-user-id`) and should be replaced with OAuth/email auth in the next phase.
