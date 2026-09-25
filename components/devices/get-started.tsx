import { Cpu, Plus, Wifi } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * What a new account sees instead of data: it starts empty (no sample farms), so point the way to
 * adding a farm and connecting an ESP32.
 */
export function GetStarted({
  hasFarms = false,
  device,
  error,
  className,
}: {
  hasFarms?: boolean;
  /** A device already set up on the farm, which hasn't sent readings yet. */
  device?: { name: string; paired: boolean } | null;
  /** The account's data couldn't be loaded. */
  error?: string | null;
  className?: string;
}) {
  if (error) {
    return (
      <div className={cn("mx-auto flex max-w-lg flex-col items-center gap-2 p-6 text-center", className)}>
        <p className="text-xl font-semibold">Your farms can&apos;t be loaded right now</p>
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button asChild variant="outline" className="mt-2 h-10">
          <Link href="/dashboard/devices">Farms &amp; devices</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className={cn("mx-auto flex max-w-lg flex-col items-center gap-3 p-6 text-center", className)}>
      <span className="flex size-12 items-center justify-center rounded-2xl bg-accent text-primary" aria-hidden="true">
        {hasFarms ? <Wifi className="size-6" /> : <Cpu className="size-6" />}
      </span>
      <p className="text-xl font-semibold">{hasFarms ? "Waiting for the first readings" : "Welcome to Yield AI"}</p>
      <p className="text-sm text-muted-foreground">
        {device
          ? device.paired
            ? `${device.name} is connected but hasn't sent a reading yet. Check that it is powered and on Wi-Fi; readings appear here within one interval.`
            : `${device.name} is set up but not paired yet. Enter its pairing code on the ESP32's setup page to start receiving readings.`
          : hasFarms
            ? "Connect an ESP32 probe to your farm. As soon as it sends readings over Wi-Fi, they appear here with advice for the farm."
            : "Your account starts empty. Add your farm, then connect an ESP32 probe over Wi-Fi. Its readings, the weather and advice for the farm appear here."}
      </p>
      <Button asChild className="mt-1 h-10">
        <Link href="/dashboard/devices">
          {hasFarms ? <Wifi aria-hidden="true" /> : <Plus aria-hidden="true" />}
          {device ? "Farms & devices" : hasFarms ? "Connect an ESP32" : "Add your first farm"}
        </Link>
      </Button>
    </div>
  );
}
