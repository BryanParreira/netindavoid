import { ThreatDetailClient } from "./ThreatDetailClient";

export function generateStaticParams() { return [] }

export default function AlertDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <ThreatDetailClient params={params} />;
}
