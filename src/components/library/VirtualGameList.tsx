import { useMemo } from "react";
import AutoSizer from "react-virtualized-auto-sizer";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import type { LibraryEntry } from "../../types";
import LibraryRow from "./LibraryRow";

const ROW_HEIGHT = 120;

type VirtualGameListProps = {
  entries: LibraryEntry[];
  onInstall: (entry: LibraryEntry) => void;
  onPlay?: (entry: LibraryEntry) => void;
};

type ListData = {
  entries: LibraryEntry[];
  onInstall: (entry: LibraryEntry) => void;
  onPlay?: (entry: LibraryEntry) => void;
};

export default function VirtualGameList({
  entries,
  onInstall,
  onPlay
}: VirtualGameListProps) {
  const itemData = useMemo<ListData>(
    () => ({ entries, onInstall, onPlay }),
    [entries, onInstall, onPlay]
  );

  return (
    <div className="h-full min-h-[420px]">
      <AutoSizer>
        {({ height, width }) => (
          <FixedSizeList
            height={height}
            width={width}
            itemCount={entries.length}
            itemSize={ROW_HEIGHT}
            itemData={itemData}
            overscanCount={6}
            className="scrollbar-elegant"
          >
            {ListRow}
          </FixedSizeList>
        )}
      </AutoSizer>
    </div>
  );
}

function ListRow({ index, style, data }: ListChildComponentProps<ListData>) {
  const entry = data.entries[index];
  if (!entry) {
    return null;
  }

  return (
    <div style={{ ...style, paddingBottom: 12 }}>
      <LibraryRow
        game={entry.game}
        onInstall={() => data.onInstall(entry)}
        onPlay={data.onPlay ? () => data.onPlay?.(entry) : undefined}
      />
    </div>
  );
}
