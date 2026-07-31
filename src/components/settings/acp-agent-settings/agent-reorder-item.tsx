import { useCallback, type PointerEvent } from "react"
import { Reorder, useDragControls } from "motion/react"
import { cn } from "@/lib/utils"
import type { AgentReorderItemProps } from "./types"

export function AgentReorderItem({
  agent,
  selected,
  reordering,
  dragging,
  inactive = false,
  onDragStart,
  onDragEnd,
  onSelect,
  children,
}: AgentReorderItemProps) {
  const dragControls = useDragControls()

  const startDrag = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      dragControls.start(event)
    },
    [dragControls]
  )

  return (
    <Reorder.Item
      as="section"
      value={agent}
      data-agent-type={agent.agent_type}
      drag={reordering ? false : "y"}
      dragListener={false}
      dragControls={dragControls}
      dragMomentum={false}
      layout="position"
      className={cn(
        "rounded-lg border bg-card p-3 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        selected && "border-primary/60 bg-primary/5",
        dragging === agent.agent_type && "border-primary/60 bg-primary/5",
        inactive && "opacity-60 text-muted-foreground"
      )}
      tabIndex={0}
      onDragStart={() => {
        onDragStart(agent.agent_type)
      }}
      onDragEnd={onDragEnd}
      onClick={() => {
        onSelect(agent.agent_type)
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        onSelect(agent.agent_type)
      }}
    >
      {children(startDrag)}
    </Reorder.Item>
  )
}
