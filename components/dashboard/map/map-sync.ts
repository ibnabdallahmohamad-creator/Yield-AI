import type L from "leaflet";

/**
 * Keeps side-by-side maps (compare mode) on the same view. The leader handles fly-to and
 * fit-all; followers mirror every move of whichever map the user drags.
 */
export interface MapSync {
  add(map: L.Map, role: "leader" | "follower"): () => void;
  moved(source: L.Map): void;
}

export function createMapSync(): MapSync {
  const maps = new Map<L.Map, "leader" | "follower">();
  let syncing = false;

  const mirror = (source: L.Map) => {
    if (syncing) return;
    syncing = true;
    try {
      for (const map of maps.keys()) {
        if (map !== source) map.setView(source.getCenter(), source.getZoom(), { animate: false });
      }
    } finally {
      syncing = false;
    }
  };

  return {
    add(map, role) {
      maps.set(map, role);
      if (role === "follower") {
        const leader = [...maps.entries()].find(([, r]) => r === "leader")?.[0];
        if (leader) map.setView(leader.getCenter(), leader.getZoom(), { animate: false });
      } else {
        for (const [other, r] of maps) if (r === "follower" && other !== map) other.setView(map.getCenter(), map.getZoom(), { animate: false });
      }
      return () => {
        maps.delete(map);
      };
    },
    moved: mirror,
  };
}
