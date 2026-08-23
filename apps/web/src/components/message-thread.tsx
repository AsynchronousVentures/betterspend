'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { api } from '../lib/api';

interface Message {
  id: string;
  senderType: 'user' | 'vendor';
  authorName: string;
  body: string;
  createdAt: string;
}

/**
 * Append-only conversation attached to a procurement record. Buyers post
 * through the authenticated API; the vendor portal posts through its token.
 * Polls lightly so replies from the other side show up without a refresh.
 */
export function MessageThread({
  threadType,
  threadId,
  portalToken,
}: {
  threadType: string;
  threadId: string;
  portalToken?: string;
}) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const loadVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const data = portalToken
        ? await api.vendorPortal.listMessages(portalToken, threadType, threadId)
        : await api.messages.list(threadType, threadId);
      if (version === loadVersion.current) setMessages(data);
    } catch {
      if (version === loadVersion.current) setError('Failed to load messages.');
    }
  }, [portalToken, threadType, threadId]);

  useEffect(() => {
    // Drop the previous conversation immediately so a slow or failed request
    // for the new thread never shows messages from another thread.
    setMessages(null);
    setError('');
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages?.length]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError('');
    try {
      if (portalToken) {
        await api.vendorPortal.postMessage(portalToken, threadType, threadId, body);
      } else {
        await api.messages.post(threadType, threadId, body);
      }
      setDraft('');
      await load();
    } catch {
      setError('Failed to send message.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
        {messages === null ? (
          <div className="px-1 text-sm text-muted-foreground">Loading messages...</div>
        ) : messages.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
            No messages yet. Start the conversation below; the full history stays on this record.
          </div>
        ) : (
          messages.map((message) => {
            const fromVendor = message.senderType === 'vendor';
            return (
              <div
                key={message.id}
                className={`rounded-lg border px-3 py-2 ${
                  fromVendor
                    ? 'border-border/70 bg-muted/30'
                    : 'border-primary/25 bg-primary/5'
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold text-foreground">
                    {message.authorName}
                    {fromVendor ? '' : ' (internal)'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(message.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{message.body}</p>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="space-y-2">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={portalToken ? 'Reply to the buyer...' : 'Message the supplier...'}
          rows={3}
        />
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={send} disabled={sending || !draft.trim()}>
            {sending ? 'Sending...' : 'Send Message'}
          </Button>
        </div>
      </div>
    </div>
  );
}
