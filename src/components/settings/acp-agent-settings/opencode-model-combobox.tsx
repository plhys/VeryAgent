import { useCallback, useRef } from "react"
import { Badge } from "@/components/ui/badge"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from "@/components/ui/combobox"
import {
  formatContextWindow,
  type OpenCodeModelOptionGroup,
} from "@/lib/opencode-connect"
import { acpText } from "./shared"

export function OpenCodeModelCombobox({
  value,
  onValueChange,
  groups,
  placeholder,
}: {
  value: string
  onValueChange: (value: string) => void
  groups: OpenCodeModelOptionGroup[]
  placeholder: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSelect = useCallback(
    (next: string | null) => {
      if (typeof next === "string" && next !== value) {
        onValueChange(next)
      }
    },
    [onValueChange, value]
  )

  const handleBlur = useCallback(() => {
    const trimmed = (inputRef.current?.value ?? "").trim()
    if (trimmed !== value) {
      onValueChange(trimmed)
    }
  }, [onValueChange, value])

  return (
    <Combobox key={value} value={value} onValueChange={handleSelect}>
      <ComboboxInput
        ref={inputRef}
        placeholder={placeholder}
        onBlur={handleBlur}
        showClear={false}
      />
      <ComboboxContent>
        <ComboboxList>
          {groups.map((group) => (
            <ComboboxGroup key={group.providerId}>
              <ComboboxLabel>{group.label}</ComboboxLabel>
              {group.models.map((model) => {
                const contextLabel =
                  typeof model.context === "number"
                    ? formatContextWindow(model.context)
                    : ""
                return (
                  <ComboboxItem key={model.value} value={model.value}>
                    <span className="truncate">{model.value}</span>
                    {(model.reasoning || contextLabel) && (
                      <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
                        {model.reasoning && (
                          <Badge
                            variant="outline"
                            className="px-1 text-[9px] font-normal"
                          >
                            {acpText("openCode.reasoningBadge", "reasoning")}
                          </Badge>
                        )}
                        {contextLabel && (
                          <span
                            className="text-[10px] text-muted-foreground"
                            title={acpText(
                              "openCode.contextWindow",
                              "Context window"
                            )}
                          >
                            {contextLabel}
                          </span>
                        )}
                      </span>
                    )}
                  </ComboboxItem>
                )
              })}
            </ComboboxGroup>
          ))}
          <ComboboxEmpty>
            {acpText("openCode.noMatchingModels", "No matching models")}
          </ComboboxEmpty>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
