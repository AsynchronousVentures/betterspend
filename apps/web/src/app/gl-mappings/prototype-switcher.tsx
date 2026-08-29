'use client';

import { useEffect } from 'react';
import { ArrowLeft, ArrowRight, FlaskConical } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export const PROTOTYPE_VARIANTS = [
  { key: 'a', name: 'Mapping workbench' },
  { key: 'b', name: 'Exception queue' },
  { key: 'c', name: 'Catalog matcher' },
] as const;

export type PrototypeVariant = (typeof PROTOTYPE_VARIANTS)[number]['key'];

export function PrototypeSwitcher({ current }: { current: PrototypeVariant }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function selectVariant(offset: number) {
    const currentIndex = PROTOTYPE_VARIANTS.findIndex((variant) => variant.key === current);
    const nextIndex =
      (currentIndex + offset + PROTOTYPE_VARIANTS.length) % PROTOTYPE_VARIANTS.length;
    const params = new URLSearchParams(searchParams.toString());
    params.set('variant', PROTOTYPE_VARIANTS[nextIndex].key);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (event.key === 'ArrowLeft') selectVariant(-1);
      if (event.key === 'ArrowRight') selectVariant(1);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  if (process.env.NODE_ENV === 'production') return null;

  const active = PROTOTYPE_VARIANTS.find((variant) => variant.key === current)!;

  return (
    <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center border border-white/20 bg-zinc-950 px-1.5 py-1.5 text-white shadow-2xl shadow-black">
      <button
        type="button"
        aria-label="Previous prototype variant"
        className="grid size-9 place-items-center border border-transparent hover:border-white/20 hover:bg-white/10"
        onClick={() => selectVariant(-1)}
      >
        <ArrowLeft className="size-4" />
      </button>
      <div className="flex min-w-60 items-center justify-center gap-2 px-4 text-xs font-semibold">
        <FlaskConical className="size-3.5 text-orange-400" />
        <span className="uppercase tracking-[0.16em] text-zinc-500">Prototype</span>
        <span>
          {active.key.toUpperCase()} · {active.name}
        </span>
      </div>
      <button
        type="button"
        aria-label="Next prototype variant"
        className="grid size-9 place-items-center border border-transparent hover:border-white/20 hover:bg-white/10"
        onClick={() => selectVariant(1)}
      >
        <ArrowRight className="size-4" />
      </button>
    </div>
  );
}
