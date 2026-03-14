'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { cn } from '../lib/utils';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastCtx {
  toast: (message: string, type?: ToastType) => void;
}

const Ctx = createContext<ToastCtx>({ toast: () => {} });

const toneMap = {
  success: {
    icon: CheckCircle2,
    className: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  },
  error: {
    icon: TriangleAlert,
    className: 'border-rose-200 bg-rose-50 text-rose-950',
  },
  info: {
    icon: Info,
    className: 'border-primary/25 bg-primary/10 text-foreground',
  },
} satisfies Record<ToastType, { icon: typeof Info; className: string }>;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(() => remove(id), 3500);
    },
    [remove],
  );

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-6 right-6 z-[9999] flex max-w-sm flex-col gap-3">
        {toasts.map((toastItem) => (
          <ToastItem key={toastItem.id} toast={toastItem} onDismiss={() => remove(toastItem.id)} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);
  const tone = toneMap[toast.type];
  const Icon = tone.icon;

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      onClick={onDismiss}
      className={cn(
        'pointer-events-auto flex cursor-pointer items-start gap-3 rounded-xl border p-4 shadow-[0_18px_50px_-26px_rgba(15,23,42,0.45)] transition-all',
        tone.className,
        visible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="flex-1 text-sm font-medium leading-6">{toast.message}</div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={(event) => {
          event.stopPropagation();
          onDismiss();
        }}
        className="inline-flex size-6 items-center justify-center rounded-md text-current/65 transition-colors hover:bg-black/5 hover:text-current"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export function useToast() {
  return useContext(Ctx);
}
