export function ConfirmDialog({
  title,
  body,
  busy,
  confirmLabel = "מחיקה",
  busyLabel = "מוחק...",
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  busy?: boolean;
  confirmLabel?: string;
  busyLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-title">{title}</h2>
        <p>{body}</p>
        <div>
          <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>
            ביטול
          </button>
          <button type="button" className="danger-button" onClick={onConfirm} disabled={busy}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
