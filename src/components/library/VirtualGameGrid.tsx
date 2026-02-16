import { useMemo } from "react";
import AutoSizer from "react-virtualized-auto-sizer";
import { FixedSizeGrid, type GridChildComponentProps } from "react-window";
import type { LibraryEntry } from "../../types";
import LibraryCard from "./LibraryCard";

const CARD_WIDTH = 300;
const CARD_HEIGHT = 340;
const GAP = 16;

type VirtualGameGridProps = {
  entries: LibraryEntry[];
  onInstall: (entry: LibraryEntry) => void;
  onPlay?: (entry: LibraryEntry) => void;
  onStop?: (entry: LibraryEntry) => void;
  runningIds?: Set<string>;
};

type GridData = {
  entries: LibraryEntry[];
  columnCount: number;
  onInstall: (entry: LibraryEntry) => void;
  onPlay?: (entry: LibraryEntry) => void;
  onStop?: (entry: LibraryEntry) => void;
  runningIds?: Set<string>;
};

export default function VirtualGameGrid({
  entries,
  onInstall,
  onPlay,
  onStop,
  runningIds
}: VirtualGameGridProps) {
  const itemData = useMemo<GridData>(
    () => ({ entries, columnCount: 1, onInstall, onPlay, onStop, runningIds }),
    [entries, onInstall, onPlay, onStop, runningIds]
  );

  return (
    <div className="h-full min-h-[420px]">
      <AutoSizer>
        {({ height, width }) => {
          const columnCount = Math.max(1, Math.floor((width + GAP) / (CARD_WIDTH + GAP)));
          const rowCount = Math.ceil(entries.length / columnCount);
          const gridData = { ...itemData, columnCount };

          return (
            <FixedSizeGrid
              columnCount={columnCount}
              columnWidth={CARD_WIDTH + GAP}
              height={height}
              rowCount={rowCount}
              rowHeight={CARD_HEIGHT + GAP}
              width={width}
              itemData={gridData}
              overscanRowCount={2}
              className="scrollbar-elegant"
            >
              {GridCell}
            </FixedSizeGrid>
          );
        }}
      </AutoSizer>
    </div>
  );
}

function GridCell({ columnIndex, rowIndex, style, data }: GridChildComponentProps<GridData>) {
  const { entries, columnCount, onInstall, onPlay, onStop, runningIds } = data;
  const index = rowIndex * columnCount + columnIndex;

  if (index >= entries.length) {
    return null;
  }

  const entry = entries[index];
  const running = Boolean(runningIds?.has(entry.game.id));

  return (
    <div
      style={{
        ...style,
        left: Number(style.left) + GAP / 2,
        top: Number(style.top) + GAP / 2,
        width: Number(style.width) - GAP,
        height: Number(style.height) - GAP
      }}
    >
      <LibraryCard
        game={entry.game}
        running={running}
        onInstall={() => onInstall(entry)}
        onPlay={onPlay ? () => onPlay(entry) : undefined}
        onStop={onStop ? () => onStop(entry) : undefined}
      />
    </div>
  );
}
