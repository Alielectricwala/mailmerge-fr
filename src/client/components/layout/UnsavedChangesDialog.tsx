import type { Blocker } from "react-router-dom";
import { ConfirmDialog } from "../ui/Overlay";

export function UnsavedChangesDialog({ blocker }: { blocker: Blocker }) {
  return (
    <ConfirmDialog
      open={blocker.state === "blocked"}
      onClose={() => blocker.reset?.()}
      onConfirm={() => blocker.proceed?.()}
      title="Leave without saving?"
      description="Your changes on this page haven't been saved."
      confirmLabel="Discard changes"
    />
  );
}
