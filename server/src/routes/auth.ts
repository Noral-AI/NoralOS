import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { eq } from "drizzle-orm";
import type { Db } from "@noralos/db";
import { authUsers } from "@noralos/db";
import {
  authSessionSchema,
  currentUserProfileSchema,
  updateCurrentUserProfileSchema,
} from "@noralos/shared";
import { unauthorized } from "../errors.js";
import { validate } from "../middleware/validate.js";

async function loadCurrentUserProfile(db: Db, userId: string) {
  const user = await db
    .select({
      id: authUsers.id,
      email: authUsers.email,
      name: authUsers.name,
      image: authUsers.image,
    })
    .from(authUsers)
    .where(eq(authUsers.id, userId))
    .then((rows) => rows[0] ?? null);

  if (!user) {
    throw unauthorized("Signed-in user not found");
  }

  return currentUserProfileSchema.parse({
    id: user.id,
    email: user.email ?? null,
    name: user.name ?? null,
    image: user.image ?? null,
  });
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function authRoutes(db: Db) {
  const router = Router();

  // Cross-product SSO validation (see cross-product-sso-design.md). A
  // sibling *.noral.ai product (voice, dumbo, …) forwards the browser's
  // cookies server-side; we answer with the session's user identity, or
  // 401. Browser-originated cross-origin calls can't read the response (no
  // CORS is configured), and when NORAL_SSO_VALIDATE_SECRET is set the
  // caller must also present it in x-noral-sso-secret.
  router.get("/session/validate", async (req, res) => {
    const requiredSecret = process.env.NORAL_SSO_VALIDATE_SECRET?.trim();
    if (requiredSecret) {
      const presented = req.header("x-noral-sso-secret") ?? "";
      if (!constantTimeStringEqual(presented, requiredSecret)) {
        throw unauthorized("Invalid internal caller credential");
      }
    }

    if (req.actor.type !== "board" || !req.actor.userId || req.actor.source !== "session") {
      throw unauthorized("No valid session");
    }

    const user = await loadCurrentUserProfile(db, req.actor.userId);
    res.json({ user: { id: user.id, email: user.email, name: user.name } });
  });

  router.get("/get-session", async (req, res) => {
    if (req.actor.type !== "board" || !req.actor.userId) {
      throw unauthorized("Board authentication required");
    }

    const user = await loadCurrentUserProfile(db, req.actor.userId);
    res.json(authSessionSchema.parse({
      session: {
        id: `paperclip:${req.actor.source ?? "none"}:${req.actor.userId}`,
        userId: req.actor.userId,
      },
      user,
    }));
  });

  router.get("/profile", async (req, res) => {
    if (req.actor.type !== "board" || !req.actor.userId) {
      throw unauthorized("Board authentication required");
    }

    res.json(await loadCurrentUserProfile(db, req.actor.userId));
  });

  router.patch("/profile", validate(updateCurrentUserProfileSchema), async (req, res) => {
    if (req.actor.type !== "board" || !req.actor.userId) {
      throw unauthorized("Board authentication required");
    }

    const patch = updateCurrentUserProfileSchema.parse(req.body);
    const now = new Date();

    const updated = await db
      .update(authUsers)
      .set({
        name: patch.name,
        ...(patch.image !== undefined ? { image: patch.image } : {}),
        updatedAt: now,
      })
      .where(eq(authUsers.id, req.actor.userId))
      .returning({
        id: authUsers.id,
        email: authUsers.email,
        name: authUsers.name,
        image: authUsers.image,
      })
      .then((rows) => rows[0] ?? null);

    if (!updated) {
      throw unauthorized("Signed-in user not found");
    }

    res.json(currentUserProfileSchema.parse({
      id: updated.id,
      email: updated.email ?? null,
      name: updated.name ?? null,
      image: updated.image ?? null,
    }));
  });

  return router;
}
