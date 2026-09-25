"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Device } from "@/lib/account/types";
import { callApi, errorText } from "./api";
import { CopyField } from "./copy-field";
import type { Option } from "./types";

function ErrorNote({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="rounded-lg bg-risk-high-soft px-3 py-2 text-sm text-risk-high-ink">
      {error}
    </p>
  ) : null;
}

/** "Delete this farm?" and friends. `onConfirm` may throw; its message is shown. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  destructive,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setError(null);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-5 sm:p-6">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription asChild>
          <div className="mt-2 space-y-2 text-sm text-muted-foreground">{body}</div>
        </DialogDescription>
        <div className="mt-3">
          <ErrorNote error={error} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
                onOpenChange(false);
              } catch (err) {
                setError(errorText(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Rename a device or move it to another farm. */
export function EditDeviceDialog({
  device,
  farms,
  onOpenChange,
  onSaved,
}: {
  device: Device | null;
  farms: Option[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(device?.name ?? "");
  const [farmId, setFarmId] = useState(device?.farm_id ?? "");
  const [prevId, setPrevId] = useState(device?.id ?? null);
  if ((device?.id ?? null) !== prevId) {
    setPrevId(device?.id ?? null);
    if (device) {
      setName(device.name);
      setFarmId(device.farm_id);
    }
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!device) return;
    setBusy(true);
    setError(null);
    try {
      const patch: Record<string, unknown> = {};
      if (name.trim() !== device.name) patch.name = name;
      if (farmId !== device.farm_id) patch.farm_id = farmId;
      if (Object.keys(patch).length) await callApi(`/api/devices/${encodeURIComponent(device.id)}`, { method: "PATCH", body: patch });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(device)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-5 sm:p-6">
        <DialogTitle>Edit device</DialogTitle>
        <DialogDescription className="mt-1">Readings it already sent stay with the farm they were taken on.</DialogDescription>
        <form onSubmit={save} className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor={`${id}-name`} className="block text-sm font-medium">
              Name
            </label>
            <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-farm`} className="block text-sm font-medium">
              Farm
            </label>
            <Select value={farmId} onValueChange={setFarmId}>
              <SelectTrigger id={`${id}-farm`} className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {farms.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ErrorNote error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A new token was issued: show it once. */
export function TokenDialog({ token, device, onOpenChange }: { token: string | null; device: Device | null; onOpenChange: (open: boolean) => void }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <Dialog open={Boolean(token)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-5 sm:p-6">
        <DialogTitle>New token for {device?.name ?? "the device"}</DialogTitle>
        <DialogDescription className="mt-1">The old token has stopped working. Copy this one now; it won&apos;t be shown again.</DialogDescription>
        {token ? (
          <div className="mt-4 space-y-3 text-sm">
            <CopyField value={token} label="Device token" />
            <p className="text-muted-foreground">Send readings with it:</p>
            <CopyField
              multiline
              label="Test command"
              value={`curl -X POST ${origin}/api/readings -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '{"moisture": 22.5, "temperature": 27.1, "ec": 1.8}'`}
            />
          </div>
        ) : null}
        <div className="mt-4 flex justify-end">
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
