import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, XCircle, X } from 'lucide-react';

type ToastKind = 'success' | 'error';
interface Toast { id: number; message: string; kind: ToastKind }
const ToastContext = createContext<(message: string, kind: ToastKind) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback((message: string, kind: ToastKind) => {
    const id = Date.now();
    setToasts((current) => [...current, { id, message, kind }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4000);
  }, []);
  const value = useMemo(() => notify, [notify]);
  return <ToastContext.Provider value={value}>{children}<div className="toast-stack" aria-live="polite">{toasts.map((toast) => <div className={`toast toast-${toast.kind}`} key={toast.id}>{toast.kind === 'success' ? <CheckCircle2 /> : <XCircle />}<span>{toast.message}</span><button onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))} aria-label="Tutup notifikasi"><X size={16} /></button></div>)}</div></ToastContext.Provider>;
}
