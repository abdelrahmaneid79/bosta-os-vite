import { Modal } from "./Modal";
import { Button } from "./index";

/** Confirmation gate for risky/reversal actions. */
export function Confirm({
  open, title, message, confirmLabel = "Confirm", danger, busy, onConfirm, onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm text-muted">{message}</p>
      <div className="mt-5 flex gap-2">
        <Button variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? "danger" : "primary"} className="flex-1" disabled={busy} onClick={onConfirm}>
          {busy ? "…" : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
