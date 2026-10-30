// A small floating label that follows the mouse over the map.

let el: HTMLElement | null = null;

function node(): HTMLElement {
  if (!el) el = document.getElementById("tooltip")!;
  return el;
}

export function showTooltip(html: string, clientX: number, clientY: number): void {
  const t = node();
  t.innerHTML = html;
  t.classList.remove("hidden");
  const pad = 14;
  const w = t.offsetWidth;
  const h = t.offsetHeight;
  let x = clientX + pad;
  let y = clientY + pad;
  if (x + w > window.innerWidth - 8) x = clientX - w - pad;
  if (y + h > window.innerHeight - 8) y = clientY - h - pad;
  t.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

export function hideTooltip(): void {
  node().classList.add("hidden");
}
