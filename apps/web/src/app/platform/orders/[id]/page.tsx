'use client';

import { OrderDetail } from '@/features/gigs';

export default function OrderPage({ params }: { params: { id: string } }) {
  return <OrderDetail id={decodeURIComponent(params.id)} />;
}
