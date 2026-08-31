'use client';

import { ChevronDown, ChevronRight, StickyNote } from 'lucide-react';
import { useState } from 'react';
import type { WorkflowDomain, WorkflowNodePosition, WorkflowNodeType } from '@betterspend/shared';
import { availableNodeDefinitions } from './workflow-node-registry';

export const WORKFLOW_NODE_DRAG_TYPE = 'application/betterspend-workflow-node';

export function WorkflowPalette({
  domain,
  collapsed,
  disabled,
  onToggle,
  onAdd,
  onAddNote,
}: {
  domain: WorkflowDomain;
  collapsed: boolean;
  disabled: boolean;
  onToggle: () => void;
  onAdd: (type: WorkflowNodeType, position: WorkflowNodePosition) => void;
  onAddNote: () => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const definitions = availableNodeDefinitions(domain);
  const common = definitions.filter((definition) => definition.category === 'common');
  const advanced = definitions.filter((definition) => definition.category === 'advanced');

  if (collapsed) {
    return (
      <aside className="flex w-11 shrink-0 flex-col items-center border-r border-border/70 bg-muted/30 py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-label="Open step palette"
          className="grid size-7 place-items-center text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className="size-4" />
        </button>
      </aside>
    );
  }

  const renderDefinition = (type: WorkflowNodeType) => {
    const definition = definitions.find((candidate) => candidate.type === type);
    if (!definition) return null;
    const Icon = definition.icon;
    return (
      <button
        key={definition.type}
        type="button"
        draggable={!disabled}
        disabled={disabled}
        onDragStart={(event) => {
          event.dataTransfer.setData(WORKFLOW_NODE_DRAG_TYPE, definition.type);
          event.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={() => onAdd(definition.type, { x: 180, y: 120 })}
        className="group flex w-full items-start gap-2.5 border-t border-border/60 px-3 py-2.5 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Icon className="mt-0.5 size-3.5 shrink-0 text-primary" />
        <span className="min-w-0">
          <span className="block text-xs font-medium text-foreground">{definition.label}</span>
          <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
            {definition.description}
          </span>
        </span>
      </button>
    );
  };

  return (
    <aside className="w-56 shrink-0 overflow-y-auto border-r border-border/70 bg-muted/30 text-foreground">
      <div className="flex h-12 items-center border-b border-border/70 px-3">
        <span className="text-xs font-semibold text-foreground">Add step</span>
        <button
          type="button"
          onClick={onToggle}
          aria-label="Collapse step palette"
          className="ml-auto text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className="size-4 rotate-90" />
        </button>
      </div>
      <div className="px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
        Common
      </div>
      {common.map((definition) => renderDefinition(definition.type))}
      <button
        type="button"
        onClick={() => setAdvancedOpen((open) => !open)}
        aria-expanded={advancedOpen}
        className="flex w-full items-center border-y border-border/60 px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
      >
        Advanced
        {advancedOpen ? (
          <ChevronDown className="ml-auto size-3.5" />
        ) : (
          <ChevronRight className="ml-auto size-3.5" />
        )}
      </button>
      {advancedOpen ? advanced.map((definition) => renderDefinition(definition.type)) : null}
      <button
        type="button"
        onClick={onAddNote}
        disabled={disabled}
        className="flex w-full items-center gap-2.5 border-b border-border/60 px-3 py-3 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        <StickyNote className="size-3.5 text-amber-500" /> Sticky note
      </button>
    </aside>
  );
}
