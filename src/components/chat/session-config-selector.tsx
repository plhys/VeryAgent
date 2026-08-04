"use client"

import { Fragment } from "react"
import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DropdownRadioItemContent } from "@/components/chat/dropdown-radio-item-content"
import { useScrollbarSafeDismiss } from "@/hooks/use-scrollbar-safe-dismiss"
import type { ModelOptionGroup } from "@/lib/model-config-groups"
import type { SessionConfigOptionInfo } from "@/lib/types"
import { useConfigOptionLocalizer } from "@/lib/config-option-labels"

interface SessionConfigSelectorProps {
  option: SessionConfigOptionInfo
  onSelect: (configId: string, valueId: string) => void
  /**
   * Frontend-derived grouping for the model picker (split on the `provider/`
   * prefix). When provided, it overrides the option's own (flat) value list;
   * a group with `name === null` renders its options with no header. `null`
   * means "no grouping" — fall back to server groups, else the flat list.
   */
  derivedGroups?: ModelOptionGroup[] | null
  /**
   * Trigger label style for the standardized selector row:
   *   - "name-value" (default): "Setting · Value" (e.g. 快速模式 · 关闭)
   *   - "name": the localized option name only — permissions & reasoning
   *     effort chips; the current value is visible inside the dropdown.
   *   - "value": the current value only — short model lists, so the chip
   *     reads as a bare model name instead of "模型 · gpt-4o".
   */
  variant?: "name-value" | "name" | "value"
}

export function InlineSessionConfigSelector({
  option,
  onSelect,
  derivedGroups,
  variant = "name-value",
}: SessionConfigSelectorProps) {
  const localizer = useConfigOptionLocalizer()
  const { contentRef, onPointerDownOutside, onFocusOutside } =
    useScrollbarSafeDismiss()
  if (option.kind.type !== "select") return null

  // Unified group list rendered in the dropdown body. Derived (model) groups
  // win; otherwise server-provided groups; otherwise `null` → flat options.
  // `name === null` is a headerless bucket (the leading prefix-less models).
  const renderGroups: ModelOptionGroup[] | null =
    derivedGroups && derivedGroups.length > 0
      ? derivedGroups
      : option.kind.groups.length > 0
        ? option.kind.groups.map((group) => ({
            key: group.group,
            name: group.name,
            options: group.options,
          }))
        : null

  // Resolve the trigger label against the *rendered* options so the selected
  // model shows its prefix-stripped name (its provider is already implied by
  // the group it sits in) rather than repeating `provider/`.
  const renderedOptions = renderGroups
    ? renderGroups.flatMap((group) => group.options)
    : option.kind.options
  const selected = renderedOptions.find(
    (item) => item.value === option.kind.current_value
  )
  const rawLabel = selected?.name ?? option.kind.current_value
  const currentLabel = localizer.localize(rawLabel)
  // Some agents ship the bare protocol id as the option name (e.g.
  // "effortLevel"); fall back to localizing the id when the name isn't mapped.
  const localizedName = localizer.localize(option.name)
  const optionName =
    localizedName !== option.name ? localizedName : localizer.localize(option.id)
  // Always show "Setting · Value" on the chip so a row of bare "Off/On"
  // values doesn't look like anonymous permission denies.
  const triggerLabel =
    variant === "name"
      ? optionName
      : variant === "value"
        ? currentLabel || optionName
        : currentLabel
          ? `${optionName} · ${currentLabel}`
          : optionName
  const optionDescription = option.description
    ? localizer.localize(option.description)
    : null
  const triggerTitle = optionDescription
    ? `${optionName}: ${optionDescription}`
    : triggerLabel

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          title={triggerTitle}
          aria-label={triggerLabel}
          className="min-w-0 gap-0.5 px-1.5 text-muted-foreground"
        >
          <span className="max-w-[9rem] truncate">{triggerLabel}</span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={contentRef}
        side="top"
        align="start"
        onPointerDownOutside={onPointerDownOutside}
        onFocusOutside={onFocusOutside}
        className="min-w-72 overflow-y-auto"
        style={{
          maxWidth: "min(20rem, calc(100vw - 1rem))",
          maxHeight:
            "min(60vh, var(--radix-dropdown-menu-content-available-height))",
        }}
      >
        {optionDescription ? (
          <div className="max-w-72 px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
            <div className="font-medium text-foreground">{optionName}</div>
            <p className="mt-0.5">{optionDescription}</p>
          </div>
        ) : (
          <DropdownMenuLabel>{optionName}</DropdownMenuLabel>
        )}
        <DropdownMenuRadioGroup
          value={option.kind.current_value}
          onValueChange={(value) => onSelect(option.id, value)}
        >
          {renderGroups
            ? renderGroups.map((group, index) => (
                <Fragment key={group.key}>
                  {index > 0 && <DropdownMenuSeparator />}
                  {group.name !== null && (
                    <DropdownMenuLabel>{group.name}</DropdownMenuLabel>
                  )}
                  {group.options.map((item) => (
                    <DropdownMenuRadioItem
                      key={`${group.key}-${item.value}`}
                      value={item.value}
                      title={localizer.localize(item.name)}
                    >
                      <DropdownRadioItemContent
                        label={localizer.localize(item.name)}
                        description={
                          item.description
                            ? localizer.localize(item.description)
                            : item.description
                        }
                      />
                    </DropdownMenuRadioItem>
                  ))}
                </Fragment>
              ))
            : option.kind.options.map((item) => (
                <DropdownMenuRadioItem
                  key={item.value}
                  value={item.value}
                  title={localizer.localize(item.name)}
                >
                  <DropdownRadioItemContent
                    label={localizer.localize(item.name)}
                    description={
                      item.description
                        ? localizer.localize(item.description)
                        : item.description
                    }
                  />
                </DropdownMenuRadioItem>
              ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
