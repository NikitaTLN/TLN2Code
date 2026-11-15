import { useAtomValue } from "@effect/atom-react";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import type { ServerProvider } from "@t3tools/contracts";
import {
  collectLimitAccounts,
  collectLimitPools,
  cursorUsageWindowDetails,
  displayLimitWindows,
  formatDuration,
  type LimitPool,
  type LimitPoolWindow,
  tightestLimitWindow,
} from "@t3tools/shared/usageLimits";
import { useNavigate } from "@tanstack/react-router";
import { memo } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { providerClients } from "../settings/providerDriverMeta";
import { barColor } from "../usage/UsageLimits";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ComposerControl } from "./ComposerControl";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { limitTone, UsageRow } from "./ThreadDetailsUsage";

const providerLabel = (driver: ServerProvider["driver"]) =>
  providerClients.get(driver)?.label ?? String(driver);

const windowLabel = (pool: LimitPool, window: LimitPoolWindow) =>
  (pool.driver === "cursor" ? cursorUsageWindowDetails(window.id)?.label : undefined) ??
  window.label;

interface RingSegment {
  readonly driver: ServerProvider["driver"];
  readonly color: string;
  readonly left: number;
}

/** One arc per provider across enabled environments, filled by its tightest window's quota left. */
export const ComposerUsageRing = memo(function ComposerUsageRing() {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const navigate = useNavigate();
  const pools = collectLimitPools(collectLimitAccounts(presentations), now);
  const segments = pools.flatMap((pool): RingSegment[] => {
    const tightest = tightestLimitWindow(pool);
    return tightest
      ? [{ driver: pool.driver, color: barColor(pool.driver), left: tightest.remainingPercent }]
      : [];
  });
  if (segments.length === 0) return null;

  const summary = segments
    .map((segment) => `${providerLabel(segment.driver)} ${segment.left}% left`)
    .join(", ");
  // Opening asks each connected server for fresh limits; the shared throttle skips recent reads.
  const refresh = () => {
    for (const [environmentId, presentation] of presentations) {
      if (presentation.connection.phase !== "connected" || presentation.serverConfig === null) {
        continue;
      }
      void refreshUsageLimits(
        environmentId,
        () => refreshProviders({ environmentId, input: {} }),
        true,
      ).catch(() => undefined);
    }
  };

  return (
    <Popover onOpenChange={(open) => open && refresh()}>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={200}
        render={
          <ComposerControl size="sm" className="px-1" aria-label={`Usage limits. ${summary}`} />
        }
      >
        <UsageRingGlyph segments={segments} />
      </PopoverTrigger>
      <PopoverPopup side="top" align="start" width="md" padding="compact">
        <div className="flex max-h-[min(28rem,60vh)] flex-col gap-3 overflow-y-auto">
          {pools.map((pool) => (
            <PoolLimits key={pool.driver} pool={pool} now={now} />
          ))}
        </div>
        <div className="mt-2 flex justify-end border-t border-border/60 pt-2">
          <Button size="xs" variant="ghost" onClick={() => void navigate({ to: "/usage" })}>
            Open usage
          </Button>
        </div>
      </PopoverPopup>
    </Popover>
  );
});

// Lengths are in hundredths of the circumference (pathLength 100); arcs start at 12 o'clock.
const SEGMENT_GAP = 5;

function UsageRingGlyph({ segments }: { readonly segments: readonly RingSegment[] }) {
  const gap = segments.length > 1 ? SEGMENT_GAP : 0;
  const span = 100 / segments.length;
  const arc = (start: number, length: number, stroke: string) => (
    <circle
      cx="10"
      cy="10"
      r="7.5"
      fill="none"
      strokeWidth="3"
      pathLength={100}
      strokeDasharray={`${length} ${100 - length}`}
      strokeDashoffset={-start}
      style={{ stroke }}
    />
  );
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="size-5 -rotate-90">
      {segments.map((segment, index) => {
        const start = index * span + gap / 2;
        const length = span - gap;
        const filled = segment.left > 0 ? Math.max(1.5, (length * segment.left) / 100) : 0;
        return (
          <g key={segment.driver}>
            {arc(start, length, `color-mix(in oklab, ${segment.color} 22%, transparent)`)}
            {filled > 0 ? arc(start, filled, segment.color) : null}
          </g>
        );
      })}
    </svg>
  );
}

function PoolLimits({ pool, now }: { readonly pool: LimitPool; readonly now: number }) {
  const label = providerLabel(pool.driver);
  return (
    <section className="flex flex-col gap-1">
      <h3 className="flex items-center gap-2 px-2.5 text-xs font-medium text-foreground">
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: barColor(pool.driver) }}
        />
        <ProviderInstanceIcon
          driverKind={pool.driver}
          displayName={label}
          className="size-4"
          iconClassName="size-3.5 text-foreground/80"
        />
        {label}
        {pool.accounts.length > 1 ? (
          <span className="font-normal text-muted-foreground">{pool.accounts.length} accounts</span>
        ) : null}
      </h3>
      <div className="grid grid-cols-[auto_minmax(3rem,1fr)_auto] gap-x-3 text-xs">
        {displayLimitWindows(pool).map((window) => {
          const name = windowLabel(pool, window);
          const left = window.remainingPercent;
          const reset = window.resets.find((entry) => entry.at > now);
          const resetsIn = reset ? formatDuration(reset.at - now) : null;
          return (
            <UsageRow
              key={`${window.kind}:${window.id}`}
              label={name}
              fill={left}
              tone={limitTone(left)}
              value={resetsIn ? `${left}% · ${resetsIn}` : `${left}%`}
              ariaValue={`${left}% left${resetsIn ? `, resets in ${resetsIn}` : ""}`}
              tooltip={
                <>
                  <span className="text-foreground">
                    {name}: {left}% left
                  </span>
                  {resetsIn ? (
                    <span className="text-muted-foreground">Resets in {resetsIn}</span>
                  ) : null}
                </>
              }
            />
          );
        })}
      </div>
    </section>
  );
}
