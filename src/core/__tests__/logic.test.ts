import { describe, it, expect } from "vitest";
import { CAP, isEnabled, cap } from "@/core/capabilities";
import { reconTolerance } from "@/core/read/sales";

describe("reconciliation tolerance = max(5, 0.5% of total)", () => {
  it("floors at 5 EGP for small days", () => {
    expect(reconTolerance(0)).toBe(5);
    expect(reconTolerance(500)).toBe(5); // 0.5% = 2.5 < 5
  });
  it("scales at 0.5% for large days", () => {
    expect(reconTolerance(2000)).toBe(10);
    expect(reconTolerance(100000)).toBe(500);
  });
});

describe("capability system", () => {
  it("Goods / Purchases / Sales creation are enabled", () => {
    expect(CAP.productCreate).toBe("enabled");
    expect(CAP.productEdit).toBe("enabled");
    expect(CAP.purchaseCreate).toBe("enabled");
    expect(CAP.saleCreate).toBe("enabled");
    expect(CAP.saleItemAdd).toBe("enabled");
  });
  it("financial reversals are flagged risky (need confirmation)", () => {
    expect(cap("saleItemVoid")).toBe("risky");
    expect(cap("saleItemEdit")).toBe("risky");
    expect(cap("saleVoid")).toBe("risky");
  });
  it("unbuilt modules stay gated", () => {
    for (const k of ["expenseCreate", "cashCount", "chequeRecord", "importApprove", "settingsEdit"] as const) {
      expect(isEnabled(k)).toBe(false);
    }
  });
});
