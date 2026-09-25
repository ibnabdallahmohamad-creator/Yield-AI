import { Beaker, CloudRain, Cloudy, Droplet, Droplets, Gauge, Thermometer, ThermometerSun, Umbrella, Wind, type LucideIcon } from "lucide-react";
import type { WeatherLayerKey } from "@/lib/weather/layers";

/** One icon per weather layer, shared by the map's layer menu and the Weather page's chips. */
export const WEATHER_LAYER_ICON: Record<WeatherLayerKey, LucideIcon> = {
  wind: Wind,
  gust: Wind,
  temp: Thermometer,
  feels: ThermometerSun,
  rh: Droplets,
  dew: Droplet,
  rain: CloudRain,
  rainAccum: Beaker,
  precipProb: Umbrella,
  clouds: Cloudy,
  pressure: Gauge,
};
