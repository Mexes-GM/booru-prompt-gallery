"use client"

/**
 * Read-only drawing of a ComfyUI workflow where the user checks and changes
 * which inputs the site writes (prompt, seed, size) and which node's image it
 * shows (output). Loaded on demand by the ComfyUI panel: @xyflow/react stays
 * out of the main bundle.
 *
 * Two ways to assign a role, with the same result:
 * - click a value in the graph and pick a role from its menu (pointer);
 * - the role list beside the graph (keyboard and screen readers).
 */
import "@xyflow/react/dist/style.css"
import { createContext, memo, useCallback, useContext, useEffect, useId, useMemo, useRef, type CSSProperties } from "react"
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react"
import { Check } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useLowMotion } from "@/hooks/use-low-motion"
import { buildWorkflowGraph, NODE_HEADER, NODE_ROW, type GraphInput, type GraphNode } from "@/lib/comfyui/graph-layout"
import { detectRoles } from "@/lib/comfyui/roles"
import {
  nodeTitle,
  outputChoices,
  previewValue,
  promptChoices,
  refKey,
  sameRef,
  seedChoices,
  sizeChoices,
  type RoleKey,
} from "@/lib/comfyui/role-choices"
import type { ApiWorkflow, InputRef, ObjectInfo, Roles, SavedComfyWorkflow } from "@/lib/comfyui/types"
import { cn } from "@/lib/utils"
import { ROLE_STYLE } from "./comfyui-role-style"

interface ViewerContextValue {
  api: ApiWorkflow
  roles: Roles
  /** Inputs the detection suggests, by refKey, with their role. */
  suggested: Map<string, RoleKey>
  suggestedOutputs: Set<string>
  outputNodes: Set<string>
  /** Nodes with typed width and height. */
  sizeNodes: Set<string>
  assign: (role: RoleKey, target: InputRef | string | null) => void
}

const ViewerContext = createContext<ViewerContextValue | null>(null)

function useViewer(): ViewerContextValue {
  const value = useContext(ViewerContext)
  if (!value) throw new Error("useViewer outside the viewer")
  return value
}

function roleOfInput(roles: Roles, ref: InputRef): RoleKey | null {
  if (sameRef(roles.prompt, ref)) return "prompt"
  if (sameRef(roles.seed, ref)) return "seed"
  if (sameRef(roles.width, ref) || sameRef(roles.height, ref)) return "size"
  return null
}

type WorkflowFlowNode = Node<{ node: GraphNode }, "workflow">
type GroupFlowNode = Node<{ node: GraphNode }, "subgraph">

// --- Graph nodes ------------------------------------------------------------

function RoleChip({ role, className }: { role: RoleKey; className?: string }) {
  return (
    <span className={cn("shrink-0 rounded-[4px] px-1.5 py-px text-[10px] font-semibold leading-4", ROLE_STYLE[role].chip, className)}>
      {ROLE_STYLE[role].label}
    </span>
  )
}

function InputRow({ nodeId, input }: { nodeId: string; input: GraphInput }) {
  const { api, roles, suggested, sizeNodes, assign } = useViewer()
  if (input.kind === "link") {
    return (
      <div className="flex h-[26px] items-center px-3 text-[11px] text-muted-foreground">
        <span className="truncate">{input.name}</span>
      </div>
    )
  }
  const ref = { nodeId, input: input.name }
  const role = roleOfInput(roles, ref)
  const hint = role ? null : suggested.get(refKey(ref)) ?? null
  const canPrompt = typeof input.value === "string"
  const canSeed = typeof input.value === "number" && /seed/i.test(input.name)
  const canSize = typeof input.value === "number" && (input.name === "width" || input.name === "height") && sizeNodes.has(nodeId)
  const value = previewValue(input.value, 28)
  const content = (
    <>
      <span className="shrink-0 text-muted-foreground">{input.name}</span>
      <span className="min-w-0 flex-1 truncate text-right tabular-nums">{value}</span>
      {role && <RoleChip role={role} />}
    </>
  )
  const rowClass = cn(
    "mx-1.5 flex h-[22px] w-[calc(100%-0.75rem)] items-center gap-2 rounded-[5px] border border-transparent px-1.5 text-[11px] text-foreground",
    role && ROLE_STYLE[role].row,
    hint && ROLE_STYLE[hint].hint,
  )
  if (!canPrompt && !canSeed && !canSize) {
    return (
      <div className="flex h-[26px] items-center">
        <div className={rowClass}>{content}</div>
      </div>
    )
  }
  return (
    <div className="flex h-[26px] items-center">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          // The role list beside the graph is the keyboard path; these stay out of the tab order.
          tabIndex={-1}
          title={hint ? `Suggested ${ROLE_STYLE[hint].label.toLowerCase()}` : undefined}
          className={cn(rowClass, "nodrag nopan cursor-pointer text-left hover:border-border hover:bg-muted/60 data-[state=open]:border-ring")}
        >
          {content}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
            {nodeTitle(api, nodeId)} · {input.name}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {canPrompt && (
            <DropdownMenuItem onSelect={() => assign("prompt", ref)} disabled={role === "prompt"}>
              {role === "prompt" ? <Check className="mr-2 h-3.5 w-3.5" /> : <span className="mr-2 w-3.5" />}
              Write the prompt here
            </DropdownMenuItem>
          )}
          {canSeed && (
            role === "seed" ? (
              <DropdownMenuItem onSelect={() => assign("seed", null)}>
                <span className="mr-2 w-3.5" />
                Keep the workflow&apos;s seed
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => assign("seed", ref)}>
                <span className="mr-2 w-3.5" />
                Write the seed here
              </DropdownMenuItem>
            )
          )}
          {canSize && (
            role === "size" ? (
              <DropdownMenuItem onSelect={() => assign("size", null)}>
                <span className="mr-2 w-3.5" />
                Let the workflow set the size
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => assign("size", nodeId)}>
                <span className="mr-2 w-3.5" />
                Write the width and height here
              </DropdownMenuItem>
            )
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

const handleClass = "!h-2 !w-2 !min-w-0 !min-h-0 !border !border-background !bg-muted-foreground"

const WorkflowNodeView = memo(function WorkflowNodeView({ data }: NodeProps<WorkflowFlowNode>) {
  const { roles, suggestedOutputs, outputNodes, assign } = useViewer()
  const node = data.node
  const isOutput = roles.output === node.id
  const canOutput = outputNodes.has(node.id)
  const outputHint = !isOutput && suggestedOutputs.has(node.id)
  const title = (
    <>
      <span className="min-w-0 flex-1 truncate text-left text-xs font-medium">{node.title}</span>
      {isOutput && <RoleChip role="output" />}
    </>
  )
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm",
        isOutput ? "border-tag-copyright ring-1 ring-tag-copyright" : outputHint ? ROLE_STYLE.output.hint : "border-border",
      )}
      style={{ width: node.width, height: node.height }}
    >
      {canOutput ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            tabIndex={-1}
            className="nodrag nopan flex w-full items-center gap-2 border-b border-border/60 bg-muted/50 px-3 hover:bg-muted"
            style={{ height: NODE_HEADER }}
          >
            {title}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{node.title}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => assign("output", node.id)} disabled={isOutput}>
              {isOutput ? <Check className="mr-2 h-3.5 w-3.5" /> : <span className="mr-2 w-3.5" />}
              Show this node&apos;s image
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div className="flex items-center gap-2 border-b border-border/60 bg-muted/50 px-3" style={{ height: NODE_HEADER }}>
          {title}
        </div>
      )}
      {node.inputs.map((input) => (
        <InputRow key={input.name} nodeId={node.id} input={input} />
      ))}
      {node.inputs.map((input, i) =>
        input.kind === "link" ? (
          <Handle
            key={`in-${input.name}`}
            id={`in-${input.name}`}
            type="target"
            position={Position.Left}
            isConnectable={false}
            className={handleClass}
            style={{ top: NODE_HEADER + i * NODE_ROW + NODE_ROW / 2 }}
          />
        ) : null,
      )}
      {node.outputs.map((output, i) => (
        <Handle
          key={`out-${output}`}
          id={`out-${output}`}
          type="source"
          position={Position.Right}
          isConnectable={false}
          className={handleClass}
          style={{ top: Math.min(NODE_HEADER / 2 + i * 12, node.height - 8) }}
        />
      ))}
    </div>
  )
})

const GroupNodeView = memo(function GroupNodeView({ data }: NodeProps<GroupFlowNode>) {
  return (
    <div
      className="rounded-xl border border-dashed border-border bg-muted/25"
      style={{ width: data.node.width, height: data.node.height }}
    >
      <div className="truncate px-4 pt-2.5 text-xs font-medium text-muted-foreground">{data.node.title}</div>
    </div>
  )
})

// Not "group": xyflow styles its built-in group type with a filled box.
const NODE_TYPES = { workflow: WorkflowNodeView, subgraph: GroupNodeView }

// --- Role list ---------------------------------------------------------------

const NONE = "__none__"

function choiceLabel(api: ApiWorkflow, ref: InputRef): string {
  return `${nodeTitle(api, ref.nodeId)} · ${ref.input}`
}

/**
 * Scrolls the nearest scrolling ancestor so `el` sits at its top. Not
 * scrollIntoView: that also scrolls the dialog's overflow-hidden frame,
 * which leaves an empty band the user can't scroll back.
 */
function scrollToTop(el: HTMLElement) {
  let scroller = el.parentElement
  while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
  if (!scroller) return
  const offset = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top
  scroller.scrollTop += offset
}

function RoleSelect({
  role,
  value,
  onChange,
  options,
  noneLabel,
  description,
  focusRequest,
}: {
  role: RoleKey
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string; detail?: string; suggested: boolean }[]
  noneLabel?: string
  description?: string
  /** Each new value scrolls the roles into view and focuses this control. */
  focusRequest?: number
}) {
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (focusRequest === undefined) return
    // After the dialog's own open focus has run.
    const frame = requestAnimationFrame(() => {
      const trigger = triggerRef.current
      if (!trigger) return
      const section = trigger.closest("section")
      if (section) scrollToTop(section)
      trigger.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [focusRequest])
  const style = ROLE_STYLE[role]
  const empty = options.length === 0 && !noneLabel
  const selectedLabel = value === NONE ? noneLabel : options.find((o) => o.value === value)?.label
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex items-center gap-2 text-xs font-medium text-foreground">
        <span aria-hidden className={cn("h-2.5 w-2.5 rounded-[3px]", style.swatch)} />
        {style.label}
      </label>
      <Select value={value} onValueChange={onChange} disabled={empty}>
        <SelectTrigger ref={triggerRef} id={id} aria-describedby={description ? `${id}-desc` : undefined} className="h-9 bg-background text-xs">
          {/* Only the name in the trigger; the options also show a preview of the value. */}
          <SelectValue placeholder={empty ? "Nothing to pick" : "Choose"}>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent className="max-w-[min(22rem,calc(100vw-2rem))]">
          {noneLabel && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} textValue={o.label}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">
                  {o.label}
                  {o.suggested && <span className="text-muted-foreground"> · suggested</span>}
                </span>
                {o.detail && <span className="truncate text-[11px] text-muted-foreground">{o.detail}</span>}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {description && (
        <p id={`${id}-desc`} className="text-[11px] leading-snug text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  )
}

function RoleList({ onFocusNode, focusPromptRequest }: { onFocusNode: (nodeId: string) => void; focusPromptRequest?: number }) {
  const { api, roles, assign } = useViewer()
  const detection = useRoleDetection()
  const prompts = promptChoices(api, detection.candidates)
  const seeds = seedChoices(api, detection.candidates)
  const sizes = sizeChoices(api, detection.candidates, detection.roles)
  const outputs = outputChoices(detection.candidates, detection.roles)

  const sizeKey = (width: InputRef) => width.nodeId
  return (
    <div className="flex flex-col gap-4" role="group" aria-label="Roles">
      <RoleSelect
        role="prompt"
        value={roles.prompt ? refKey(roles.prompt) : NONE}
        noneLabel={roles.prompt ? undefined : "No prompt input"}
        focusRequest={focusPromptRequest}
        onChange={(v) => {
          const choice = prompts.find((c) => refKey(c.ref) === v)
          if (!choice) return
          assign("prompt", choice.ref)
          onFocusNode(choice.ref.nodeId)
        }}
        options={prompts.map((c) => ({
          value: refKey(c.ref),
          label: choiceLabel(api, c.ref),
          detail: previewValue(api[c.ref.nodeId].inputs[c.ref.input], 60),
          suggested: c.suggested,
        }))}
        description={
          prompts.length === 0
            ? "This workflow has no text input, so it runs without the card's prompt."
            : focusPromptRequest !== undefined
              ? "Choose where Send writes the card's prompt."
              : undefined
        }
      />
      <RoleSelect
        role="seed"
        value={roles.seed ? refKey(roles.seed) : NONE}
        noneLabel="Keep the workflow's seed"
        onChange={(v) => {
          const choice = seeds.find((c) => refKey(c.ref) === v)
          assign("seed", choice ? choice.ref : null)
          if (choice) onFocusNode(choice.ref.nodeId)
        }}
        options={seeds.map((c) => ({
          value: refKey(c.ref),
          label: choiceLabel(api, c.ref),
          suggested: c.suggested,
        }))}
      />
      <RoleSelect
        role="size"
        value={roles.width ? sizeKey(roles.width) : NONE}
        noneLabel="Set by the workflow"
        onChange={(v) => {
          const choice = sizes.find((c) => sizeKey(c.width) === v)
          assign("size", choice ? choice.width.nodeId : null)
          if (choice) onFocusNode(choice.width.nodeId)
        }}
        options={sizes.map((c) => ({
          value: sizeKey(c.width),
          label: nodeTitle(api, c.width.nodeId),
          detail: `${api[c.width.nodeId].inputs.width} × ${api[c.height.nodeId].inputs.height}`,
          suggested: c.suggested,
        }))}
        description={sizes.length === 0 ? "No node here takes a typed width and height, so the workflow keeps its own size." : undefined}
      />
      <RoleSelect
        role="output"
        value={roles.output ?? NONE}
        noneLabel={roles.output ? undefined : "No image output"}
        onChange={(v) => {
          if (v === NONE) return
          assign("output", v)
          onFocusNode(v)
        }}
        options={outputs.map((c) => ({ value: c.nodeId, label: nodeTitle(api, c.nodeId), suggested: c.suggested }))}
      />
    </div>
  )
}

// --- Viewer -------------------------------------------------------------------

const DetectionContext = createContext<ReturnType<typeof detectRoles> | null>(null)
function useRoleDetection() {
  const value = useContext(DetectionContext)
  if (!value) throw new Error("useRoleDetection outside the viewer")
  return value
}

/** Keeps xyflow's own colors on the site's theme tokens. */
const FLOW_STYLE = {
  "--xy-background-color": "transparent",
  "--xy-edge-stroke": "var(--color-faint-foreground)",
  "--xy-edge-stroke-width": "1.25",
  "--xy-controls-button-background-color": "var(--color-card)",
  "--xy-controls-button-background-color-hover": "var(--color-muted)",
  "--xy-controls-button-color": "var(--color-foreground)",
  "--xy-controls-button-color-hover": "var(--color-foreground)",
  "--xy-controls-button-border-color": "var(--color-border)",
  "--xy-controls-box-shadow": "none",
  "--xy-attribution-background-color": "transparent",
  "--xy-background-pattern-dots-color": "var(--color-border)",
} as CSSProperties

const ARIA_LABELS = {
  "node.a11yDescription.default": "",
  "node.a11yDescription.keyboardDisabled": "",
  "edge.a11yDescription.default": "",
}

interface ViewerProps {
  workflow: SavedComfyWorkflow
  objectInfo: ObjectInfo | null
  onRolesChange: (roles: Roles) => void
  /** Each new value focuses the Prompt role control (Send found no prompt input). */
  focusPromptRequest?: number
}

function ViewerInner({ workflow, objectInfo, onRolesChange, focusPromptRequest }: ViewerProps) {
  const lowMotion = useLowMotion()
  const flow = useReactFlow()
  const { api, ui, roles } = workflow
  const detection = useMemo(() => detectRoles(api, objectInfo ?? undefined), [api, objectInfo])
  const graph = useMemo(() => buildWorkflowGraph(api, ui), [api, ui])

  const nodes = useMemo<(WorkflowFlowNode | GroupFlowNode)[]>(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: n.group ? ("subgraph" as const) : ("workflow" as const),
        position: { x: n.x, y: n.y },
        data: { node: n },
        width: n.width,
        height: n.height,
        ...(n.parent ? { parentId: n.parent, extent: "parent" as const } : {}),
        // xyflow turns pointer events off on nodes that can't be dragged or
        // selected; the role menus inside need them.
        // Boxes stay under the links, nodes above them.
        ...(n.group ? { zIndex: -1 } : { zIndex: 1, style: { pointerEvents: "all" as const } }),
      })),
    [graph],
  )
  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        sourceHandle: `out-${e.sourceOutput}`,
        target: e.target,
        targetHandle: `in-${e.targetInput}`,
        focusable: false,
        selectable: false,
      })),
    [graph],
  )

  const assign = useCallback(
    (role: RoleKey, target: InputRef | string | null) => {
      const next: Roles = { ...roles }
      if (role === "prompt") next.prompt = (target as InputRef | null) ?? roles.prompt
      else if (role === "seed") next.seed = target as InputRef | null
      else if (role === "output") next.output = (target as string | null) ?? roles.output
      else if (target === null) {
        next.width = null
        next.height = null
      } else {
        next.width = { nodeId: target as string, input: "width" }
        next.height = { nodeId: target as string, input: "height" }
      }
      onRolesChange(next)
    },
    [roles, onRolesChange],
  )

  const context = useMemo<ViewerContextValue>(() => {
    const suggested = new Map<string, RoleKey>()
    for (const ref of detection.candidates.prompt) suggested.set(refKey(ref), "prompt")
    for (const ref of detection.candidates.seed) if (!suggested.has(refKey(ref))) suggested.set(refKey(ref), "seed")
    if (detection.roles.width) suggested.set(refKey(detection.roles.width), "size")
    if (detection.roles.height) suggested.set(refKey(detection.roles.height), "size")
    return {
      api,
      roles,
      suggested,
      suggestedOutputs: new Set(detection.roles.output ? [detection.roles.output] : []),
      outputNodes: new Set(detection.candidates.output),
      sizeNodes: new Set(detection.candidates.size.map((s) => s.width.nodeId)),
      assign,
    }
  }, [api, roles, detection, assign])

  // Keep the whole graph in view while the box changes size (the dialog widens
  // when the graph opens), until the user pans or zooms.
  const boxRef = useRef<HTMLDivElement>(null)
  const userMoved = useRef(false)
  useEffect(() => {
    const box = boxRef.current
    if (!box || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => {
      if (!userMoved.current) void flow.fitView({ padding: 0.12 })
    })
    observer.observe(box)
    return () => observer.disconnect()
  }, [flow])

  const focusNode = useCallback(
    (nodeId: string) => {
      void flow.fitView({ nodes: [{ id: nodeId }], duration: lowMotion ? 0 : 250, maxZoom: 1.1, padding: 0.4 })
    },
    [flow, lowMotion],
  )

  return (
    <DetectionContext.Provider value={detection}>
      <ViewerContext.Provider value={context}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <div
            ref={boxRef}
            className="relative h-72 overflow-hidden rounded-xl sm:h-[min(28rem,60dvh)] border border-border bg-muted/20"
            role="img"
            aria-label={`Graph of ${workflow.name}. Use the role list to change roles with the keyboard.`}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              nodesDraggable={false}
              nodesConnectable={false}
              nodesFocusable={false}
              edgesFocusable={false}
              elementsSelectable={false}
              zoomOnDoubleClick={false}
              // Read-only: no node or edge keyboard handling, and no hints about moving or deleting them.
              disableKeyboardA11y
              ariaLabelConfig={ARIA_LABELS}
              onMoveStart={(event) => {
                // Programmatic moves (fitView) come without an event.
                if (event) userMoved.current = true
              }}
              fitView
              fitViewOptions={{ padding: 0.12 }}
              minZoom={0.08}
              maxZoom={1.75}
              style={FLOW_STYLE}
            >
              <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
              <Controls showInteractive={false} position="bottom-right" />
            </ReactFlow>
          </div>
          <RoleList onFocusNode={focusNode} focusPromptRequest={focusPromptRequest} />
        </div>
      </ViewerContext.Provider>
    </DetectionContext.Provider>
  )
}

export default function ComfyUIWorkflowViewer(props: ViewerProps) {
  return (
    <ReactFlowProvider>
      <ViewerInner {...props} />
    </ReactFlowProvider>
  )
}
