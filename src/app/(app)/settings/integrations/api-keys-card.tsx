"use client";

import { useState } from "react";
import { KeyRound, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge } from "@/components/app/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CopyButton } from "@/components/settings/copy-button";
import { FieldErrors } from "@/components/settings/field-error";
import { SettingsCard } from "@/components/settings/settings-card";
import { useRunAction } from "@/components/settings/use-run-action";
import { createApiKeyAction, revokeApiKeyAction } from "./actions";

export type ApiKeyRow = { id: string; name: string; prefix: string; created: string; lastUsed: string; revoked: boolean };

export function ApiKeysCard({ keys }: { keys: ApiKeyRow[] }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ key: string; name: string } | null>(null);
  const { run, pending, fieldErrors } = useRunAction();

  return (
    <>
      <SettingsCard
        title="API keys"
        description="Keys let other software read and create data through the REST API. Treat them like passwords."
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Create key
          </Button>
        }
        contentClassName={keys.length ? "px-0" : undefined}
      >
        {keys.length === 0 ? (
          <EmptyState icon={KeyRound} title="No API keys" description="Create a key to call the Relay API from your own tools or automation platforms." className="border-0 bg-transparent" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead className="hidden sm:table-cell">Last used</TableHead>
                <TableHead className="w-24 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id} className={k.revoked ? "opacity-60" : undefined}>
                  <TableCell className="pl-4">
                    <div className="font-medium">{k.name}</div>
                    <div className="text-xs text-muted-foreground">Created {k.created}</div>
                  </TableCell>
                  <TableCell>
                    <code className="font-mono text-xs">{k.prefix}…</code>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{k.revoked ? <StatusBadge tone="neutral">Revoked</StatusBadge> : k.lastUsed}</TableCell>
                  <TableCell className="pr-4 text-right">
                    {!k.revoked && (
                      <ConfirmDialog
                        title={`Revoke “${k.name}”?`}
                        description="Anything using this key will immediately get 401 errors. This can’t be undone."
                        confirmLabel="Revoke key"
                        destructive
                        onConfirm={async () => {
                          const res = await revokeApiKeyAction(k.id);
                          if (res.ok) toast.success(res.message);
                          else toast.error(res.error);
                        }}
                        trigger={
                          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                            <Trash2 /> Revoke
                          </Button>
                        }
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SettingsCard>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => createApiKeyAction({ name }), {
                success: "",
                onSuccess: (data) => {
                  if (!data) return;
                  setCreating(false);
                  setName("");
                  setCreated(data);
                },
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>Create API key</DialogTitle>
              <DialogDescription>Name it after the tool that will use it, e.g. “Zapier” or “Website forms”.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="key-name">Name</Label>
              <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus aria-invalid={!!fieldErrors.name} />
              <FieldErrors errors={fieldErrors.name} />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !name.trim()}>
                {pending && <Spinner />} Create key
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!created} onOpenChange={(o) => !o && setCreated(null)}>
        <DialogContent>
          {created && (
            <>
              <DialogHeader>
                <DialogTitle>Your new API key</DialogTitle>
                <DialogDescription>
                  Copy the key for “{created.name}” now. For security Relay only stores a hash, so it <strong>can’t be shown again</strong>.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2">
                <Input readOnly value={created.key} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 font-mono text-xs" aria-label="API key" />
                <CopyButton value={created.key} label="Copy" />
              </div>
              <Alert>
                <ShieldAlert />
                <AlertTitle>Keep it secret</AlertTitle>
                <AlertDescription>Send it in the Authorization header: <code className="font-mono text-xs">Authorization: Bearer {created.key.slice(0, 8)}…</code></AlertDescription>
              </Alert>
              <DialogFooter>
                <Button onClick={() => setCreated(null)}>I’ve copied it</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
