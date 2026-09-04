# OMS Order Tracker: plan

Working platform: `src/oms/index.html` (published as a Claude artifact with shared storage).
All data is country wise, brand wise, FG code wise.

## Sheets and owners

| # | Sheet | Owner | Input | Output |
|---|-------|-------|-------|--------|
| 1 | Order Tracker | Logistics | Distributor orders as they arrive (Excel upload or manual entry). Reserved qty, supplied qty, supplied date, invoice ref. | Order placed date and supplied date per order |
| 2 | Order Summary | Planning | Computed. Reads tracker, FG stock, country priority, production plan, RMPM sheet. | Pending to produce per country / brand / FG, planned quantity, gap, owner of next step. Shared with Production and all stakeholders |
| 3 | Production and RMPM | Production, RM planner (Saurav Nagrale), PM planner (Maslekar Purushottam Parth) | Production planned and produced per FG code (FG code, description, production planned, produced). RM or PM shortages by material (material code, description, type, shortage qty, UOM, ETA), not linked to FG code. | Planned and produced quantities back to Planning; connectivity date per shortage |

## Allocation algorithm

1. Country priority (1, 2, 3), allowed storage locations and the ageing norm (maximum inventory age in days) come from the priority and norms sheet.
2. Open qty per order = order qty minus supplied qty.
3. Stock still reserved = tracker reserved qty minus supplied qty (reserved is cumulative).
4. FG stock is held as lots (FG code, storage location, batch, quantity, manufacturing date). Batch and location are shared by the FG Planner, Arun Muthian. Age is stock date minus manufacturing date, or the Age Days column when supplied.
5. A lot is eligible for a country only if it sits in one of that country's allowed locations (blank = any) and its age is within the country's maximum (blank = any).
6. Reservations already made by logistics consume eligible lots first. Then remaining eligible stock is allocated to open orders in priority order, then order date, taking the oldest eligible lot first so older inventory goes to the countries whose norms accept it.
7. Pending to produce = open qty minus reserved. If stock exists but is outside the country's location or age norm, the order shows that quantity as ineligible.
8. Quantity still to come from production (production planned minus produced) covers pending qty in the same priority order. Gap = pending minus that remainder. Produced goods reach the dashboard as FG stock through the stock upload, so they are not counted twice.
9. Order status: Supplied, Reserved ready, Production planned or In production, Partly planned, FG short on RMPM (driven by the FG shortage list from supply, since the RMPM sheet is material level), Not planned.
10. Next step: supplied date, or "ready to dispatch", or planned and produced quantities, or "after" the latest procurement ETA. An order reads "In production" when produced is above zero but below planned.

## Dashboard

- Filters: order month, country, brand, FG code. Dropdowns cascade from the data.
- KPIs: pending to produce (hero), ordered, supplied, FG available, planned in production, blocked by RMPM, average order to supply days.
- Charts: ordered vs supplied vs pending by month; pending by country sorted by priority.
- Tables: country / brand / FG position with coverage bar; order to supply timeline with placed date, supplied date and days.

## Inputs required from the supply end

Required: FG stock on hand by batch and storage location from the FG Planner Arun Muthian (daily), country priority and norms (allowed locations, max age), FG shortage list (weekly; this is what flags an order as short on RMPM), production plan as production planned and produced per FG (weekly and on change), RM and PM shortage list, procurement ETA per material, supply confirmation per order.

Recommended: FG master, production lead time per FG, bill of materials, in-transit plan, batch and expiry, sales forecast.

Blank column templates are in `docs/templates/`. Column headers are matched loosely on upload, so existing files with similar headings work without renaming.

## Access

The published artifact stores data with a rule that only people it is shared with as "Can edit" (and the owner) can write. Everyone shared as "Can view" gets a view-only page: forms, uploads and delete buttons are hidden, cells are locked, and the store refuses writes regardless. The page checks access on open with a probe write and shows "View only" or "you can edit" in the left rail.

## Storage

The published artifact keeps all sheets in a shared store, so every signed-in viewer in the organisation sees the same data live. Uploads replace a sheet, except the order tracker, which upserts by order number and FG code and keeps existing reserved and supplied values when the upload leaves them blank. Last writer wins, so teams should upload their own sheet only.
