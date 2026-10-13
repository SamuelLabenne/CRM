import type { Metadata } from "next";
import { PublicBookingPage } from "@/components/scheduling/public-booking-page";
import { getBookingPageBySlug } from "@/lib/scheduling/booking";

export async function generateMetadata({ params }: PageProps<"/book/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const page = await getBookingPageBySlug(slug);
  return { title: page ? `Book: ${page.title}` : "Booking page" };
}

export default async function BookPage({ params, searchParams }: PageProps<"/book/[slug]">) {
  const { slug } = await params;
  return <PublicBookingPage slug={slug} searchParams={await searchParams} embed={false} />;
}
