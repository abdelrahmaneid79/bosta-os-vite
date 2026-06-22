import { describe, it, expect } from "vitest";
import { previewBundle, STOCK_CATEGORY, type SeedBundle } from "@/core/import/seed";

const bundle: SeedBundle = {
  sales: [
    { date: "2025-01-02", total: 100 },
    { date: "2025-01-01", total: 200 },
    { date: "2025-01-03", total: 50 },
  ],
  expenses: [
    { date: "2025-01-01", category: STOCK_CATEGORY, amount: 300, vendor: "Bebeto", notes: null },
    { date: "2025-01-02", category: "Rent Expense", amount: 100, vendor: null, notes: null },
    { date: "2025-01-02", category: STOCK_CATEGORY, amount: 50, vendor: null, notes: null },
  ],
  cheques: [
    { date: "2025-01-05", amount: 1000 },
    { date: "2025-01-15", amount: 500 },
  ],
  products: [
    { nameAr: "فستق", barcode: "2301", avgPrice: 1100 },
    { nameAr: "لوز", barcode: "", avgPrice: null },
  ],
};

describe("previewBundle", () => {
  const pv = previewBundle(bundle);

  it("sums sales and reports the date span in order", () => {
    expect(pv.sales.rows).toBe(3);
    expect(pv.sales.total).toBe(350);
    expect(pv.sales.from).toBe("2025-01-01");
    expect(pv.sales.to).toBe("2025-01-03");
  });

  it("splits expenses into Stock vs operating", () => {
    expect(pv.expenses.total).toBe(450);
    expect(pv.expenses.stock).toBe(350); // 300 + 50
    expect(pv.expenses.operating).toBe(100); // rent only
  });

  it("totals cheques as a separate ledger", () => {
    expect(pv.cheques.rows).toBe(2);
    expect(pv.cheques.total).toBe(1500);
  });

  it("counts products with barcodes", () => {
    expect(pv.products.rows).toBe(2);
    expect(pv.products.withBarcode).toBe(1);
  });
});
