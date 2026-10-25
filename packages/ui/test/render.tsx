import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Tells React this is a test, so act() flushes renders and effects synchronously.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

/** Renders into a fresh div in document.body. Portals (Dialog, Select) render into body too. */
export function render(ui: ReactNode): { container: HTMLElement } {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  mounted.push({ root, container });
  return { container };
}

/** Unmounts everything render() mounted; use as afterEach(cleanup). */
export function cleanup(): void {
  for (const { root, container } of mounted.splice(0)) {
    act(() => {
      root.unmount();
    });
    container.remove();
  }
  document.body.replaceChildren();
}
