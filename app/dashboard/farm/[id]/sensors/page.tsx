import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { SensorManager, type ManagedSensor } from "@/components/farms/sensor-manager";
import { Button } from "@/components/ui/button";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { getFarmBundle } from "@/lib/data/repository";
import { isDemoUser, scopeFor } from "@/lib/farms/scope";
import { farmStore } from "@/lib/farms/store";

export async function generateMetadata({ params }: PageProps<"/dashboard/farm/[id]/sensors">): Promise<Metadata> {
  const [{ id }, user] = await Promise.all([params, getCurrentUser()]);
  if (!user) return { title: "Sensors" };
  const found = await getFarmBundle(scopeFor(user), id).catch(() => null);
  return { title: found ? `Sensors · ${found.bundle.farm.name}` : "Farm not found" };
}

export default async function SensorsPage({ params, searchParams }: PageProps<"/dashboard/farm/[id]/sensors">) {
  const { id } = await params;
  const user = await requireUser(`/dashboard/farm/${encodeURIComponent(id)}/sensors`);
  const scope = scopeFor(user);
  const [{ new: isNew }, found] = await Promise.all([searchParams, getFarmBundle(scope, id)]);
  if (!found) notFound();
  const { farm } = found.bundle;
  const canEdit = !isDemoUser(user);

  // Registered sensors carry a label; probes that only post readings show up without one.
  const labels = new Map<string, string>();
  if (scope.kind === "owner") {
    for (const s of await farmStore().listSensors([farm.id]).catch(() => [])) labels.set(s.id, s.label);
  }
  const sensors: ManagedSensor[] = found.bundle.sensors.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, label: labels.get(s.id) ?? "" }));

  return (
    <div className="min-h-dvh">
      <DashboardHeader className="sticky top-0" user={{ name: user.name, email: user.email }} canEdit={canEdit} title="Sensors" />
      <div className="mx-auto max-w-[1600px] space-y-3 p-3 sm:p-4">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
            <Link href={`/dashboard?farm=${encodeURIComponent(farm.id)}`}>
              <ArrowLeft /> {farm.name}
            </Link>
          </Button>
          <h1 className="mt-1 font-display text-[28px] leading-tight font-semibold tracking-tight">Sensors · {farm.name}</h1>
          {isNew ? (
            <p className="mt-2 rounded-xl bg-risk-low-soft px-3 py-2 text-[13.5px] text-risk-low-ink">
              Farm saved. Now place its sensors: click the map where each probe is installed, or type its coordinates.{" "}
              <Link href={`/dashboard?farm=${encodeURIComponent(farm.id)}`} className="font-semibold underline">
                Skip for now
              </Link>
            </p>
          ) : (
            <p className="mt-1 text-[13.5px] text-muted-foreground">
              {farm.region} · {farm.area_ha.toLocaleString("en-US", { maximumFractionDigits: 1 })} ha · {farm.lat.toFixed(5)}, {farm.lng.toFixed(5)}
            </p>
          )}
        </div>
        <SensorManager farm={{ id: farm.id, name: farm.name, lat: farm.lat, lng: farm.lng, polygon: farm.polygon }} sensors={sensors} canEdit={canEdit} />
      </div>
    </div>
  );
}
