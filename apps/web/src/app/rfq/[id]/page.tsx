import RfqPage from '../page';

export default async function RfqDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RfqPage initialSelectedId={id} />;
}
