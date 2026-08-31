'use client';

import { Bot, Check, RefreshCw, Send, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { buildWorkflowPatchPreview } from './workflow-assistant-preview';
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
  const stale = proposal !== null && proposal.draftRevision !== currentRevision;
  const preview = useMemo(
    () =>
      proposal ? buildWorkflowPatchPreview(proposal.snapshot, proposal.response.operations) : [],
    [proposal],
  );
  if (!available) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        className="absolute right-3 top-3 z-10 flex h-8 items-center gap-2 rounded-md border border-border bg-card px-3 text-xs font-semibold text-muted-foreground shadow-sm hover:border-primary/50 hover:text-foreground"
      >
        <Bot className="size-3.5 text-primary" /> Ask assistant
      </button>
      {open ? (
        <aside className="absolute bottom-3 right-3 top-14 z-20 flex w-[340px] flex-col rounded-lg border border-border/70 bg-card shadow-lg">
          <div className="flex h-11 shrink-0 items-center border-b border-border/70 px-3">
            <Bot className="mr-2 size-3.5 text-primary" />
            <span className="text-xs font-semibold text-foreground">Workflow assistant</span>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close assistant"
              className="ml-auto text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {proposal ? (
              <div className="space-y-3">
                <p className="text-xs leading-5 text-foreground">{proposal.response.summary}</p>
                <div className="max-h-[46vh] space-y-2 overflow-y-auto border-y border-border/70 py-2">
                  {preview.map((item) => (
                    <div key={item.key} className="rounded-md border border-border/70 bg-muted/30 p-2">
                      <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.1em]">
                        <span
                          className={item.action === 'Remove' ? 'text-destructive' : 'text-primary'}
                        >
                          {item.action} {item.subject}
                        </span>
                        <span className="truncate font-mono normal-case tracking-normal text-muted-foreground">
                          {item.title}
                        </span>
                      </div>
                      {item.before ? (
                        <div className="mt-2">
                          <div className="text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                            Before
                          </div>
                          <code className="mt-1 block break-all text-[9px] leading-4 text-rose-700">
                            {item.before}
                          </code>
                        </div>
                      ) : null}
                      {item.after ? (
                        <div className="mt-2">
                          <div className="text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                            After
                          </div>
                          <code className="mt-1 block break-all text-[9px] leading-4 text-emerald-700">
                            {item.after}
                          </code>
                        </div>
                      ) : null}
                      {item.consequence ? (
                        <p className="mt-2 text-[9px] leading-4 text-rose-700">
                          {item.consequence}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div
                  className={`text-[10px] leading-4 ${proposal.response.validation.valid ? 'text-success' : 'text-amber-700'}`}
                >
                  {proposal.response.validation.valid
                    ? 'Patch passes graph validation.'
                    : `${proposal.response.validation.issues.length} validation issue${proposal.response.validation.issues.length === 1 ? '' : 's'} remain.`}
                </div>
                {!proposal.response.validation.valid ? (
                  <div className="space-y-1 text-[9px] leading-4 text-amber-800">
                    {proposal.response.validation.issues.slice(0, 3).map((issue) => (
                      <p key={`${issue.code}-${issue.path.join('.')}`}>{issue.message}</p>
                    ))}
                  </div>
                ) : null}
                {stale ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[10px] leading-4 text-amber-800">
                    The canvas changed after this proposal. Regenerate before applying.
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onReject}
                    className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-border text-[10px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-3" /> Reject
                  </button>
                  {stale ? (
                    <button
                      type="button"
                      onClick={() => onSubmit(prompt)}
                      disabled={!prompt.trim() || busy}
                      className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary text-[10px] font-semibold text-primary-foreground hover:bg-primary/85 disabled:opacity-40"
                    >
                      <RefreshCw className="size-3" /> Regenerate
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onApply}
                      disabled={!proposal.response.validation.valid}
                      className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary text-[10px] font-semibold text-primary-foreground hover:bg-primary/85 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <Check className="size-3" /> Apply patch
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-[11px] leading-5 text-muted-foreground">
                Describe a workflow change. The assistant will propose a typed patch for review.
                Nothing changes until you apply it.
              </p>
            )}
            {error ? (
              <div className="mt-3 text-[10px] leading-4 text-destructive">{error}</div>
            ) : null}
          </div>
          <form
            className="border-t border-border/70 p-3"
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
              className="min-h-20 w-full resize-none rounded-md border border-input bg-white/80 p-2.5 text-xs text-foreground shadow-[inset_0_1px_2px_0_rgba(26,26,26,0.06)] outline-none focus:border-primary/40"
            />
            <button
              type="submit"
              disabled={!prompt.trim() || busy}
              className="mt-2 flex h-8 w-full items-center justify-center gap-2 rounded-md bg-primary text-[10px] font-semibold text-primary-foreground hover:bg-primary/85 disabled:opacity-40"
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
