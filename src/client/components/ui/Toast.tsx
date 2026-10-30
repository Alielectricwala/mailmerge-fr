// Toast notifications for completed actions (errors that block a task are shown inline instead)
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, X, XCircle } from "lucide-react";
import { cn } from "../../lib/cn";

interface Toast {
  id: number;
  tone: "success" | "error";
  title: string;
  description?: string;
}

interface ToastApi {
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (tone: Toast["tone"], title: string, description?: string) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-3), { id, tone, title, description }]);
      setTimeout(() => dismiss(id), tone === "error" ? 8000 : 4000);
    },
    [dismiss]
  );

  const api = useMemo<ToastApi>(
    () => ({ success: (t, d) => push("success", t, d), error: (t, d) => push("error", t, d) }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed bottom-4 right-4 z-toast flex w-full max-w-sm flex-col gap-2" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className="pointer-events-auto flex items-start gap-3 rounded-lg border border-line bg-surface p-3.5 shadow-pop animate-pop-in" role={t.tone === "error" ? "alert" : "status"}>
              {t.tone === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />}
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">{t.title}</p>
                {t.description && <p className={cn("mt-0.5 text-[13px] leading-5 text-ink-subtle")}>{t.description}</p>}
              </div>
              <button className="text-ink-faint hover:text-ink" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
