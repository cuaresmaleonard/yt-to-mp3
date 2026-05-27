import crypto from "node:crypto";
import type { Request, Response } from "express";

export type Principal = {
  type: "guest" | "user";
  id: string;
};

const GUEST_COOKIE = "guest_session";

export function resolvePrincipal(req: Request, res: Response): Principal {
  const userId = req.header("x-user-id")?.trim();
  if (userId) {
    return { type: "user", id: userId };
  }

  const existingGuestId = req.cookies?.[GUEST_COOKIE] as string | undefined;
  if (existingGuestId) {
    return { type: "guest", id: existingGuestId };
  }

  const newGuestId = crypto.randomUUID();
  res.cookie(GUEST_COOKIE, newGuestId, {
    httpOnly: true,
    sameSite: "none",
    secure: true,
    maxAge: 1000 * 60 * 60 * 24 * 14,
  });

  return { type: "guest", id: newGuestId };
}
