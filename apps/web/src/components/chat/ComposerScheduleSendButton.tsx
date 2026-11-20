import { useAtomValue } from "@effect/atom-react";
import { msg, T, useGT } from "gt-react";
import { CalendarClockIcon } from "lucide-react";
import { useState } from "react";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ScheduledTaskUpsertInput,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { useClientSettings } from "../../hooks/useSettings";
import { useEnvironment } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import type { Thread } from "../../types";
import { requestCustomSnooze } from "../CustomSnoozeDialog";
import { resolveSnoozePresets } from "../Sidebar.snooze";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuItemDetail, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const SCHEDULE_TITLE_MAX = 60;
const RUN_AT_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function hasPassed(iso: string): boolean {
  return Date.parse(iso) <= Date.now();
}

function scheduledPromptTitle(prompt: string): string {
  const firstLine = prompt.trim().split("\n", 1)[0]!.trim();
  return firstLine.length > SCHEDULE_TITLE_MAX
    ? `${firstLine.slice(0, SCHEDULE_TITLE_MAX - 1).trimEnd()}…`
    : firstLine;
}

/** Sends the composer's text to this thread later, as a one-time scheduled task bound to it. */
export function ComposerScheduleSendButton(props: {
  readonly environmentId: EnvironmentId;
  readonly thread: Thread;
  /** Read when a time is picked, since the custom dialog stays open while the draft can change. */
  readonly readPrompt: () => string;
  readonly onScheduled: () => void;
}) {
  const { environmentId, thread } = props;
  const environment = useEnvironment(environmentId);
  const canSchedule = useAtomValue(
    serverEnvironment.upsertScheduledTask.permissionAtom(environmentId),
  );
  const upsertTask = useAtomCommand(serverEnvironment.upsertScheduledTask, {
    label: "composer schedule send",
  });
  const timestampFormat = useClientSettings((s) => s.timestampFormat);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const gt = useGT();

  // Older servers reject one-time schedules.
  if (environment?.serverConfig?.environment.capabilities.oneTimeSchedules !== true) return null;
  if (!canSchedule) return null;

  const presets = open
    ? // oxlint-disable-next-line react/purity -- Presets are resolved only while the menu is open, so each opening reads a fresh time.
      resolveSnoozePresets(new Date(), timestampFormat, environmentId)
    : [];

  const schedule = async (runAt: string) => {
    const text = props.readPrompt().trim();
    if (saving || !text || !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope))
      return;
    if (hasPassed(runAt)) {
      toastManager.add({
        type: "warning",
        title: gt("Could not schedule message"),
        description: gt("That time has passed. Choose another time."),
      });
      return;
    }
    const input: ScheduledTaskUpsertInput = {
      title: scheduledPromptTitle(text),
      prompt: text,
      enabled: true,
      schedule: { type: "once", runAt },
      projectId: thread.projectId,
      threadId: thread.id,
      threadMode: "continue",
      workspaceStrategy: { type: "root" },
      modelSelection: thread.modelSelection,
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      creationSource: "web",
    };
    setSaving(true);
    const result = await upsertTask({ environmentId, input });
    setSaving(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: gt("Could not schedule message"),
          description: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    props.onScheduled();
    toastManager.add({
      type: "success",
      title: gt("Message scheduled"),
      description: gt("Sends {time}. Manage it in Automations.", {
        time: RUN_AT_FORMATTER.format(new Date(runAt)),
      }),
    });
  };

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost-muted"
                  aria-label={gt("Schedule message")}
                  disabled={saving}
                />
              }
            />
          }
        >
          <CalendarClockIcon aria-hidden="true" />
        </TooltipTrigger>
        <TooltipPopup>
          <T>Send later</T>
        </TooltipPopup>
      </Tooltip>
      <MenuPopup side="top" align="end">
        {presets.map((preset) => (
          <MenuItem key={preset.id} onClick={() => void schedule(preset.snoozedUntil)}>
            {preset.label}
            <MenuItemDetail>{preset.whenLabel}</MenuItemDetail>
          </MenuItem>
        ))}
        {presets.length > 0 ? <MenuSeparator /> : null}
        <MenuItem
          onClick={async () => {
            const choice = await requestCustomSnooze({
              title: msg("Send later"),
              description: msg("Choose when this message is sent to the thread."),
              durationLabel: msg("Send in"),
              submitLabel: msg("Schedule", { $context: "verb" }),
            });
            if (choice) void schedule(choice.snoozedUntil);
          }}
        >
          <T>Custom…</T>
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
