import type { AdminCommand, Petition } from "@idle-sim/shared";
import { TICKS_PER_DAY } from "@idle-sim/shared";

let sendCmd: ((cmd: AdminCommand) => void) | null = null;
let lastKey = "";

export function setupInbox(isAdmin: boolean, send: (cmd: AdminCommand) => void): void {
  sendCmd = isAdmin ? send : null;
  lastKey = "";
}

export function renderInbox(petitions: Petition[]): void {
  const open = petitions.filter((p) => p.status === "open");
  const recent = petitions.filter((p) => p.status !== "open").slice(-3).reverse();
  const key = JSON.stringify([open.map((p) => p.id), recent.map((p) => p.id + p.status), !!sendCmd]);
  if (key === lastKey) return;
  lastKey = key;

  document.getElementById("inboxCount")!.textContent = open.length ? `${open.length} waiting` : "";
  const list = document.getElementById("inboxList")!;
  list.innerHTML = "";
  if (!open.length && !recent.length) {
    list.innerHTML = `<div class="empty">No one has asked for anything yet.</div>`;
    return;
  }
  for (const p of [...open, ...recent]) list.appendChild(renderPetition(p));
}

function renderPetition(p: Petition): HTMLElement {
  const div = document.createElement("div");
  div.className = `pet ${p.status}`;
  const what = p.amount ? `${p.amount} ${p.ask}` : p.ask === "newcomer" ? "a newcomer" : "a blessing";
  const day = Math.floor(p.tick / TICKS_PER_DAY) + 1;
  div.innerHTML = `<div class="who">${esc(p.villagerName)} asks for ${esc(what)} <span class="muted">· day ${day}</span></div>
    <div class="reason">"${esc(p.reason)}"</div>`;
  if (p.status !== "open" && p.response) {
    const r = document.createElement("div");
    r.className = "muted";
    r.textContent = `You whispered: "${p.response}"`;
    div.appendChild(r);
  }
  if (p.status === "open" && sendCmd) {
    const actions = document.createElement("div");
    actions.className = "actions";
    const send = sendCmd;
    const btn = (label: string, onClick: () => void, cls = "") => {
      const b = document.createElement("button");
      b.textContent = label;
      b.className = cls;
      b.onclick = onClick;
      actions.appendChild(b);
    };
    btn("Grant", () => send({ cmd: "grant", petitionId: p.id }));
    if (p.amount) btn("Half", () => send({ cmd: "grant", petitionId: p.id, amount: Math.ceil(p.amount! / 2) }));
    btn("Grant + whisper", () => {
      const message = prompt(`Whisper something to ${p.villagerName} along with the gift:`) ?? undefined;
      send({ cmd: "grant", petitionId: p.id, message: message || undefined });
    });
    btn("Deny", () => {
      const message = prompt(`Stay silent, or whisper a reason to ${p.villagerName} (optional):`);
      if (message === null) return;
      send({ cmd: "deny", petitionId: p.id, message: message || undefined });
    }, "danger");
    div.appendChild(actions);
  }
  return div;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
