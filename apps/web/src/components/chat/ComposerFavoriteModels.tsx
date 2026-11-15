import type { EnvironmentId, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { resolveSelectableModel } from "@t3tools/shared/model";
import { memo } from "react";

import { useEnvironmentModelPreferences } from "../../hooks/useSettings";
import type { AppModelOption } from "../../modelSelection";
import {
  isProviderInstancePickerVisible,
  matchesLockedProvider,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerControl } from "./ComposerControl";
import { resolveModelPickerSelectedModel } from "./ModelPickerContent";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { getDisplayModelName, getTriggerDisplayModelName } from "./providerIconUtils";

const MAX_CHIPS = 4;

/** One-click switches between starred models this thread can use right now. */
export const ComposerFavoriteModels = memo(function ComposerFavoriteModels(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>;
  readonly selectedInstanceId: ProviderInstanceId;
  readonly selectedModel: string;
  readonly lockedProvider: ProviderDriverKind | null;
  readonly lockedContinuationGroupKey: string | null | undefined;
  readonly getModelDisabledReason: (instanceId: ProviderInstanceId, model: string) => string | null;
  readonly onProviderModelSelect: (instanceId: ProviderInstanceId, model: string) => void;
}) {
  const { favorites } = useEnvironmentModelPreferences(props.environmentId);
  const chips = favorites.flatMap((favorite) => {
    const entry = props.instanceEntries.find(
      (candidate) => candidate.instanceId === favorite.provider,
    );
    if (
      !entry ||
      !isProviderInstancePickerVisible(entry) ||
      !matchesLockedProvider(entry, props.lockedProvider, props.lockedContinuationGroupKey)
    ) {
      return [];
    }
    const options = props.modelOptionsByInstance.get(entry.instanceId) ?? [];
    const option = resolveModelPickerSelectedModel({
      driverKind: entry.driverKind,
      model: favorite.model,
      options,
    });
    const model = resolveSelectableModel(entry.driverKind, favorite.model, options);
    if (
      !option ||
      option.isUnavailable ||
      !model ||
      props.getModelDisabledReason(entry.instanceId, model)
    ) {
      return [];
    }
    return [{ entry, model, option }];
  });
  if (chips.length === 0) return null;

  return (
    // Shares leftover footer width with the controls; chips that do not fit wrap to a clipped
    // second line, so only whole chips show and the model picker keeps its room.
    <div
      role="group"
      aria-label="Starred models"
      className="me-2 hidden h-7 min-w-0 flex-[1_1_0%] flex-wrap items-center gap-x-0.5 gap-y-4 overflow-hidden @min-[40rem]/composer-footer:flex"
    >
      {chips.slice(0, MAX_CHIPS).map(({ entry, model, option }) => {
        const active =
          entry.instanceId === props.selectedInstanceId && model === props.selectedModel;
        const fullName = `${entry.displayName} · ${getDisplayModelName(option)}`;
        return (
          <Tooltip key={`${entry.instanceId}:${model}`}>
            <TooltipTrigger
              render={
                <ComposerControl
                  size="xs"
                  aria-pressed={active}
                  aria-label={fullName}
                  onClick={() => {
                    if (!active) props.onProviderModelSelect(entry.instanceId, model);
                  }}
                />
              }
            >
              <ProviderInstanceIcon
                driverKind={entry.driverKind}
                displayName={entry.displayName}
                accentColor={entry.accentColor}
                acpRegistryAgentId={entry.acpRegistryAgentId}
                acpRegistryIconUrl={entry.acpRegistryIconUrl}
                className="size-3.5"
                iconClassName="size-3.5"
              />
              <span data-composer-control-label className="max-w-24 truncate">
                {getTriggerDisplayModelName(option, entry.driverKind)}
              </span>
            </TooltipTrigger>
            <TooltipPopup side="top">{fullName}</TooltipPopup>
          </Tooltip>
        );
      })}
    </div>
  );
});
