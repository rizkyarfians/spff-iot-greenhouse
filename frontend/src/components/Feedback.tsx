import { AlertCircle, Inbox, LoaderCircle, RefreshCw } from 'lucide-react';

export function LoadingSkeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="feedback"><AlertCircle size={28} /><p>{message}</p><button className="secondary-button" onClick={onRetry}><RefreshCw size={16} /> Coba Lagi</button></div>;
}

export function EmptyState({ message }: { message: string }) {
  return <div className="feedback"><Inbox size={28} /><p>{message}</p></div>;
}

export function Spinner() { return <LoaderCircle className="spinner" size={16} aria-hidden="true" />; }
