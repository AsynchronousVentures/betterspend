'use client';

import { Bot, Check, RefreshCw, Send, X } from 'lucide-react';
import { useState } from 'react';
import type { PendingAssistantProposal } from './workflow-store';

export function WorkflowAssistant({
  available,
  open,
  busy,
  proposal,
  currentRevision,
  error,
  onOpenChange,
  onSubmit,
  onApply,
  onReject,
}: {
  available: boolean;
  open: boolean;
  busy: boolean;
  proposal: PendingAssistantProposal | null;
  currentRevision: number;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (prompt: string) => void;
  onApply: () => void;
  onReject: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  if (!available) return null;

  const stale = proposal !== null && proposal.draftRevision !== currentRevision;
  const counts = proposal?.response.operations.reduce<Record<string, number>>(
    (result, operation) => {
      result[operation.type] = (result[operation.type] ?? 0) + 1;
      return result;
    },
    {},
  );

  return (
    <>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        className="absolute right-3 top-3 z-10 flex h-8 items-center gap-2 border border-white/20 bg-black px-3 text-[10px] font-semibold text-zinc-300 hover:border-orange-300 hover:text-white"
      >
        <Bot className="size-3.5 text-orange-300" /> Ask assistant
      </button>
      {open ? (
        <aside className="absolute bottom-3 right-3 top-14 z-20 flex w-[340px] flex-col border border-white/18 bg-[#070707] shadow-[-16px_0_42px_rgba(0,0,0,0.55)]">
          <div className="flex h-11 shrink-0 items-center border-b border-white/12 px-3">
            <Bot className="mr-2 size-3.5 text-orange-300" />
            <span className="text-xs font-semibold text-white">Workflow assistant</span>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close assistant"
              className="ml-auto text-zinc-600 hover:text-white"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {proposal ? (
              <div className="space-y-3">
                <p className="text-xs leading-5 text-zinc-200">{proposal.response.summary}</p>
                <div className="border-y border-white/10 py-2 font-mono text-[9px] uppercase tracking-[0.1em] text-zinc-500">
                  {Object.entries(counts ?? {}).map(([operation, count]) => (
                    <div key={operation} className="flex justify-between py-1">
                      <span>{operation.replaceAll('_', ' ')}</span>
                      <span>{count}</span>
                    </div>
                  ))}
                </div>
                <div
                  className={`text-[10px] leading-4 ${proposal.response.validation.valid ? 'text-emerald-300' : 'text-amber-200'}`}
                >
                  {proposal.response.validation.valid
                    ? 'Patch passes graph validation.'
                    : `${proposal.response.validation.issues.length} validation issue${proposal.response.validation.issues.length === 1 ? '' : 's'} remain.`}
                </div>
                {stale ? (
                  <div className="border border-amber-300/25 bg-amber-300/5 p-2 text-[10px] leading-4 text-amber-100">
                    The canvas changed after this proposal. Regenerate before applying.
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onReject}
                    className="flex h-8 flex-1 items-center justify-center gap-1.5 border border-white/15 text-[10px] font-semibold text-zinc-400 hover:text-white"
                  >
                    <X className="size-3" /> Reject
                  </button>
                  {stale ? (
                    <button
                      type="button"
                      onClick={() => onSubmit(prompt)}
                      disabled={!prompt.trim() || busy}
                      className="flex h-8 flex-1 items-center justify-center gap-1.5 bg-white text-[10px] font-semibold text-black disabled:opacity-40"
                    >
                      <RefreshCw className="size-3" /> Regenerate
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onApply}
                      className="flex h-8 flex-1 items-center justify-center gap-1.5 bg-white text-[10px] font-semibold text-black"
                    >
                      <Check className="size-3" /> Apply patch
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-[11px] leading-5 text-zinc-500">
                Describe a workflow change. The assistant will propose a typed patch for review.
                Nothing changes until you apply it.
              </p>
            )}
            {error ? <div className="mt-3 text-[10px] leading-4 text-red-300">{error}</div> : null}
          </div>
          <form
            className="border-t border-white/12 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!prompt.trim() || busy) return;
              onSubmit(prompt.trim());
            }}
          >
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              maxLength={2000}
              placeholder="Route requests over $25,000 to finance..."
              className="min-h-20 w-full resize-none border border-white/15 bg-black p-2.5 text-xs text-white outline-none focus:border-orange-300"
            />
            <button
              type="submit"
              disabled={!prompt.trim() || busy}
              className="mt-2 flex h-8 w-full items-center justify-center gap-2 bg-orange-300 text-[10px] font-bold text-black disabled:opacity-40"
            >
              <Send className="size-3" />{' '}
              {busy ? 'Generating' : proposal ? 'Generate another' : 'Generate proposal'}
            </button>
          </form>
        </aside>
      ) : null}
    </>
  );
}
