// The admin settings panel: everything the server lets an admin change at
// runtime, in one form. Fields are filled when the panel opens so a half-typed
// edit is not overwritten by the next delta; Save sends only what changed.

import type { AdminCommand, ServerInfo, Settings } from "@idle-sim/shared";

let current: Settings | null = null;
let server: ServerInfo | null = null;
let send: ((cmd: AdminCommand) => void) | null = null;
let open = false;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function setupSettings(sendCmd: (cmd: AdminCommand) => void): void {
  send = sendCmd;
  const panel = $("settings");
  const btn = $("settingsBtn");
  btn.onclick = () => {
    open = !open;
    panel.classList.toggle("hidden", !open);
    btn.classList.toggle("active", open);
    if (open) fill();
  };
  $("settingsClose").onclick = () => {
    open = false;
    panel.classList.add("hidden");
    btn.classList.remove("active");
  };
  $("settingsSave").onclick = save;
  $("setNews").onchange = () => ($("setFeeds").parentElement!.style.opacity = $<HTMLInputElement>("setNews").checked ? "1" : "0.5");
}

export function updateSettingsPanel(settings: Settings, info?: ServerInfo): void {
  current = settings;
  if (info) server = info;
  if (open && !panelDirty()) fill();
}

function fill(): void {
  if (!current) return;
  $<HTMLInputElement>("setAi").checked = current.aiEnabled;
  $<HTMLInputElement>("setBudget").value = current.budgetUsdPerHour.toFixed(2);
  $<HTMLInputElement>("setPop").value = String(current.populationMax);
  $<HTMLInputElement>("setNews").checked = current.newsEnabled;
  $<HTMLTextAreaElement>("setFeeds").value = current.newsFeeds.join("\n");
  $<HTMLTextAreaElement>("setFeeds").placeholder = (server?.defaultFeeds ?? []).join("\n") || "one RSS or Atom URL per line";
  $<HTMLInputElement>("setStory").checked = current.bigMomentsEnabled;
  $<HTMLInputElement>("setNotify").checked = current.notifyEnabled;
  $("notifyNote").textContent = server?.notifyConfigured
    ? "Petitions, arrivals, births, deaths and new seasons go to your phone."
    : "The server has no NTFY_URL or DISCORD_WEBHOOK, so nothing is sent yet.";
  $("setFeeds").parentElement!.style.opacity = current.newsEnabled ? "1" : "0.5";
  $("settingsMsg").textContent = "";
}

/** True when the form differs from the last known settings (the admin is mid-edit). */
function panelDirty(): boolean {
  if (!current) return false;
  const feeds = parseFeeds($<HTMLTextAreaElement>("setFeeds").value);
  return (
    $<HTMLInputElement>("setAi").checked !== current.aiEnabled ||
    Number($<HTMLInputElement>("setBudget").value) !== current.budgetUsdPerHour ||
    Number($<HTMLInputElement>("setPop").value) !== current.populationMax ||
    $<HTMLInputElement>("setNews").checked !== current.newsEnabled ||
    feeds.join("\n") !== current.newsFeeds.join("\n") ||
    $<HTMLInputElement>("setStory").checked !== current.bigMomentsEnabled ||
    $<HTMLInputElement>("setNotify").checked !== current.notifyEnabled
  );
}

function parseFeeds(text: string): string[] {
  return text
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function save(): void {
  if (!current || !send) return;
  const cmds: AdminCommand[] = [];
  const ai = $<HTMLInputElement>("setAi").checked;
  if (ai !== current.aiEnabled) cmds.push({ cmd: "setAi", enabled: ai });
  const budget = Number($<HTMLInputElement>("setBudget").value);
  if (Number.isFinite(budget) && budget !== current.budgetUsdPerHour) cmds.push({ cmd: "setBudget", usdPerHour: budget });
  const pop = Math.floor(Number($<HTMLInputElement>("setPop").value));
  if (Number.isFinite(pop) && pop !== current.populationMax) cmds.push({ cmd: "setPopulationMax", value: pop });
  const news = $<HTMLInputElement>("setNews").checked;
  if (news !== current.newsEnabled) cmds.push({ cmd: "setNews", enabled: news });
  const feeds = parseFeeds($<HTMLTextAreaElement>("setFeeds").value);
  if (feeds.join("\n") !== current.newsFeeds.join("\n")) cmds.push({ cmd: "setNewsFeeds", feeds });
  const story = $<HTMLInputElement>("setStory").checked;
  if (story !== current.bigMomentsEnabled) cmds.push({ cmd: "setBigMoments", enabled: story });
  const notify = $<HTMLInputElement>("setNotify").checked;
  if (notify !== current.notifyEnabled) cmds.push({ cmd: "setNotify", enabled: notify });
  if (!cmds.length) {
    $("settingsMsg").textContent = "Nothing changed.";
    return;
  }
  for (const c of cmds) send(c);
  $("settingsMsg").textContent = `Saved ${cmds.length} change${cmds.length > 1 ? "s" : ""}.`;
}
