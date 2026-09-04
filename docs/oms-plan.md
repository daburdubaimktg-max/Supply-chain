# OMS Order Tracker: plan

Working platform: `src/oms/index.html` (published as a Claude artifact with shared storage).
All data is country wise, brand wise, FG code wise.

## Sheets and owners

| # | Sheet | Owner | Input | Output |
|---|-------|-------|-------|--------|
| 1 | Order Tracker | Logistics | Distributor orders as they arrive (Excel upload or manual entry). Reserved qty, supplied qty, supplied date, invoice ref. | Order placed date and supplied date per order |
| 2 | Order Summary | Planning | Computed. Reads tracker, FG stock, country priority, production plan, RMPM sheet. | Pending to produce per country / brand / FG, planned quantity, gap, owner of next step. Shared with Production and all stakeholders |
| 4 | Liquidation | FG Planner (Arun Muthian) | FG SLOB file in cases: FG code, description, Stoc Loc, batch, manuf and expiry date, SLOB qty, category, remarks. | Age and remaining life per lot, and the countries whose norms accept the lot with their open pending qty, so liquidation is planned against real demand. |
| 3 | Production and RMPM | Production, RM planner (Saurav Nagrale), PM planner (Maslekar Purushottam Parth) | Production planned and produced per FG code (FG code, description, production planned, produced). RM or PM shortages by material (material code, description, type, shortage qty, UOM, ETA), not linked to FG code. | Planned and produced quantities back to Planning; connectivity date per shortage |

## Allocation algorithm

1. Country priority (1, 2, 3), allowed storage locations and the ageing norm (maximum inventory age in days) come from the priority and norms sheet.
2. Open qty per order = order qty minus supplied qty.
3. Stock still reserved = tracker reserved qty minus supplied qty (reserved is cumulative).
4. FG stock comes from the FG ageing file shared by the FG Planner, Arun Muthian: FG Code, FG Description, Stoc Loc, Stoc Loc Description, Manuf Date, Expiry Date, Ageing Remarks, plus Batch and Available Qty per line. Age is today minus manufacturing date; remaining shelf life is expiry minus today.
5. A lot is eligible for a country only if it sits in one of that country's allowed locations (Stoc Loc code or description; blank = any), its age is within the country's maximum age (blank = any), and its remaining shelf life meets the country's minimum (blank = any).
6. Reservations already made by logistics consume eligible lots first. Then remaining eligible stock is allocated to open orders in priority order, then order date, taking the oldest eligible lot first so older inventory goes to the countries whose norms accept it.
7. Pending to produce = open qty minus reserved. If stock exists but is outside the country's location or age norm, the order shows that quantity as ineligible.
8. Quantity still to come from production (production planned minus produced) covers pending qty in the same priority order. Gap = pending minus that remainder. Produced goods reach the dashboard as FG stock through the stock upload, so they are not counted twice.
9. Order status: Supplied, Reserved ready, Production planned or In production, Partly planned, FG short on RMPM (driven by the FG shortage list from supply, since the RMPM sheet is material level), Not planned.
10. Next step: supplied date, or "ready to dispatch", or planned and produced quantities, or "after" the latest procurement ETA. An order reads "In production" when produced is above zero but below planned.

## Supply Chain Inputs tab

Every file is uploaded from one tab. Each card shows the file name, its owner, the expected columns, refresh cadence and the last upload. Owner names are stored in an admin-only area of the shared store and can be changed only by the page owner (admin); editors and viewers see them as text.

Sheets: Order Tracker, Production Plan, RM/PM Shortages, FG Ageing File, FG SLOB File, Country Priority & Norms, FG Shortage List, FG Master, Bill of Materials, In-Transit Plan, Sales Forecast.

- FG Master fills brand and description from the FG code on orders, plans and SLOB lines.
- Bill of Materials links the material-level RMPM sheet back to FG codes, so an open material shortage marks the orders it blocks, with the material ETA. A short FG takes precedence over a production plan, because the plan cannot run without materials.
- In-Transit Plan adds dispatch date, mode and arrival ETA to the order timeline.
- Sales Forecast feeds the forecast vs orders table on the dashboard, by country, brand, FG code and month, with ordered minus forecast, ordered as a percentage of forecast, and a read of Under, On or Over forecast (80 to 120 percent band).

## Branding

The Dabur logo is embedded in the page (source: `src/oms/assets/dabur-logo.svg`, the public SVG of the corporate mark) and shown in the left rail and beside the title of every view. On the Supply Chain Inputs tab the admin can replace it with an official artwork file (SVG, PNG, JPG or WebP under 200 KB), which is stored in the admin-only area of the shared store and shown to everyone; a Default logo button restores the built-in mark.

## Values

Logistics adds an ACR column (average case rate, USD per case) to the order tracker. The platform calculates order value (qty x ACR), dispatch value (supplied x ACR) and balance value ((qty - supplied) x ACR) per order, with totals, and shows them in the order summary too. All values are entered in USD and displayed in AED by default at a USD to AED rate the admin can set on the Supply Chain Inputs tab (3.6725 to start); a toggle in the filter bar switches the display to USD. The dashboard has value tiles (order, dispatched, balance, average ACR) and a Country vs Value chart. The SLOB sheet accepts an optional Case Rate (USD) and shows SLOB value; when the rate is blank the average ACR for that FG from the order tracker is used.

## Dashboard

- Filters: order month, country, brand, FG code. Dropdowns cascade from the data.
- KPIs: pending to produce (hero), ordered, supplied, FG available, planned in production, blocked by RMPM, average order to supply days.
- Charts: ordered vs supplied vs pending by month; pending by country sorted by priority.
- Tables: country / brand / FG position with coverage bar; order to supply timeline with placed date, supplied date and days.

## Inputs required from the supply end

Required: FG ageing file from the FG Planner Arun Muthian (daily), FG SLOB file in cases from the same owner (weekly), country priority and norms (allowed locations, max age, min shelf life), FG shortage list (weekly; this is what flags an order as short on RMPM), production plan as production planned and produced per FG (weekly and on change), RM and PM shortage list, procurement ETA per material, supply confirmation per order.

Recommended: FG master, production lead time per FG, bill of materials, in-transit plan, batch and expiry, sales forecast.

Blank column templates are in `docs/templates/`. Column headers are matched loosely on upload, so existing files with similar headings work without renaming.

## Access

The published artifact stores data with a rule that only people it is shared with as "Can edit" (and the owner) can write. Everyone shared as "Can view" gets a view-only page: forms, uploads and delete buttons are hidden, cells are locked, and the store refuses writes regardless. The page checks access on open with a probe write and shows "View only" or "you can edit" in the left rail.

## Storage

The published artifact keeps all sheets in a shared store, so every signed-in viewer in the organisation sees the same data live. Uploads replace a sheet, except the order tracker, which upserts by order number and FG code and keeps existing reserved and supplied values when the upload leaves them blank. Last writer wins, so teams should upload their own sheet only.
