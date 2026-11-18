import { useGT } from "gt-react";
import {
  closestCenter,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  EnvironmentId,
  ModelFavorite,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { resolveSelectableModel } from "@t3tools/shared/model";
import { AsyncResult } from "effect/reactivity";
import { memo, useRef, useState } from "react";

import {
  useEnvironmentModelPreferences,
  useUpdateEnvironmentModelPreferences,
} from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import type { AppModelOption } from "../../modelSelection";
import {
  isProviderInstancePickerReady,
  matchesLockedProvider,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerControl } from "./ComposerControl";
import { resolveModelPickerSelectedModel } from "./ModelPickerContent";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import {
  getDisplayModelName,
  getTriggerDisplayModelName,
  type ModelEsque,
} from "./providerIconUtils";

const DRAG_MODIFIERS = [restrictToHorizontalAxis, restrictToParentElement];
// Far more than fit; bounds the sortable nodes mounted for long favorite lists.
const MAX_CHIPS = 24;

// Chips that wrapped onto the clipped second line are invisible, so they are never drop targets.
const visibleRowCollision: CollisionDetection = (args) => {
  const rowTop = args.active.rect.current.initial?.top;
  return closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter((container) => {
      const rect = args.droppableRects.get(container.id);
      return rect !== undefined && rowTop !== undefined && Math.abs(rect.top - rowTop) < 1;
    }),
  });
};

function favoriteId(favorite: typeof ModelFavorite.Type): string {
  return JSON.stringify([favorite.provider, favorite.model]);
}

/** One-click switches between starred models this thread can use right now. */
export const ComposerFavoriteModels = memo(function ComposerFavoriteModels(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>;
  readonly selectedInstanceId: ProviderInstanceId;
  readonly selectedModel: string;
  readonly multipleModelsSelected: boolean;
  readonly lockedProvider: ProviderDriverKind | null;
  readonly lockedContinuationGroupKey: string | null | undefined;
  readonly getModelDisabledReason: (instanceId: ProviderInstanceId, model: string) => string | null;
  readonly onSelect: (instanceId: ProviderInstanceId, model: string) => void;
}) {
  const gt = useGT();
  const { favorites: savedFavorites } = useEnvironmentModelPreferences(props.environmentId);
  const saveModelPreferences = useUpdateEnvironmentModelPreferences(props.environmentId);
  // Shows a dropped order until the saved favorites change, so the chip does not snap back.
  const [pendingOrder, setPendingOrder] = useState<{
    readonly savedKey: string;
    readonly favorites: ReadonlyArray<typeof ModelFavorite.Type>;
  } | null>(null);
  const savedKey = savedFavorites.map(favoriteId).join("\n");
  if (pendingOrder !== null && pendingOrder.savedKey !== savedKey) setPendingOrder(null);
  const favorites = pendingOrder?.savedKey === savedKey ? pendingOrder.favorites : savedFavorites;
  // A drag ends with a click on the dragged chip; that click must not switch models.
  const suppressClickRef = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const chips = favorites
    .flatMap((favorite) => {
      const entry = props.instanceEntries.find(
        (candidate) => candidate.instanceId === favorite.provider,
      );
      if (
        !entry ||
        !isProviderInstancePickerReady(entry) ||
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
      return [{ id: favoriteId(favorite), entry, model, option }];
    })
    .slice(0, MAX_CHIPS);
  if (chips.length === 0) return null;

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setTimeout(() => {
      suppressClickRef.current = false;
    });
    if (!over || active.id === over.id) return;
    const fromIndex = favorites.findIndex((favorite) => favoriteId(favorite) === active.id);
    const toIndex = favorites.findIndex((favorite) => favoriteId(favorite) === over.id);
    if (fromIndex < 0 || toIndex < 0) return;
    const next = arrayMove([...favorites], fromIndex, toIndex);
    setPendingOrder({ savedKey, favorites: next });
    void saveModelPreferences({ favorites: next }).then((result) => {
      if (result && AsyncResult.isSuccess(result)) return;
      setPendingOrder((current) => (current?.favorites === next ? null : current));
    });
  };

  return (
    // Grows into whatever the footer controls leave at their natural width. Chips that do not
    // fit wrap to a clipped second line, so only whole chips show.
    <div
      role="group"
      aria-label={gt("Starred models")}
      className="me-2 flex h-7 min-w-0 flex-[1000_1_0%] flex-wrap items-center gap-x-0.5 gap-y-4 overflow-clip"
    >
      {/* Lets the first chip wrap away too; a flex line otherwise always keeps one item. */}
      <span aria-hidden className="-me-0.5 h-7 w-0" />
      <DndContext
        sensors={sensors}
        collisionDetection={visibleRowCollision}
        modifiers={DRAG_MODIFIERS}
        onDragStart={() => {
          suppressClickRef.current = true;
        }}
        onDragCancel={() => {
          suppressClickRef.current = false;
        }}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={chips.map((chip) => chip.id)}
          strategy={horizontalListSortingStrategy}
        >
          {chips.map(({ id, entry, model, option }) => (
            <FavoriteModelChip
              key={id}
              id={id}
              entry={entry}
              option={option}
              active={
                !props.multipleModelsSelected &&
                entry.instanceId === props.selectedInstanceId &&
                model === props.selectedModel
              }
              onSelect={() => {
                if (suppressClickRef.current) return;
                props.onSelect(entry.instanceId, model);
              }}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
});

function FavoriteModelChip(props: {
  readonly id: string;
  readonly entry: ProviderInstanceEntry;
  readonly option: ModelEsque;
  readonly active: boolean;
  readonly onSelect: () => void;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.id,
  });
  const { entry, option, active } = props;
  const fullName = `${entry.displayName} · ${getDisplayModelName(option)}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ComposerControl
            ref={setNodeRef}
            size="xs"
            aria-pressed={active}
            aria-label={fullName}
            style={{ transform: CSS.Translate.toString(transform), transition }}
            className={cn(isDragging && "z-10 cursor-grabbing")}
            {...listeners}
            onClick={() => {
              if (!active) props.onSelect();
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
}
