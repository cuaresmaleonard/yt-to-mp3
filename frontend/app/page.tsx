"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type ActiveJob = {
  id: string;
  source_url: string;
  status: string;
  error_message: string | null;
  title: string | null;
  duration_seconds: number | null;
};

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

function ProgressBar({ status }: { status: string }): JSX.Element {
  const getProgress = (st: string): number => {
    switch (st) {
      case "queued":
        return 25;
      case "processing":
        return 75;
      case "done":
        return 100;
      default:
        return 0;
    }
  };

  const getLabel = (st: string): string => {
    switch (st) {
      case "queued":
        return "Waiting in queue...";
      case "processing":
        return "Converting to MP3...";
      case "done":
        return "Complete!";
      case "failed":
        return "Failed";
      default:
        return st;
    }
  };

  if (status === "failed") {
    return <div className="progress-bar failed">Failed</div>;
  }

  const progress = getProgress(status);

  return (
    <div className="progress-container">
      <div className="progress-bar-track">
        <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
      </div>
      <p className="progress-label">{getLabel(status)}</p>
    </div>
  );
}

export default function Home(): JSX.Element {
  const [videoUrl, setVideoUrl] = useState("");
  const [userId, setUserId] = useState("");
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [message, setMessage] = useState<string>("");
  const [messageType, setMessageType] = useState<"ok" | "error" | null>(null);
  const [loading, setLoading] = useState(false);
  const [showUserPanel, setShowUserPanel] = useState(false);

  const modeLabel = useMemo(
    () => (userId.trim() ? "Signed-in mode" : "Guest mode"),
    [userId],
  );

  async function loadJob(jobId: string): Promise<void> {
    const response = await fetch(`${apiBase}/api/jobs/${jobId}`, {
      credentials: "include",
      headers: userId.trim() ? { "x-user-id": userId.trim() } : {},
    });

    const data = await response.json();
    if (!response.ok) {
      setMessageType("error");
      setMessage(data.error ?? "Unable to load job status");
      return;
    }

    setActiveJob(data as ActiveJob);
  }

  async function submitJob(event: FormEvent): Promise<void> {
    event.preventDefault();
    setMessage("");
    setMessageType(null);
    setLoading(true);

    try {
      const response = await fetch(`${apiBase}/api/jobs`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(userId.trim() ? { "x-user-id": userId.trim() } : {}),
        },
        body: JSON.stringify({ url: videoUrl }),
      });

      const data = await response.json();
      if (!response.ok) {
        setMessageType("error");
        setMessage(data.error ?? "Failed to queue job");
      } else {
        setMessageType("ok");
        setMessage(`Queued job ${data.id}`);
        setActiveJob({
          id: data.id,
          source_url: videoUrl,
          status: data.status,
          error_message: null,
          title: null,
          duration_seconds: null,
        });
        setVideoUrl("");
        await loadJob(data.id);
      }
    } catch {
      setMessageType("error");
      setMessage("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function getDownload(jobId: string): Promise<void> {
    const tokenRes = await fetch(
      `${apiBase}/api/jobs/${jobId}/download-token`,
      {
        method: "POST",
        credentials: "include",
        headers: userId.trim() ? { "x-user-id": userId.trim() } : {},
      },
    );

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.token) {
      setMessageType("error");
      setMessage(tokenData.error ?? "Download is not available yet");
      return;
    }

    window.open(`${apiBase}/api/download/${tokenData.token}`, "_blank");
  }

  useEffect(() => {
    if (!activeJob) {
      return;
    }

    if (activeJob.status === "done" || activeJob.status === "failed") {
      return;
    }

    const interval = setInterval(() => {
      void loadJob(activeJob.id);
    }, 3000);

    return () => {
      clearInterval(interval);
    };
  }, [activeJob, userId]);

  return (
    <main className="app-shell">
      {/* Header with Mode Toggle and User ID Control */}
      <header className="app-header">
        <div className="header-container">
          <button
            className={`mode-button ${userId.trim() ? "signed-in" : "guest"}`}
            onClick={() => setShowUserPanel(!showUserPanel)}
            title="Toggle user ID panel"
          >
            <span className="mode-dot" />
            {modeLabel}
          </button>

          {showUserPanel && (
            <div className="user-panel">
              <label htmlFor="header-user-id">User ID (optional)</label>
              <div className="user-input-row">
                <input
                  className="field user-field"
                  id="header-user-id"
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                  placeholder="Leave blank for guest mode"
                />
                {userId.trim() && (
                  <button
                    className="clear-btn"
                    onClick={() => setUserId("")}
                    title="Clear user ID"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="container">
        <section className="card hero">
          <div className="hero-copy-block">
            <h1 className="headline">YouTube to MP3</h1>
            <p className="subtext">
              Paste a video URL, wait for processing to finish, then download
              the MP3 when it is ready.
            </p>
          </div>
        </section>

        <section className="card">
          <div className="section-head">
            <h2 className="section-title">New Conversion</h2>
            <p className="subtext">
              Guest mode works immediately. Add a user ID in the header to
              simulate a signed-in session while testing limits.
            </p>
          </div>

          <form onSubmit={submitJob} className="form-grid">
            <div className="field-block">
              <label htmlFor="url">YouTube URL</label>
              <input
                className="field"
                id="url"
                required
                value={videoUrl}
                onChange={(event) => setVideoUrl(event.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
              />
            </div>

            <div className="button-row">
              <button className="primary-btn" type="submit" disabled={loading}>
                {loading ? "Queueing Job..." : "Convert to MP3"}
              </button>
            </div>
          </form>
          {message ? (
            <p
              className={
                messageType === "error" ? "message-error" : "message-ok"
              }
            >
              {message}
            </p>
          ) : null}
        </section>

        <section className="card status-card">
          {activeJob ? (
            <>
              <div className="section-head compact">
                <div>
                  <h2 className="section-title">Active Download Job</h2>
                  <p className="job-title">
                    {activeJob.title ?? "Resolving video title..."}
                  </p>
                </div>
                <span className={`status-badge ${activeJob.status}`}>
                  {activeJob.status}
                </span>
              </div>

              {/* Progress Bar for queued/processing states */}
              {(activeJob.status === "queued" ||
                activeJob.status === "processing") && (
                <ProgressBar status={activeJob.status} />
              )}

              <p className="job-url">{activeJob.source_url}</p>
              <div className="meta-grid">
                <div className="meta-card">
                  <span className="meta-label">Status</span>
                  <span className="meta-value">{activeJob.status}</span>
                </div>
                <div className="meta-card">
                  <span className="meta-label">Duration</span>
                  <span className="meta-value">
                    {activeJob.duration_seconds
                      ? `${activeJob.duration_seconds}s`
                      : "Waiting for metadata"}
                  </span>
                </div>
              </div>
              {activeJob.error_message ? (
                <div className="message-error">
                  Error: {activeJob.error_message}
                </div>
              ) : null}
              {activeJob.status === "done" ? (
                <button
                  className="primary-btn"
                  onClick={() => void getDownload(activeJob.id)}
                >
                  Download MP3
                </button>
              ) : (
                <p className="hint-text">
                  The download button appears automatically as soon as the MP3
                  is ready.
                </p>
              )}
            </>
          ) : (
            <p className="helper-text">
              Submit a YouTube link to start conversion.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
