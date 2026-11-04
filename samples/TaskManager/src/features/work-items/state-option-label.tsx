import { cn } from "@/lib/utils";
import { stateDescription, stateMeta } from "@/lib/work-items-data";

/**
 * One option in a state picker: the state name with the team's description
 * underneath (STATE_DESCRIPTIONS), plus the state's colour dot.
 *
 * Mirrors the category picker's CategoryOptionLabel exactly, including the
 * `.w95-cat-desc` class — win95.css uses it to hide the blurb on the collapsed
 * trigger and to flip it to white on the dark-blue highlighted row, so the
 * description stays readable in BOTH the normal and highlighted states.
 */
export function StateOptionLabel({ state }: { state: string }) {
  const meta = stateMeta(state);
  const description = stateDescription(state);
  return (
    <span className="flex min-w-0 items-start gap-2">
      <span
        className={cn(
          "w95-state-dot mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
          meta.dot,
        )}
      />
      <span className="min-w-0">
        <span className="block font-bold leading-tight">{state}</span>
        {description && (
          <span className="w95-cat-desc block max-w-[17rem] text-[10px] leading-tight">
            {description}
          </span>
        )}
      </span>
    </span>
  );
}
