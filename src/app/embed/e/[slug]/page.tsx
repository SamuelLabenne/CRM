import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicShell } from "@/components/public/public-shell";
import { RegistrationView } from "@/components/events/registration-view";
import { loadPublicEvent, publicEventState } from "@/lib/events/public";
import { prefillFromParams, trackEventView } from "@/lib/events/request";

export const metadata: Metadata = { title: "Register", robots: { index: false, follow: false } };

export default async function EmbeddedRegistrationPage({ params, searchParams }: PageProps<"/embed/e/[slug]">) {
  const { slug } = await params;
  const event = await loadPublicEvent(slug);
  if (!event) notFound();
  const { prefill, utm } = prefillFromParams(await searchParams);
  await trackEventView(event, utm);
  const { state, seatsTaken } = await publicEventState(event);
  return (
    <PublicShell embed>
      <RegistrationView event={event} state={state} seatsTaken={seatsTaken} prefill={prefill} utm={utm} embed />
    </PublicShell>
  );
}
