# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

This repository is newly created and contains only `README.md` and this file. There is no build system, package manifest, test suite, or linter yet. Do not invent commands; when tooling is added, record the real commands here.

## Intended purpose and layout

Per the README, the repository is a workspace for supply chain planning and analysis: demand forecasting, inventory and replenishment, supplier and logistics tracking, and management reporting.

The agreed folder layout (create folders only as they become needed):

- `data/` raw and processed inputs
- `notebooks/` exploratory analysis and one-off studies
- `src/` reusable scripts and modules
- `reports/` generated outputs such as decks, workbooks, dashboards
- `docs/` process notes, definitions, and the data dictionary

## Repository rules from the README

- Never commit raw data with customer, supplier, or pricing information unless it has been cleared for this repository.
- Keep files over 10 MB out of git; reference their shared-drive location in `docs/` instead.
- Every dataset must be documented in `docs/data-dictionary.md` with source, owner, refresh cadence, and column definitions.
- Branch names: `feature/...`, `fix/...`, `docs/...`.
- File names: lowercase with hyphens, dated where relevant, e.g. `uae-stock-cover-2026-09.xlsx`.

## Git notes

- The first branch pushed to this repository, `claude/readme-file-setup-mbt3vc`, is currently the default branch because no `main` existed. Check the default branch on GitHub before opening pull requests.
