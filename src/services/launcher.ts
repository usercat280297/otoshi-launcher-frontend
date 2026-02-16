import { invoke, isTauri } from "@tauri-apps/api/core";

import type { RendererOption } from "../utils/playOptions";

export type LaunchRequest = {
  gameId: string;
  slug: string;
  title: string;
  renderer: RendererOption;
  overlayEnabled: boolean;
  steamAppId?: string | null;
  executable?: string | null;
  gameDir?: string | null;
};

export type LaunchResult = {
  exePath: string;
  workingDir: string;
  args: string[];
  renderer: RendererOption;
  overlayEnabled: boolean;
  launchedAsAdmin?: boolean;
};

export type GameLaunchPref = {
  gameId: string;
  requireAdmin: boolean;
  askEveryTime: boolean;
  updatedAt: number;
};

export type RunningGame = {
  gameId: string;
  title: string;
  pid: number;
  startedAt: number;
  sessionId: string;
  launchedAsAdmin: boolean;
  overlayEnabled: boolean;
};

export async function launchGame(payload: LaunchRequest): Promise<LaunchResult> {
  if (!isTauri()) {
    throw new Error("Launch is only available in the desktop app.");
  }
  return invoke<LaunchResult>("launch_game", payload);
}

export async function getRunningGames(): Promise<RunningGame[]> {
  if (!isTauri()) {
    return [];
  }
  return invoke<RunningGame[]>("get_running_games");
}

export async function stopGame(gameId: string): Promise<void> {
  if (!isTauri()) {
    return;
  }
  await invoke("stop_game", { gameId });
}

export async function getGameLaunchPref(gameId: string): Promise<GameLaunchPref | null> {
  if (!isTauri()) {
    return null;
  }
  return invoke<GameLaunchPref | null>("get_game_launch_pref", { gameId });
}

export async function setGameLaunchPref(
  gameId: string,
  requireAdmin: boolean,
  askEveryTime = false
): Promise<GameLaunchPref> {
  if (!isTauri()) {
    return {
      gameId,
      requireAdmin,
      askEveryTime,
      updatedAt: Math.floor(Date.now() / 1000),
    };
  }
  return invoke<GameLaunchPref>("set_game_launch_pref", {
    payload: {
      gameId,
      requireAdmin,
      askEveryTime,
    },
  });
}
