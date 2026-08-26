import React from 'react';
import Link from 'next/link';

export function ApprovalEntityLink({
  entity,
  href,
  label,
}: {
  entity: unknown;
  href: string | null;
  label: string;
}) {
  if (entity && href) {
    return (
      <Link href={href} className="mt-1 block truncate font-medium text-primary hover:underline">
        {label}
      </Link>
    );
  }

  return <div className="mt-1 truncate font-medium text-foreground">{label}</div>;
}
