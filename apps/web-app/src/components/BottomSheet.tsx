import type { ReactNode } from "react";
import { X } from "lucide-react";

export function BottomSheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="bottom-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="bottom-sheet-handle" aria-hidden="true" />
        <header>
          <h2>{title}</h2>
          <button type="button" aria-label="סגירה" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
