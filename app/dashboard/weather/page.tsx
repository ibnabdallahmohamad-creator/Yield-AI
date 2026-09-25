import type { Metadata } from "next";
import { WeatherExplorer, type WeatherFarm } from "@/components/weather/weather-explorer";
import { CROPS } from "@/lib/agronomy-tables";
import { requireUser } from "@/lib/auth/session";
import { rankFarms } from "@/lib/dashboard";
import { getDashboardFor } from "@/lib/data/repository";
import { isWeatherLayer } from "@/lib/weather/layers";

export const metadata: Metadata = { title: "Weather" };

/**
 * Weather (`/dashboard/weather`): the Gulf forecast map, a meteogram for a farm or any spot, and
 * every farm's weather. `?farm=` picks the farm, `?layer=` the map layer (wind by default).
 */
export default async function WeatherPage({ searchParams }: PageProps<"/dashboard/weather">) {
  const user = await requireUser("/dashboard/weather");
  const [{ farm, layer }, data] = await Promise.all([searchParams, getDashboardFor(user)]);
  const farms: WeatherFarm[] = rankFarms(data.farms).map((b) => ({
    id: b.farm.id,
    name: b.farm.name,
    region: b.farm.region,
    crop: CROPS[b.farm.main_crop].name,
    lat: b.farm.lat,
    lng: b.farm.lng,
  }));
  const initialFarmId = typeof farm === "string" && farms.some((f) => f.id === farm) ? farm : null;

  return (
    <div className="yai-enter px-4 pt-5 pb-10 sm:px-6 lg:px-8 lg:pt-6">
      <WeatherExplorer farms={farms} initialFarmId={initialFarmId} initialLayer={isWeatherLayer(layer) ? layer : "wind"} />
    </div>
  );
}
