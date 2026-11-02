import { ApiError } from "../../shared/api/client.ts";

const common: Record<number, readonly string[]> = {
  400: ["invalid_request", "invalid_idempotency_key"],
  403: ["subscription_required", "allowance_exceeded", "trial_identity_required", "trial_already_used", "trial_work_limited"],
  429: ["queue_full", "trial_rate_limited"],
};
const operations = {
  restoration: {
    404: ["project_not_found", "drive_file_unavailable"],
    409: ["source_restore_not_available", "source_identity_unverified", "source_changed", "generation_in_progress", "drive_reconnect_required", "stale_connection"],
    422: ["unsupported_video", "source_too_large", "source_too_long", "youtube_video_restricted", "youtube_video_unavailable", "youtube_verification_required"],
    429: ["retry_cooldown"],
  },
  retry: {
    404: ["project_not_found", "drive_file_unavailable"],
    409: ["import_not_failed", "drive_reconnect_required", "stale_connection"],
    422: ["unsupported_video", "source_too_large", "source_too_long", "youtube_video_restricted", "youtube_video_unavailable", "youtube_verification_required"],
    429: ["retry_cooldown"],
  },
  transcription: {
    404: ["project_not_found"],
    409: ["source_not_ready", "transcript_not_ready", "requires_reimport", "generation_in_progress", "transcription_not_failed", "transcription_not_retryable"],
  },
  generation: {
    503: ["generation_controls_unavailable"],
    400: ["invalid_outputs", "feature_unavailable", "invalid_generation_controls"],
    403: ["feature_not_in_plan", "generation_threads_unavailable"],
    404: ["project_not_found"],
    409: ["transcription_not_retryable", "source_not_ready", "transcript_not_ready", "source_allowance_expired", "requires_reimport", "generation_in_progress"],
  },
  import: {
    400: ["invalid_source", "invalid_youtube_link"],
    404: ["drive_file_unavailable"],
    409: ["drive_reconnect_required", "stale_connection"],
    422: [
      "unsupported_video",
      "source_too_large",
      "source_too_long",
      "youtube_video_restricted",
      "youtube_video_unavailable",
      "youtube_verification_required",
    ],
  },
} satisfies Record<string, Record<number, readonly string[]>>;

export function canReleaseSubmission(
  error: unknown,
  operation: keyof typeof operations,
  hadPending: boolean,
) {
  // A rejection cannot rule out a commit from an earlier unanswered request.
  if (hadPending || !(error instanceof ApiError)) {
    return false;
  }
  const codes: Record<number, readonly string[]> = operations[operation];
  return (
    common[error.status]?.includes(error.code) === true ||
    codes[error.status]?.includes(error.code) === true
  );
}
