'use client';

import { useEffect } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export interface PrototypeVariant {
  key: string;
  name: string;
}

export function PrototypeSwitcher({
  variants,
  current,
}: {
  variants: readonly PrototypeVariant[];
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function selectVariant(direction: -1 | 1) {
    const currentIndex = Math.max(
      0,
      variants.findIndex((variant) => variant.key === current),
    );
    const nextIndex = (currentIndex + direction + variants.length) % variants.length;
    const params = new URLSearchParams(searchParams.toString());
    params.set('variant', variants[nextIndex]?.key ?? variants[0]?.key ?? '');
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target?.matches('input, textarea, select, [contenteditable="true"]') ||
        (target?.closest('[contenteditable="true"]') ?? null)
      ) {
        return;
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      selectVariant(event.key === 'ArrowLeft' ? -1 : 1);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  if (process.env.NODE_ENV === 'production') return null;

  const selected = variants.find((variant) => variant.key === current) ?? variants[0];

  return (
    <div className="fixed bottom-5 left-1/2 z-[100] flex -translate-x-1/2 items-center border border-white/25 bg-white px-1.5 py-1 text-black shadow-2xl">
      <button
        type="button"
        onClick={() => selectVariant(-1)}
        className="grid size-9 place-items-center hover:bg-black hover:text-white"
        aria-label="Previous prototype variant"
      >
        <ArrowLeft className="size-4" />
      </button>
      <div className="min-w-48 px-4 text-center text-xs font-semibold">
        {selected?.key} ({selected?.name})
      </div>
      <button
        type="button"
        onClick={() => selectVariant(1)}
        className="grid size-9 place-items-center hover:bg-black hover:text-white"
        aria-label="Next prototype variant"
      >
        <ArrowRight className="size-4" />
      </button>
    </div>
  );
}
