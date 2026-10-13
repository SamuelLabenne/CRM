import { PublicNotFound } from "@/components/events/public-states";

export default function NotFound() {
  return <PublicNotFound title="Registration not found" body="This link is invalid or has expired. Check the latest email we sent you." />;
}
