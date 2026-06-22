import type { Database } from "./database.types";

/** Ergonomic accessors over the generated schema. */
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type Enums<T extends keyof Database["public"]["Enums"]> =
  Database["public"]["Enums"][T];
export type Functions = Database["public"]["Functions"];
export type FnArgs<T extends keyof Functions> = Functions[T]["Args"];
