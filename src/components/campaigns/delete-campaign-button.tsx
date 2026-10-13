"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { deleteCampaignAction } from "@/app/(app)/campaigns/actions";

export function DeleteCampaignButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      destructive
      title={`Delete “${name}”?`}
      description="This can't be undone. Linked events and broadcasts are kept."
      confirmLabel="Delete campaign"
      onConfirm={async () => {
        const res = await deleteCampaignAction(id);
        if (!res.ok) return toast.error(res.error);
        toast.success("Campaign deleted");
        router.push("/campaigns");
      }}
      trigger={
        <Button variant="destructive" className="w-fit">
          <Trash2 /> Delete campaign
        </Button>
      }
    />
  );
}
