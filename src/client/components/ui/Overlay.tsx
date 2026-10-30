// Dialogs and drawers: portal, focus trap, Escape to close, focus restored on close
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button, IconButton } from "./Button";

// Page scroll lock shared by every open dialog/drawer. Counted, so closing them in any order
// (e.g. a confirm dialog opened from a drawer) always gives scrolling back.
let scrollLocks = 0;
function lockScroll() {
  if (scrollLocks++ === 0) {
    const gap = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;
  }
}
function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) {
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
  }
}

const FOCUSABLE ='a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useModalBehavior(open: boolean, onClose: () => void, panelRef: React.RefObject<HTMLDivElement | null>, dismissable: boolean) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    lockScroll();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissable) {
        e.stopPropagation();
        onCloseRef.current();
      }
      if (e.key === "Tab" && panel) {
        const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        if (!items.length) return;
        const firstItem = items[0]!;
        const lastItem = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === firstItem) {
          e.preventDefault();
          lastItem.focus();
        } else if (!e.shiftKey && document.activeElement === lastItem) {
          e.preventDefault();
          firstItem.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      unlockScroll();
      previouslyFocused?.focus?.();
    };
  }, [open, panelRef, dismissable]);
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** false while a request is running, so the dialog can't be closed mid-action */
  dismissable?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalBehavior(open, onClose, panelRef, dismissable);
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-modal flex items-start justify-center overflow-y-auto bg-navy/40 p-4 pt-[10vh] animate-fade-in" onMouseDown={(e) => dismissable && e.target === e.currentTarget && onClose()}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn("w-full rounded-xl border border-line bg-surface shadow-pop animate-pop-in", size === "sm" && "max-w-md", size === "md" && "max-w-lg", size === "lg" && "max-w-2xl")}
      >
        <header className="flex items-start justify-between gap-4 px-5 pt-5">
          <div>
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            {description && <p className="mt-1 text-[13px] leading-5 text-ink-subtle">{description}</p>}
          </div>
          {dismissable && (
            <IconButton label="Close" onClick={onClose} className="-mr-2 -mt-1">
              <X className="h-4 w-4" />
            </IconButton>
          )}
        </header>
        {children && <div className="px-5 pb-1 pt-4">{children}</div>}
        {footer && <footer className="mt-4 flex justify-end gap-2 border-t border-line bg-surface-muted px-5 py-3.5 rounded-b-xl">{footer}</footer>}
      </div>
    </div>,
    document.body
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  tone = "danger",
  loading = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "primary";
  loading?: boolean;
  children?: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      dismissable={!loading}
      footer={
        <>
          <Button onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={loading} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}

export function Drawer({ open, onClose, title, subtitle, children, footer, width = "md" }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: "md" | "lg" }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalBehavior(open, onClose, panelRef, true);
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-drawer flex justify-end bg-navy/30 animate-fade-in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn("flex h-full w-full flex-col border-l border-line bg-surface shadow-pop animate-slide-in", width === "md" ? "max-w-lg" : "max-w-2xl")}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-base font-semibold">
              {title}
            </h2>
            {subtitle && <div className="mt-0.5 truncate text-[13px] text-ink-subtle">{subtitle}</div>}
          </div>
          <IconButton label="Close" onClick={onClose} className="-mr-2">
            <X className="h-4 w-4" />
          </IconButton>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line bg-surface-muted px-6 py-3.5">{footer}</footer>}
      </div>
    </div>,
    document.body
  );
}
