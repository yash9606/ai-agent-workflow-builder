import { verifyEventSecret } from "@/lib/auth/request-auth";
import { query } from "@/lib/db";
import { validateHttpUrl } from "@/lib/executor/http-step";
import { AppError, jsonError } from "@/lib/errors";
import type { JsonObject } from "@/lib/types";

export const runtime = "nodejs";

interface HasuraEventPayload {
  event?: {
    op?: string;
    data?: {
      new?: {
        id?: string;
        destination?: string;
        payload?: JsonObject;
        status?: string;
        channel?: string;
      } | null;
    };
  };
}

export async function POST(req: Request) {
  try {
    verifyEventSecret(req);

    let body: HasuraEventPayload;
    try {
      body = (await req.json()) as HasuraEventPayload;
    } catch {
      throw new AppError("VALIDATION_ERROR", "Invalid JSON body", 400);
    }

    const notification = body.event?.data?.new;
    if (!notification?.id) {
      return Response.json({ ok: true, skipped: true });
    }

    if (notification.status && notification.status !== "pending") {
      return Response.json({
        ok: true,
        skipped: true,
        reason: "already_handled",
      });
    }

    const destination = notification.destination;
    if (!destination || destination === "unset") {
      await query(
        `UPDATE notifications SET status = $2, error = $3 WHERE id = $1`,
        [notification.id, "skipped", "No destination configured"]
      );
      return Response.json({ ok: true, status: "skipped" });
    }

    try {
      validateHttpUrl(destination);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const response = await fetch(destination, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notification.payload ?? {}),
        signal: controller.signal,
        redirect: "manual",
      });
      clearTimeout(timer);

      if (response.status >= 300 && response.status < 400) {
        throw new Error(`Notification redirect blocked (${response.status})`);
      }

      if (!response.ok) {
        await query(
          `UPDATE notifications SET status = $2, error = $3 WHERE id = $1`,
          [
            notification.id,
            "failed",
            `Destination responded with HTTP ${response.status}`,
          ]
        );
        return Response.json({ ok: false, status: "failed" }, { status: 502 });
      }

      await query(
        `UPDATE notifications SET status = $2, error = NULL WHERE id = $1`,
        [notification.id, "delivered"]
      );
      return Response.json({ ok: true, status: "delivered" });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Delivery failed";
      await query(
        `UPDATE notifications SET status = $2, error = $3 WHERE id = $1`,
        [notification.id, "failed", message]
      );
      throw new AppError("EXTERNAL_ERROR", "Notification delivery failed", 502);
    }
  } catch (error) {
    return jsonError(error);
  }
}
