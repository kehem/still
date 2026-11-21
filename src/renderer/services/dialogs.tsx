import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';

/** Avoid blocking Chromium dialogs in Electron: they can leave Windows inputs unfocusable. */
function desktopDialog(message: string, alertOnly = false): Promise<boolean> {
  return new Promise(resolve => {
    const previous = document.activeElement as HTMLElement | null;
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    const finish = (answer: boolean) => {
      root.unmount(); container.remove();
      if (previous?.isConnected) previous.focus();
      resolve(answer);
    };
    root.render(<Confirmation message={message} alertOnly={alertOnly} finish={finish} />);
  });
}
function Confirmation({ message, alertOnly, finish }: { message: string; alertOnly: boolean; finish: (answer: boolean) => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { panel.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, []);
  return <div className="no-drag fixed inset-0 z-[100] grid place-items-center bg-black/25 p-6">
    <div role="alertdialog" aria-modal="true" aria-label={alertOnly ? 'Notice' : 'Confirm action'} ref={panel}
      className="w-full max-w-md rounded-xl border border-border bg-bg p-6 text-text shadow-xl"
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); finish(false); }
        if (event.key === 'Tab') {
          const buttons = [...panel.current!.querySelectorAll('button')];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          event.preventDefault(); buttons[(index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
        }
      }}>
      <h2 className="mb-3 text-[15px] font-semibold">{alertOnly ? 'Notice' : 'Confirm action'}</h2>
      <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text-secondary">{message}</p>
      <div className="mt-6 flex justify-end gap-2">
        {!alertOnly && <button type="button" className="rounded-md border border-border px-4 py-2 text-[12px]" onClick={() => finish(false)}>Cancel</button>}
        <button type="button" className="rounded-md bg-accent px-4 py-2 text-[12px] text-white" onClick={() => finish(true)}>{alertOnly ? 'Close' : 'Confirm'}</button>
      </div>
    </div>
  </div>;
}
let pending: Promise<unknown> = Promise.resolve();
export function confirmAction(message: string): Promise<boolean> {
  if (!window.still) return Promise.resolve(window.confirm(message));
  const task = pending.then(() => desktopDialog(message)); pending = task.catch(() => {}); return task;
}
export function showAlert(message: string): Promise<void> {
  if (!window.still) { window.alert(message); return Promise.resolve(); }
  const task = pending.then(() => desktopDialog(message, true)).then(() => {}); pending = task.catch(() => {}); return task;
}
