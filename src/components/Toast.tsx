interface ToastProps {
  toast: { kind: 'ok' | 'err'; text: string } | null;
}

export function Toast({ toast }: ToastProps) {
  if (!toast) return null;
  return <div className={`toast ${toast.kind}`}>{toast.text}</div>;
}
