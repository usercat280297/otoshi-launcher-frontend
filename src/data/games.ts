import { Game, SystemRequirements } from "../types";

const sampleVideo = {
  url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  thumbnail:
    "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80"
};

const sharedRequirements: SystemRequirements = {
  minimum: {
    os: "Windows 10 64-bit",
    processor: "Intel i5-8400 / Ryzen 5 2600",
    memory: "12 GB RAM",
    graphics: "GTX 1060 / RX 580",
    storage: "80 GB SSD"
  },
  recommended: {
    os: "Windows 11 64-bit",
    processor: "Intel i7-12700K / Ryzen 7 5800X",
    memory: "16 GB RAM",
    graphics: "RTX 3070 / RX 6800",
    storage: "80 GB NVMe SSD"
  }
};

export const games: Game[] = [
  {
    id: "g-aurora",
    slug: "aurora-shift",
    title: "Aurora Shift",
    tagline: "Pilot a living starship across fractured galaxies.",
    shortDescription: "A cinematic space odyssey with tactical combat and modular ships.",
    description:
      "Aurora Shift is a cinematic space odyssey blending tactical combat with narrative exploration. Command a modular starship, broker alliances, and unlock reality-bending tech.",
    studio: "Arclight Studios",
    releaseDate: "2025-08-12",
    genres: ["Action", "RPG", "Space Opera"],
    price: 39.99,
    discountPercent: 30,
    rating: 4.6,
    headerImage:
      "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=900&q=80",
    heroImage:
      "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=1400&q=80",
    backgroundImage:
      "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?auto=format&fit=crop&w=1600&q=80",
    screenshots: [
      "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1454789548928-9efd52dc4031?auto=format&fit=crop&w=1200&q=80"
    ],
    videos: [sampleVideo],
    systemRequirements: sharedRequirements,
    spotlightColor: "from-blue-500/30 to-cyan-300/20",
    installed: true,
    playtimeHours: 122.4,
    isFavorite: true
  },
  {
    id: "g-emberfall",
    slug: "emberfall",
    title: "Emberfall",
    tagline: "Forge cities from volcanic relics.",
    shortDescription: "Heat-economy strategy builder on a volcanic archipelago.",
    description:
      "Emberfall is a strategy builder set in a volcanic archipelago. Direct magma channels, design sky bridges, and master heat-based economies to survive the ash storms.",
    studio: "Gravemark",
    releaseDate: "2024-11-03",
    genres: ["Strategy", "Simulation"],
    price: 29.99,
    discountPercent: 0,
    rating: 4.2,
    headerImage:
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80",
    heroImage:
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1400&q=80",
    backgroundImage:
      "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1600&q=80",
    screenshots: [
      "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1476611338391-6f395a0ebc86?auto=format&fit=crop&w=1200&q=80"
    ],
    videos: [sampleVideo],
    systemRequirements: sharedRequirements,
    spotlightColor: "from-orange-500/30 to-amber-300/20",
    installed: false,
    playtimeHours: 8.2
  },
  {
    id: "g-reefline",
    slug: "reefline",
    title: "Reefline",
    tagline: "Dive into neon oceans and decode lost biomes.",
    shortDescription: "Co-op deep-sea exploration with drone mapping and puzzles.",
    description:
      "Reefline blends deep-sea exploration with cooperative puzzle hunting. Deploy bio-drones, map coral labyrinths, and uncover an ancient signal buried below.",
    studio: "Midnight Current",
    releaseDate: "2025-03-22",
    genres: ["Adventure", "Co-op"],
    price: 24.99,
    discountPercent: 15,
    rating: 4.8,
    headerImage:
      "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=80",
    heroImage:
      "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1400&q=80",
    backgroundImage:
      "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1600&q=80",
    screenshots: [
      "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=1200&q=80"
    ],
    videos: [sampleVideo],
    systemRequirements: sharedRequirements,
    spotlightColor: "from-emerald-400/30 to-sky-300/20",
    installed: true,
    playtimeHours: 44.7
  },
  {
    id: "g-sable",
    slug: "sable-circuit",
    title: "Sable Circuit",
    tagline: "Synthwave racer with tactical boosts and sabotage.",
    shortDescription: "Neon racer with EMP traps, drift boosts, and sabotage.",
    description:
      "Sable Circuit is a high-speed combat racer. Chain drift boosts, deploy EMP traps, and climb the neon championship ladder.",
    studio: "Chrome Hollow",
    releaseDate: "2025-05-18",
    genres: ["Racing", "Arcade"],
    price: 19.99,
    discountPercent: 40,
    rating: 4.1,
    headerImage:
      "https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=900&q=80",
    heroImage:
      "https://images.unsplash.com/photo-1489515217757-5fd1be406fef?auto=format&fit=crop&w=1400&q=80",
    backgroundImage:
      "https://images.unsplash.com/photo-1493238792000-8113da705763?auto=format&fit=crop&w=1600&q=80",
    screenshots: [
      "https://images.unsplash.com/photo-1493238792000-8113da705763?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1489515217757-5fd1be406fef?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=1200&q=80"
    ],
    videos: [sampleVideo],
    systemRequirements: sharedRequirements,
    spotlightColor: "from-orange-500/30 to-amber-300/20",
    installed: false,
    playtimeHours: 2.1
  },
  {
    id: "g-veil",
    slug: "veilborne",
    title: "Veilborne",
    tagline: "A tactical RPG where every spell distorts time.",
    shortDescription: "Time-bending tactical RPG with layered timelines.",
    description:
      "Veilborne is a tactical RPG with a real-time timewarp layer. Cast chronomancy to split timelines and rewrite battle outcomes.",
    studio: "Northwind Atelier",
    releaseDate: "2024-09-09",
    genres: ["RPG", "Tactics"],
    price: 49.99,
    discountPercent: 10,
    rating: 4.7,
    headerImage:
      "https://images.unsplash.com/photo-1471879832106-c7ab9e0cee23?auto=format&fit=crop&w=900&q=80",
    heroImage:
      "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1400&q=80",
    backgroundImage:
      "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1600&q=80",
    screenshots: [
      "https://images.unsplash.com/photo-1471879832106-c7ab9e0cee23?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80"
    ],
    videos: [sampleVideo],
    systemRequirements: sharedRequirements,
    spotlightColor: "from-indigo-500/30 to-slate-400/20",
    installed: true,
    playtimeHours: 68.9
  },
  {
    id: "g-radiant",
    slug: "radiant-frontier",
    title: "Radiant Frontier",
    tagline: "Survive the first light on an alien world.",
    shortDescription: "Survival co-op across a tidally locked alien world.",
    description:
      "Radiant Frontier is a survival co-op set on a tidally locked planet. Manage perpetual dusk zones, craft colony tech, and negotiate with local factions.",
    studio: "Horizon Forge",
    releaseDate: "2025-12-02",
    genres: ["Survival", "Co-op", "Sci-Fi"],
    price: 34.99,
    discountPercent: 0,
    rating: 4.3,
    headerImage:
      "https://images.unsplash.com/photo-1496307653780-42ee777d4833?auto=format&fit=crop&w=900&q=80",
    heroImage:
      "https://images.unsplash.com/photo-1496307653780-42ee777d4833?auto=format&fit=crop&w=1400&q=80",
    backgroundImage:
      "https://images.unsplash.com/photo-1454789548928-9efd52dc4031?auto=format&fit=crop&w=1600&q=80",
    screenshots: [
      "https://images.unsplash.com/photo-1496307653780-42ee777d4833?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1454789548928-9efd52dc4031?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=1200&q=80"
    ],
    videos: [sampleVideo],
    systemRequirements: sharedRequirements,
    spotlightColor: "from-sky-500/30 to-blue-300/20",
    installed: false,
    playtimeHours: 0
  }
];
