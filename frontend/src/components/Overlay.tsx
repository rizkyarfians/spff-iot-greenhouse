import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab' && ref.current) {
        const focusable = [...ref.current.querySelectorAll<HTMLElement>('button,[href],select,[tabindex]:not([tabindex="-1"])')];
        if (!focusable.length) return;
        const first = focusable[0]; const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [onClose]);
  return ref;
}

export function ConfirmationDialog({ open, title, description, confirmLabel, onConfirm, onClose }: { open: boolean; title: string; description: string; confirmLabel: string; onConfirm: () => void; onClose: () => void }) {
  const ref = useDialog(onClose);
  if (!open) return null;
  return <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" className="dialog"><h2 id="confirm-title">{title}</h2><p>{description}</p><div className="dialog-actions"><button className="secondary-button" onClick={onClose}>Batal</button><button className="primary-button" onClick={onConfirm}>{confirmLabel}</button></div></div></div>;
}

export function DetailDrawer({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useDialog(onClose);
  if (!open) return null;
  return <div className="overlay drawer-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><aside ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="drawer-title" className="drawer"><header><h2 id="drawer-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="Tutup detail"><X /></button></header>{children}</aside></div>;
}
