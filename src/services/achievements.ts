import { invoke, isTauri } from "@tauri-apps/api/core";
import * as api from "./api";

export async function unlockAchievement(gameId: string, achievementKey: string, token?: string) {
  if (isTauri()) {
    await invoke("unlock_achievement", { gameId, achievementKey });
  } else if (token) {
    await api.requestAchievementUnlock(gameId, achievementKey, token);
  }

  showAchievementToast(achievementKey);
}

function showAchievementToast(achievementKey: string) {
  const container = document.createElement("div");
  container.className = "achievement-toast";
  container.innerHTML = `
    <div class="glass-panel flex items-center gap-4 p-4">
      <div class="h-14 w-14 rounded-xl bg-primary/20 text-primary flex items-center justify-center text-xl font-bold">
        ★
      </div>
      <div>
        <h3 class="text-sm font-semibold">Achievement unlocked</h3>
        <p class="text-xs text-text-secondary">${achievementKey}</p>
      </div>
    </div>
  `;

  document.body.appendChild(container);
  window.setTimeout(() => container.remove(), 5000);
}
