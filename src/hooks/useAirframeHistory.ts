import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

/** One cached lookup per airframe, shared by the details header and the history section. */
export function useAirframeHistory(icao24: string) {
  return useQuery({
    queryKey: ["airframe", icao24],
    queryFn: ({ signal }) => api.airframeHistory(icao24, signal),
    staleTime: 24 * 60 * 60_000,
    gcTime: 60 * 60_000,
    retry: false,
  });
}
