/**
 * DAY-REPORT TEMPLATES — the report has two stable layouts (see the fixtures).
 * Columns are matched to ROLES by anchoring on the two columns we can identify
 * without reading labels: the NAME column (reliably the widest) and the CODE
 * column (rightmost, 8-digit). Numeric roles are then filled outward from those
 * anchors in the template's known order, so a missed thin left-edge column
 * (returns/discount) never shifts the load-bearing code/name/price/qty/net cells.
 *
 * Column order is given LEFT→RIGHT as it appears in pixel space (the report is
 * RTL, so the code is the rightmost column).
 */
import type { GridColumn, ReceiptType } from "@/features/local-ocr/types/local-ocr";

export type ColRole =
  | "netValue" | "netQty" | "qtySold" | "unitPrice" | "salesValue"
  | "returnQty" | "returnValue" | "discount" | "name" | "barcode" | "code";

export interface DayReportTemplate {
  id: ReceiptType;
  hasBarcode: boolean;
  /** roles LEFT→RIGHT, ending at `code` (rightmost). */
  order: ColRole[];
}

export const TEMPLATE_V2025: DayReportTemplate = {
  id: "bosta_day_report_v2025",
  hasBarcode: true,
  order: ["netValue", "netQty", "returnValue", "returnQty", "salesValue", "qtySold", "unitPrice", "name", "barcode", "code"],
};

export const TEMPLATE_V2024: DayReportTemplate = {
  id: "bosta_day_report_v2024",
  hasBarcode: false,
  order: ["netValue", "returnValue", "discount", "salesValue", "returnQty", "netQty", "qtySold", "unitPrice", "name", "code"],
};

/** Index of the widest column (the Arabic product-name column). */
export function widestColumnIndex(columns: GridColumn[]): number {
  let best = 0;
  for (let i = 1; i < columns.length; i++) if (columns[i].width > columns[best].width) best = i;
  return best;
}

export type RoleMap = Partial<Record<ColRole, number>>; // role → column index

/**
 * Assign roles to columns. `nameIdx` and `codeIdx` are the two anchors; the
 * template's roles left of `name` are right-aligned up to `name`, and roles
 * right of `name` (barcode?, code) are filled toward `codeIdx`. Roles that fall
 * off the detected column set are simply left unmapped (the field stays blank).
 */
export function assignRoles(template: DayReportTemplate, nameIdx: number, codeIdx: number): RoleMap {
  const map: RoleMap = { name: nameIdx, code: codeIdx };
  const nameRolePos = template.order.indexOf("name");
  const leftRoles = template.order.slice(0, nameRolePos);        // netValue … unitPrice
  const rightRoles = template.order.slice(nameRolePos + 1, template.order.length - 1); // barcode? (before code)

  // Left of name: anchor unitPrice immediately left of name and walk leftward.
  for (let r = leftRoles.length - 1, col = nameIdx - 1; r >= 0 && col >= 0; r--, col--) {
    map[leftRoles[r]] = col;
  }
  // Right of name up to (not incl.) code: barcode variant only.
  for (let r = 0, col = nameIdx + 1; r < rightRoles.length && col < codeIdx; r++, col++) {
    map[rightRoles[r]] = col;
  }
  return map;
}

/** Pick the template from whether a barcode column sits between name and code. */
export function chooseTemplate(hasBarcodeColumn: boolean): DayReportTemplate {
  return hasBarcodeColumn ? TEMPLATE_V2025 : TEMPLATE_V2024;
}
