import { DownloadTask } from "../types";

export const downloads: DownloadTask[] = [
  {
    id: "d1",
    title: "Aurora Shift",
    progress: 42,
    speed: "92 MB/s",
    status: "downloading",
    eta: "11 min",
    gameId: "g-aurora"
  },
  {
    id: "d2",
    title: "Reefline",
    progress: 100,
    speed: "0 MB/s",
    status: "completed",
    eta: "Done",
    gameId: "g-reefline"
  },
  {
    id: "d3",
    title: "Veilborne",
    progress: 73,
    speed: "18 MB/s",
    status: "verifying",
    eta: "4 min",
    gameId: "g-veil"
  }
];
