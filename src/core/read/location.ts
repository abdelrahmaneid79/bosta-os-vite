/** THE BRANCH — Bosta Bites inside Hyper Hub, Gardenia Mall.
 *
 *  The books say what sold. This says WHERE it sold from: which fixtures
 *  exist, how much traffic each sees, whether it is lit, branded or signed,
 *  and the standing findings from the owner's own photo audit of the stand.
 *
 *  Without this the strategist can only ever talk about products in the
 *  abstract — it cannot say "your best wall bay is empty" or "the impulse
 *  tower carries no brand name", which are the moves that actually change a
 *  concession's takings.
 *
 *  Scoped to ONE location on purpose. When Bosta Bites opens a second branch
 *  these facts must not leak across it — every row is keyed by location.
 *  READ-ONLY. */
import { requireEngine } from "@/core/db/engine";
import type { LocationObservationFact, LocationProfileFact, ZoneFact } from "@/core/strategist/retail/contract";

export interface LocationBrain {
  locationId: string | null;
  profile: LocationProfileFact | null;
  zones: ZoneFact[];
  observations: LocationObservationFact[];
}

const EMPTY: LocationBrain = { locationId: null, profile: null, zones: [], observations: [] };

/** These tables are branch-intelligence, outside the generated money schema,
 *  so they are read through a loosely-typed view of the client and mapped
 *  into the strategist's own contract types immediately below. */
type Loose = { from: (t: string) => any };

export async function getLocationBrain(): Promise<LocationBrain> {
  const sb = requireEngine() as unknown as Loose;

  const [profileRes, zoneRes, obsRes] = await Promise.all([
    sb.from("location_profile").select("*").limit(1),
    sb.from("location_zones").select("*").eq("active", true).order("name"),
    sb.from("location_observations").select("*").neq("status", "resolved"),
  ]);

  // The branch brain is advisory: if it is unavailable the strategist still
  // runs on the books rather than failing the whole page.
  if (zoneRes.error && obsRes.error) return EMPTY;

  const p = (profileRes.data ?? [])[0] as Record<string, unknown> | undefined;
  const profile: LocationProfileFact | null = p
    ? {
        operatingModel: (p.operating_model as string) ?? null,
        pricingControl: (p.pricing_control as string) ?? null,
        brandAssets: (p.brand_assets as string) ?? null,
        equipment: (p.equipment as string) ?? null,
        constraints: (p.constraints_notes as string) ?? null,
      }
    : null;

  const zones: ZoneFact[] = ((zoneRes.data ?? []) as Record<string, unknown>[]).map((z) => ({
    key: (z.zone_key as string) ?? "",
    name: (z.name as string) ?? "",
    tier: (z.tier as string) ?? "",
    traffic: (z.traffic as string) ?? "",
    facings: Number(z.approx_facings) || 0,
    lit: Boolean(z.lit),
    branded: Boolean(z.branded),
    signage: (z.signage as string) ?? null,
    notes: (z.notes as string) ?? null,
    active: z.active !== false,
  }));

  const observations: LocationObservationFact[] = ((obsRes.data ?? []) as Record<string, unknown>[])
    // a "corrected" row is a finding the owner has already overturned — it
    // must never be reasoned from again
    .filter((o) => o.status !== "corrected")
    .map((o) => ({
      category: (o.category as string) ?? "",
      severity: (o.severity as string) ?? "minor",
      finding: (o.finding as string) ?? "",
      recommendation: (o.recommendation as string) ?? null,
    }));

  return {
    locationId: (p?.location_id as string) ?? null,
    profile, zones, observations,
  };
}
