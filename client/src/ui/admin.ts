import type { AdminCommand } from "@idle-sim/shared";

export function setupAdminBar(isAdmin: boolean, send: (cmd: AdminCommand) => void): void {
  const bar = document.getElementById("admin")!;
  bar.classList.toggle("hidden", !isAdmin);
  if (!isAdmin || bar.dataset.ready) return;
  bar.dataset.ready = "1";
  bar.querySelectorAll<HTMLButtonElement>("button[data-cmd]").forEach((b) => {
    b.onclick = () => {
      const cmd = b.dataset.cmd as "pause" | "resume" | "reset";
      if (cmd === "reset" && !confirm("Reset the whole world? This cannot be undone.")) return;
      send({ cmd });
    };
  });
  bar.querySelectorAll<HTMLButtonElement>("button[data-speed]").forEach((b) => {
    b.onclick = () => send({ cmd: "speed", value: Number(b.dataset.speed) });
  });
}

export function showAdminMessage(ok: boolean, message?: string): void {
  const el = document.getElementById("adminMsg")!;
  el.textContent = message ?? "";
  el.style.color = ok ? "" : "#f0a8a6";
  setTimeout(() => (el.textContent = ""), 3000);
}

export function highlightSpeed(speed: number, paused: boolean): void {
  document.querySelectorAll<HTMLButtonElement>("#admin button[data-speed]").forEach((b) => {
    b.classList.toggle("active", !paused && Number(b.dataset.speed) === speed);
  });
}
