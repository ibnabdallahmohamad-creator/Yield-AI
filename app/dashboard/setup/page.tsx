import { ArrowRight, Sprout } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { switchToSignupAction } from "@/app/(auth)/actions";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { SetupPage } from "@/components/setup/setup-page";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { getViewerSettings } from "@/lib/data/repository";
import { storeFor } from "@/lib/store";

export const metadata: Metadata = { title: "Farms & devices" };

/** The address this page was requested on — what an ESP32 on the same network or the internet should post to. */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? (host.startsWith("localhost") || /^[\d.]+(:\d+)?$/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function FarmsAndDevicesPage() {
  const user = await requireUser("/dashboard/setup");
  const headerUser = { name: user.name, email: user.email, demo: user.demo };

  if (user.demo) {
    return (
      <div className="min-h-dvh">
        <DashboardHeader user={headerUser} source="demo" weatherOffline={false} title="Farms & devices" showSetupLink={false} />
        <main id="main" className="mx-auto max-w-2xl p-5">
          <div className="rounded-2xl border bg-card p-6 shadow-xs">
            <Sprout className="size-7 text-primary" aria-hidden="true" />
            <h1 className="mt-3 font-display text-[26px] leading-tight font-semibold">Connect your own farm</h1>
            <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">
              You&apos;re in the shared demo account, which shows 8 built-in demo farms. To add your farm and receive readings from your
              ESP32 over Wi-Fi, create your own free account — it starts empty, with no demo data.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <form action={switchToSignupAction}>
                <Button type="submit" size="lg" className="h-10 px-4">
                  Create my account <ArrowRight />
                </Button>
              </form>
              <Button asChild variant="outline" size="lg" className="h-10 px-4">
                <Link href="/dashboard">Back to the demo</Link>
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const store = storeFor(user);
  const [farms, devices, settings, origin] = await Promise.all([
    store.listFarms(user.id),
    store.listDevices(user.id),
    getViewerSettings(user),
    requestOrigin(),
  ]);

  return (
    <SetupPage
      user={headerUser}
      source={store.kind}
      farms={farms}
      devices={devices}
      settings={settings}
      serverUrl={origin}
    />
  );
}
