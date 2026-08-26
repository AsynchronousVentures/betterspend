import { redirect } from 'next/navigation';

export default function GlExportJobsRedirect() {
  redirect('/gl-mappings?view=export-history');
}
