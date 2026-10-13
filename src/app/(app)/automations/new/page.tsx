import { ArrowRight, Check, Sparkles, SquarePen, Zap } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { SubmitButton } from "@/components/app/submit-button";
import { Card } from "@/components/ui/card";
import { RECIPE_ICONS } from "@/components/automations/icons";
import { RECIPES } from "@/lib/automations/recipes";
import { createBlankAutomationAction, createFromRecipeAction } from "../actions";

export const metadata = { title: "New automation" };

export default async function NewAutomationPage() {
  await requireUser();
  return (
    <>
      <PageHeader
        title="New automation"
        description="Start from a ready-made recipe – you can change everything afterwards – or build from scratch."
        back={{ href: "/automations", label: "Automations" }}
      />
      <PageBody className="mx-auto w-full max-w-6xl">
        <section className="grid gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-primary" /> Start from a recipe
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {RECIPES.map((r) => {
              const Icon = RECIPE_ICONS[r.id];
              return (
                <Card key={r.id} className="gap-4 p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-medium">{r.name}</h3>
                      <p className="text-sm text-muted-foreground">{r.description}</p>
                    </div>
                  </div>
                  <ol className="grid flex-1 gap-1.5 text-sm">
                    <li className="flex items-start gap-2 text-primary">
                      <Zap className="mt-0.5 size-3.5 shrink-0" />
                      <span className="font-medium">{r.triggerSummary}</span>
                    </li>
                    {r.outline.map((line) => (
                      <li key={line} className="flex items-start gap-2 text-muted-foreground">
                        <Check className="mt-0.5 size-3.5 shrink-0" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ol>
                  <form action={createFromRecipeAction.bind(null, r.id)}>
                    <SubmitButton variant="outline" className="w-full">
                      Use this recipe <ArrowRight />
                    </SubmitButton>
                  </form>
                </Card>
              );
            })}
          </div>
        </section>

        <section className="grid gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <SquarePen className="size-4 text-primary" /> Or start from scratch
          </h2>
          <Card className="flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-medium">Blank automation</h3>
              <p className="text-sm text-muted-foreground">Pick a trigger, then add emails, waits, conditions and actions step by step.</p>
            </div>
            <form action={createBlankAutomationAction}>
              <SubmitButton>
                Start from scratch <ArrowRight />
              </SubmitButton>
            </form>
          </Card>
        </section>
      </PageBody>
    </>
  );
}
