import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicShell } from "@/components/public/public-shell";
import { RegistrationView } from "@/components/events/registration-view";
import { loadPublicEvent, publicEventState } from "@/lib/events/public";
import { prefillFromParams, trackEventView } from "@/lib/events/request";

export async function generateMetadata({ params }: PageProps<"/e/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const event = await loadPublicEvent(slug);
  if (!event) return { title: "Event not found" };
  return {
    title: event.title,
    description: event.description?.slice(0, 160) || `Register for ${event.title}`,
    openGraph: { title: event.title, description: event.description?.slice(0, 160) || undefined, images: event.coverImageUrl ? [event.coverImageUrl] : undefined },
  };
}

export default async function EventRegistrationPage({ params, searchParams }: PageProps<"/e/[slug]">) {
  const { slug } = await params;
  const event = await loadPublicEvent(slug);
  if (!event) notFound();
  const { prefill, utm } = prefillFromParams(await searchParams);
  await trackEventView(event, utm);
  const { state, seatsTaken } = await publicEventState(event);
  return (
    <PublicShell wide>
      <RegistrationView event={event} state={state} seatsTaken={seatsTaken} prefill={prefill} utm={utm} />
    </PublicShell>
  );
}
