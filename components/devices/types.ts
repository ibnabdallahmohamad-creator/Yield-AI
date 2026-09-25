import type { SoilType } from "@/lib/agronomy-tables";

export interface Option {
  id: string;
  name: string;
}

/** What the Farms & devices page needs about each of the account's farms. */
export interface ManagedFarm {
  id: string;
  name: string;
  crop_id: string;
  crop: string;
  region: string;
  lat: number;
  lng: number;
  area_ha: number;
  planting_date: string;
  soil_type: SoilType;
  irrigation_water_ec: number;
  /** The last day (YYYY-MM-DD, Qatar) with readings, if any. */
  last_reading_day: string | null;
}
