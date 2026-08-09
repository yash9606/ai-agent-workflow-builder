export type AppErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "QUOTA_EXCEEDED"
  | "INVALID_STATE"
  | "ALREADY_APPROVED"
  | "EXTERNAL_ERROR"
  | "INTERNAL_ERROR"
  | "AUTH_DISABLED"
  | "MISCONFIGURED";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly publicMessage: string;
  readonly details?: unknown;

  constructor(
    code: AppErrorCode,
    publicMessage: string,
    status = 400,
    details?: unknown
  ) {
    super(publicMessage);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.publicMessage = publicMessage;
    this.details = details;
  }
}

export function toActionError(error: unknown): {
  status: number;
  body: { message: string };
} {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: { message: error.publicMessage },
    };
  }

  console.error("Unhandled error:", error);
  return {
    status: 500,
    body: { message: "Internal server error" },
  };
}

export function jsonError(error: unknown): Response {
  const { status, body } = toActionError(error);
  return Response.json(body, { status });
}
