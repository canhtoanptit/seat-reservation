"use client";

import { useEffect, useRef } from "react";

/**
 * A small modal error dialog built on the native <dialog> element.
 *  - ESC, the OK button (form method="dialog"), and a click on the backdrop
 *    all close it. Each route through `onClose`, so the caller can run
 *    follow-up work (e.g. router.refresh()).
 *  - Focus is trapped by the browser when shown with .showModal().
 */
export function ErrorDialog({
  open,
  title,
  message,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    // The native <dialog> dispatches click events on itself when the
    // backdrop (outside the content box) is clicked. Distinguish via target.
    if (e.target === e.currentTarget) {
      ref.current?.close();
    }
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={handleBackdropClick}
      className="w-[90vw] max-w-sm rounded-lg bg-white p-0 shadow-2xl backdrop:bg-black/40"
    >
      <div className="p-6">
        <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
        <p className="mt-2 text-sm text-zinc-700">{message}</p>
        <form method="dialog" className="mt-5">
          <button
            type="submit"
            autoFocus
            className="w-full rounded bg-zinc-900 py-2 text-sm font-medium text-white hover:bg-zinc-700"
          >
            OK
          </button>
        </form>
      </div>
    </dialog>
  );
}
