import { ContractDetail } from '@/features/contracts';

export default function ContractPage({ params }: { params: { id: string } }) {
  return <ContractDetail id={decodeURIComponent(params.id)} />;
}
