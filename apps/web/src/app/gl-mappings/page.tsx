import { Suspense } from 'react';
import { QboMappingPrototype } from './qbo-mapping-prototype';

export default function GlMappingsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-black p-8 text-sm text-zinc-500">Loading prototype...</div>
      }
    >
      <QboMappingPrototype />
    </Suspense>
  );
}
