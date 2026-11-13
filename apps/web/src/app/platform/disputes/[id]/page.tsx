import { DisputeDetail } from '@/features/disputes';

export default function DisputePage({ params }: { params: { id: string } }) {
  return <DisputeDetail id={decodeURIComponent(params.id)} />;
}
