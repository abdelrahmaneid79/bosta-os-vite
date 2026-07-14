import { describe, it, expect, vi, beforeEach } from "vitest";

const insertMock = vi.fn();
const fromMock = vi.fn(() => ({ insert: insertMock }));
const getUserMock = vi.fn();

vi.mock("@/core/db/engine", () => ({
  requireEngine: () => ({ from: fromMock, auth: { getUser: getUserMock } }),
}));

import { logAudit } from "@/core/audit/log";

describe("logAudit", () => {
  beforeEach(() => {
    insertMock.mockReset().mockResolvedValue({ error: null });
    fromMock.mockClear();
    getUserMock.mockReset().mockResolvedValue({ data: { user: { id: "owner-1" } } });
  });

  it("writes actor, action, entity and detail", async () => {
    await logAudit({ action: "sale.void", entityType: "sales", entityId: "s1", detail: { reason: "test" } });
    expect(fromMock).toHaveBeenCalledWith("audit_log");
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      actor: "owner-1", action: "sale.void", entity_type: "sales", entity_id: "s1", detail: { reason: "test" },
    }));
  });

  it("never throws when the write fails (best-effort)", async () => {
    insertMock.mockResolvedValue({ error: new Error("boom") });
    await expect(logAudit({ action: "expense.void", entityType: "expenses" })).resolves.toBeUndefined();
  });

  it("never throws when auth lookup fails", async () => {
    getUserMock.mockRejectedValue(new Error("no session"));
    await expect(logAudit({ action: "cheque.void", entityType: "cheques" })).resolves.toBeUndefined();
  });

  it("defaults entityId/detail to null when omitted", async () => {
    await logAudit({ action: "product.delete", entityType: "products" });
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ entity_id: null, detail: null }));
  });
});
