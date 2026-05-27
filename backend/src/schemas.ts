import { z } from "zod";

export const CreateJobSchema = z.object({
  url: z.string().url(),
});

export function isLikelyYouTubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    return (
      host === "youtube.com" ||
      host === "youtu.be" ||
      host.endsWith("youtube.com")
    );
  } catch {
    return false;
  }
}
