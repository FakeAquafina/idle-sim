import type { AdminCommand, Petition, Proposal } from "@idle-sim/shared";
import { TICKS_PER_DAY } from "@idle-sim/shared";

let sendCmd: ((cmd: AdminCommand) => void) | null = null;
let lastKey = "";

export function setupInbox(isAdmin: boolean, send: (cmd: AdminCommand) => void): void {
  sendCmd = isAdmin ? send : null;
  lastKey = "";
}

export function renderInbox(petitions: Petition[], proposals: Proposal[] = []): void {
  const proposed = petitions.filter((p) => p.status === "proposed");
  const open = petitions.filter((p) => p.status === "open");
  const recent = petitions.filter((p) => p.status !== "open" && p.status !== "proposed").slice(-3).reverse();
  // Only the admin sees the moderator's work; viewers see petitions alone.
  const shown = sendCmd ? proposals.filter((p) => p.status === "writing" || p.status === "pending" || p.status === "failed").concat(proposals.filter((p) => p.status === "approved" || p.status === "rejected").slice(-2)) : [];
  const key = JSON.stringify([proposed.map((p) => p.id + p.supporters.length), open.map((p) => p.id), recent.map((p) => p.id + p.status), shown.map((p) => p.id + p.status), !!sendCmd]);
  if (key === lastKey) return;
  lastKey = key;

  const pending = shown.filter((p) => p.status === "pending").length;
  document.getElementById("inboxCount")!.textContent = [open.length ? `${open.length} waiting` : "", pending ? `${pending} to approve` : ""].filter(Boolean).join(" · ");
  const list = document.getElementById("inboxList")!;
  list.innerHTML = "";
  if (!open.length && !recent.length && !proposed.length && !shown.length) {
    list.innerHTML = `<div class="empty">No one has asked for anything yet.</div>`;
    return;
  }
  for (const p of shown) list.appendChild(renderProposal(p));
  for (const p of [...open, ...proposed, ...recent]) list.appendChild(renderPetition(p));
}

/** A moderator proposal: what Opus wrote, and the owner's approve/reject. */
function renderProposal(p: Proposal): HTMLElement {
  const div = document.createElement("div");
  div.className = `pet proposal ${p.status}`;
  if (p.status === "writing") {
    div.innerHTML = `<div class="who">Moderator <span class="muted">· writing…</span></div><div class="reason">${esc(p.petitionText)}</div>`;
    return div;
  }
  if (p.status === "failed") {
    div.innerHTML = `<div class="who">Moderator <span class="muted">· failed</span></div><div class="reason">${esc(p.petitionText)}</div><div class="muted">${esc(p.error ?? "no answer")}</div>`;
    return div;
  }
  const changes = (p.changes ?? []).map((c) => `<li><b>${esc(c.area)}</b>: ${esc(c.description)}</li>`).join("");
  div.innerHTML = `<div class="who">Moderator: ${esc(p.title ?? "proposal")} <span class="muted">· ${p.status}</span></div>
    <div class="reason">${esc(p.petitionText)}</div>
    <div class="prop-text">${esc(p.summary ?? "")}</div>
    <ul class="prop-changes">${changes}</ul>
    ${p.flavour ? `<div class="prop-text muted"><i>${esc(p.flavour)}</i></div>` : ""}
    ${p.risks ? `<div class="prop-text muted">Risks: ${esc(p.risks)}</div>` : ""}
    ${p.file ? `<div class="muted">Written to ${esc(p.file)}: start a Claude Code session and ask it to implement that file.</div>` : ""}`;
  if (p.status === "pending" && sendCmd) {
    const send = sendCmd;
    const actions = document.createElement("div");
    actions.className = "actions";
    const approve = document.createElement("button");
    approve.textContent = "Approve";
    approve.onclick = () => send({ cmd: "approveProposal", proposalId: p.id });
    const reject = document.createElement("button");
    reject.textContent = "Set aside";
    reject.className = "danger";
    reject.onclick = () => send({ cmd: "rejectProposal", proposalId: p.id });
    actions.append(approve, reject);
    div.appendChild(actions);
  }
  return div;
}

function renderPetition(p: Petition): HTMLElement {
  const div = document.createElement("div");
  div.className = `pet ${p.status}`;
  const what = p.amount ? `${p.amount} ${p.ask}` : p.ask === "newcomer" ? "a newcomer" : "a blessing";
  const day = Math.floor(p.tick / TICKS_PER_DAY) + 1;
  const verb = p.status === "proposed" ? "is gathering the village to ask for" : "asks for";
  div.innerHTML = `<div class="who">${esc(p.villagerName)} ${verb} ${esc(what)} <span class="muted">· day ${day}</span></div>
    <div class="reason">"${esc(p.reason)}"</div>`;
  if (p.status === "proposed") {
    const g = document.createElement("div");
    g.className = "muted";
    g.textContent = `${p.supporters.length} of ${p.needed} voices at the shrine so far`;
    div.appendChild(g);
  } else if (p.supporters.length > 1) {
    const g = document.createElement("div");
    g.className = "muted";
    g.textContent = `${p.supporters.length} villagers stood together for this`;
    div.appendChild(g);
  }
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
    btn("Moderate", () => send({ cmd: "moderate", petitionId: p.id }));
    div.appendChild(actions);
  }
  return div;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
