import type { Metadata } from "next";
import { PublicBookingPage } from "@/components/scheduling/public-booking-page";

export const metadata: Metadata = { title: "Book a meeting", robots: { index: false } };

export default async function EmbedBookPage({ params, searchParams }: PageProps<"/embed/book/[slug]">) {
  const { slug } = await params;
  return <PublicBookingPage slug={slug} searchParams={await searchParams} embed />;
}
