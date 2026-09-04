# OMS Order Tracker: plan

Working platform: `src/oms/index.html` (published as a Claude artifact with shared storage).
All data is country wise, brand wise, FG code wise.

## Sheets and owners

| # | Sheet | Owner | Input | Output |
|---|-------|-------|-------|--------|
| 1 | Order Tracker | Logistics | Distributor orders as they arrive (Excel upload or manual entry). Reserved qty, supplied qty, supplied date, invoice ref. | Order placed date and supplied date per order |
| 2 | Order Summary | Planning | Computed. Reads tracker, FG stock, country priority, production plan, RMPM sheet. | Pending to produce per country / brand / FG, timeline, owner of next step. Shared with Production and all stakeholders |
| 3 | Production and RMPM | Production, RM planner (Saurav Nagrale), PM planner (Maslekar Purushottam Parth) | Production plan with start and finish. RM or PM shortages with short qty. Procurement ETA per material. | Production timeline back to Planning; connectivity date per shortage |

## Allocation algorithm

1. Country priority (1, 2, 3) comes from the priority list uploaded by supply.
2. Open qty per order = order qty minus supplied qty.
3. Stock still reserved = tracker reserved qty minus supplied qty (reserved is cumulative).
4. Remaining free FG stock is allocated to open orders in priority order, then order date.
5. Pending to produce = open qty minus reserved.
6. Planned production per FG covers pending qty in the same priority order. Gap = pending minus planned.
7. Order status: Supplied, Reserved ready, Production planned or In production, Partly planned, RMPM shortage (with ETA or awaiting ETA), Not planned.
8. Expected date: supplied date, or "ready to dispatch", or production finish date, or "after" the latest procurement ETA.

## Dashboard

- Filters: order month, country, brand, FG code. Dropdowns cascade from the data.
- KPIs: pending to produce (hero), ordered, supplied, FG available, planned in production, blocked by RMPM, average order to supply days.
- Charts: ordered vs supplied vs pending by month; pending by country sorted by priority.
- Tables: country / brand / FG position with coverage bar; order to supply timeline with placed date, supplied date and days.

## Inputs required from the supply end

Required: FG stock on hand (daily), country priority list, FG shortage list (weekly), production plan (weekly and on change), RM and PM shortage list, procurement ETA per material, supply confirmation per order.

Recommended: FG master, production lead time per FG, bill of materials, in-transit plan, batch and expiry, sales forecast.

Blank column templates are in `docs/templates/`. Column headers are matched loosely on upload, so existing files with similar headings work without renaming.

## Storage

The published artifact keeps all sheets in a shared store, so every signed-in viewer in the organisation sees the same data live. Uploads replace a sheet, except the order tracker, which upserts by order number and FG code and keeps existing reserved and supplied values when the upload leaves them blank. Last writer wins, so teams should upload their own sheet only.
