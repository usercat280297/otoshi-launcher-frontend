import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Gamepad2, Home } from "lucide-react";
import { useGamepad } from "../hooks/useGamepad";
import { useGames } from "../hooks/useGames";
import { useLibrary } from "../hooks/useLibrary";

const getColumns = (width: number) => {
  if (width < 640) {
    return 2;
  }
  if (width < 1024) {
    return 3;
  }
  return 5;
};

export default function BigPicturePage() {
  const navigate = useNavigate();
  const gamepad = useGamepad();
  const { entries } = useLibrary();
  const { games } = useGames();
  const [columns, setColumns] = useState(() => getColumns(window.innerWidth));
  const [focusedIndex, setFocusedIndex] = useState(0);
  const lastActionRef = useRef(0);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const items = useMemo(() => {
    return entries.length > 0 ? entries.map((entry) => entry.game) : games;
  }, [entries, games]);

  useEffect(() => {
    const handleResize = () => {
      setColumns(getColumns(window.innerWidth));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!gamepad.connected || items.length === 0) {
      return;
    }

    const now = Date.now();
    if (now - lastActionRef.current < 180) {
      return;
    }

    const [axisX = 0, axisY = 0] = gamepad.axes;
    const left = gamepad.buttons[14] || axisX < -0.6;
    const right = gamepad.buttons[15] || axisX > 0.6;
    const up = gamepad.buttons[12] || axisY < -0.6;
    const down = gamepad.buttons[13] || axisY > 0.6;

    const nextIndex = (delta: number) => {
      lastActionRef.current = now;
      setFocusedIndex((prev) => {
        const updated = Math.max(0, Math.min(items.length - 1, prev + delta));
        return updated;
      });
    };

    if (left) {
      nextIndex(-1);
    } else if (right) {
      nextIndex(1);
    } else if (up) {
      nextIndex(-columns);
    } else if (down) {
      nextIndex(columns);
    } else if (gamepad.buttons[0]) {
      lastActionRef.current = now;
      const selected = items[focusedIndex];
      if (selected) {
        navigate(`/games/${selected.slug}`);
      }
    } else if (gamepad.buttons[1]) {
      lastActionRef.current = now;
      navigate(-1);
    }
  }, [gamepad, items, columns, focusedIndex, navigate]);

  useEffect(() => {
    itemRefs.current[focusedIndex]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest"
    });
  }, [focusedIndex]);

  return (
    <div className="h-screen overflow-y-auto bg-background px-8 py-10 md:px-12 scrollbar-elegant">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-text-muted">
            Big Picture Mode
          </p>
          <h1 className="text-4xl font-semibold">Your Games</h1>
        </div>
        <div className="flex items-center gap-3 text-sm text-text-secondary">
          <button
            onClick={gamepad.refresh}
            className="flex items-center gap-2 rounded-full border border-background-border px-4 py-2 text-sm text-text-secondary transition hover:text-text-primary"
          >
            <Gamepad2 size={16} />
            {gamepad.connected ? "Controller connected" : "Press any button"}
          </button>
          <button
            onClick={() => navigate("/library")}
            className="flex items-center gap-2 rounded-full border border-background-border px-4 py-2 text-sm text-text-secondary transition hover:text-text-primary"
          >
            <Home size={16} />
            Exit
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="glass-panel mt-10 flex h-64 items-center justify-center text-sm text-text-secondary">
          Your library is empty.
        </div>
      ) : (
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {items.map((game, index) => (
            <button
              key={game.id}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              onClick={() => navigate(`/games/${game.slug}`)}
              className={`group relative overflow-hidden rounded-2xl border transition ${
                index === focusedIndex
                  ? "border-primary shadow-[0_0_30px_rgba(38,187,255,0.45)]"
                  : "border-background-border"
              }`}
            >
              <img
                src={game.heroImage || game.headerImage}
                alt={game.title}
                className="aspect-[3/4] w-full object-cover transition duration-300 group-hover:scale-105"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background/60 to-transparent p-4 text-left">
                <p className="text-sm font-semibold">{game.title}</p>
                <p className="text-xs text-text-secondary">{game.tagline}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="fixed bottom-6 left-6 flex gap-4 text-xs uppercase tracking-[0.3em] text-text-secondary">
        <span className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-success text-black">
            A
          </span>
          Select
        </span>
        <span className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-red text-white">
            B
          </span>
          Back
        </span>
      </div>
    </div>
  );
}
