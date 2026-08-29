'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import * as React from 'react';
import type { WorkflowNodeDefinition } from './workflow-node-registry';

export function WorkflowInsertDialog({
  open,
  items,
  returnFocusRef,
  onOpenChange,
  onInsert,
}: {
  open: boolean;
  items: WorkflowNodeDefinition[];
  returnFocusRef: React.RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  onInsert: (type: WorkflowNodeDefinition['type']) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-black/75" />
        <Dialog.Content
          aria-modal="true"
          onCloseAutoFocus={(event) => {
            if (!returnFocusRef.current) return;
            event.preventDefault();
            returnFocusRef.current.focus();
          }}
          className="fixed left-1/2 top-1/2 z-30 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 border border-white/20 bg-[#080808] text-white outline-none"
        >
          <div className="flex h-11 items-center border-b border-white/12 px-3 text-xs font-semibold">
            <Dialog.Title>Insert step</Dialog.Title>
            <Dialog.Description className="sr-only">
              Choose a compatible step to place on this route.
            </Dialog.Description>
            <Dialog.Close
              aria-label="Close insert step dialog"
              className="ml-auto text-zinc-600 hover:text-white"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="grid max-h-80 grid-cols-2 overflow-y-auto">
            {items.map((item) => (
              <button
                key={item.type}
                type="button"
                onClick={() => onInsert(item.type)}
                className="border-b border-r border-white/10 p-3 text-left hover:bg-white/[0.04]"
              >
                <span className="block text-xs font-medium">{item.label}</span>
                <span className="mt-1 block text-[10px] leading-4 text-zinc-600">
                  {item.description}
                </span>
              </button>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
