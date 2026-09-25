import type { Metadata } from "next";
import { DemoDevices } from "@/components/devices/demo-devices";
import { DevicesManager } from "@/components/devices/devices-manager";
import type { ManagedFarm } from "@/components/devices/types";
import { isDemoUser } from "@/lib/account/store";
import { CROP_IDS, CROPS } from "@/lib/agronomy-tables";
import { requireUser } from "@/lib/auth/session";
import { getDashboardFor } from "@/lib/data/repository";

export const metadata: Metadata = { title: "Farms & devices" };

export default async function DevicesPage() {
  const user = await requireUser("/dashboard/devices");
  const demo = isDemoUser(user);
  const data = await getDashboardFor(user);
  if (demo) {
    // The demo's sample farms are read-only: show their probes, and how to connect real ones.
    return (
      <div className="yai-enter px-4 pt-5 pb-10 sm:px-6 lg:px-8 lg:pt-6">
        <DemoDevices farms={data.farms} today={data.dates[data.dates.length - 1]} />
      </div>
    );
  }
  const farms: ManagedFarm[] = data.farms.map((b) => {
    const lastDay = b.days.findLast((d) => d !== null);
    return {
      id: b.farm.id,
      name: b.farm.name,
      crop_id: b.farm.main_crop,
      crop: CROPS[b.farm.main_crop]?.name ?? b.farm.main_crop,
      region: b.farm.region,
      lat: b.farm.lat,
      lng: b.farm.lng,
      area_ha: Math.round(b.farm.area_ha * 100) / 100,
      planting_date: b.farm.planting_date,
      soil_type: b.farm.soil_type,
      irrigation_water_ec: b.farm.irrigation_water_ec,
      last_reading_day: lastDay?.date ?? null,
    };
  });
  return (
    <div className="yai-enter px-4 pt-5 pb-10 sm:px-6 lg:px-8 lg:pt-6">
      <DevicesManager
        demo={false}
        farms={farms}
        devices={data.account?.devices ?? []}
        error={data.account?.error ?? (data.sourceNote && data.farms.length === 0 ? data.sourceNote : null)}
        crops={CROP_IDS.map((id) => ({ id, name: CROPS[id].name }))}
      />
    </div>
  );
}
