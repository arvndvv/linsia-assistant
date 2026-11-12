import type { ReactNode } from 'react';

/** A panel that slides over the right side. Click outside or press Close to dismiss. */
export function Drawer({ title, onClose, children, wide = false }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/55" onClick={onClose}>
      <div className={`drawer-in flex h-full w-full flex-col border-l border-line bg-ink ${wide ? 'max-w-3xl' : 'max-w-lg'}`} onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0 flex-1 font-medium">{title}</div>
          <button onClick={onClose} className="shrink-0 text-xs text-soft hover:text-white">
            Close
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>
      </div>
    </div>
  );
}
