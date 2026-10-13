import { PublicNotFound } from "@/components/events/public-states";

export default function NotFound() {
  return <PublicNotFound title="Link not recognised" body="This unsubscribe link is invalid. Use the link in the most recent email you received." />;
}
