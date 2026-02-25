export type OverlayNotificationTone = "info" | "success" | "warning" | "error";

export type OverlayNotificationPayload = {
  id?: string;
  title: string;
  message: string;
  tone?: OverlayNotificationTone;
  imageUrl?: string | null;
  source?: string | null;
  durationMs?: number;
};

export const OVERLAY_NOTIFICATION_EVENT = "otoshi:notify";

export function emitOverlayNotification(payload: OverlayNotificationPayload) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<OverlayNotificationPayload>(OVERLAY_NOTIFICATION_EVENT, {
      detail: payload,
    })
  );
}
