import { Cpu, HardDrive, Monitor } from "lucide-react";
import type { Game } from "../../types";

type RequirementsTabProps = {
  game: Game;
};

export default function RequirementsTab({ game }: RequirementsTabProps) {
  const requirements = game.systemRequirements;

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-xl font-semibold">
          <Cpu className="text-primary" size={20} />
          Minimum requirements
        </h3>
        <div className="space-y-3 text-sm text-text-secondary">
          <RequirementItem label="OS" value={requirements.minimum.os} />
          <RequirementItem label="Processor" value={requirements.minimum.processor} />
          <RequirementItem label="Memory" value={requirements.minimum.memory} />
          <RequirementItem label="Graphics" value={requirements.minimum.graphics} />
          <RequirementItem label="Storage" value={requirements.minimum.storage} />
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-xl font-semibold">
          <Monitor className="text-success" size={20} />
          Recommended requirements
        </h3>
        <div className="space-y-3 text-sm text-text-secondary">
          <RequirementItem label="OS" value={requirements.recommended.os} />
          <RequirementItem label="Processor" value={requirements.recommended.processor} />
          <RequirementItem label="Memory" value={requirements.recommended.memory} />
          <RequirementItem label="Graphics" value={requirements.recommended.graphics} />
          <RequirementItem label="Storage" value={requirements.recommended.storage} />
        </div>
      </div>

      <div className="glass-card flex items-start gap-3 p-4 text-sm text-text-secondary lg:col-span-2">
        <HardDrive className="text-primary" size={18} />
        Keep 15% free storage available for shader cache and hotfix patches.
      </div>
    </div>
  );
}

function RequirementItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-4">
      <span className="text-text-muted">{label}</span>
      <span className="text-text-primary">{value}</span>
    </div>
  );
}
