import { redirect } from "next/navigation";
import { isAdmin, requireUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { GeneralForm } from "./general-form";

export const metadata = { title: "General settings" };

const COMMON = ["AUD", "USD", "EUR", "GBP", "NZD", "CAD", "SGD", "JPY", "INR", "ZAR"];

function currencyOptions() {
  let codes: string[];
  try {
    codes = Intl.supportedValuesOf("currency");
  } catch {
    codes = COMMON;
  }
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(["en"], { type: "currency" });
  } catch {
    names = null;
  }
  return codes.map((code) => ({ code, name: names?.of(code) ?? code, common: COMMON.includes(code) }));
}

export default async function GeneralSettingsPage() {
  const user = await requireUser();
  if (!isAdmin(user)) redirect("/settings/profile");
  const workspace = await getSetting("workspace");
  return (
    <>
      <PageHeader title="General" description="Your workspace name, branding and defaults used across emails and public pages." />
      <PageBody className="w-full max-w-4xl">
        <GeneralForm initial={workspace} currencies={currencyOptions()} />
      </PageBody>
    </>
  );
}
