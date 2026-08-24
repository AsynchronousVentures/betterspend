# Budget enforcement

Status: accepted for implementation
Covers: #116, #117

## Goal

Budget checks should make one policy decision at requisition submission and PO issuance. Callers should not need to know how org defaults, budget overrides, pending commitments, or budget owners are resolved.

## Scope

This first slice enforces department budgets. It adds:

- org defaults and per-budget overrides for `hard_stop`, `owner_approval`, and `visibility_only`
- org defaults and per-budget overrides for counting submitted and pending requisitions
- a budget-owner approval appended after any normal approval rule
- the same check when a linked PO is issued
- structured decision details for callers, audit entries, and future UI surfaces

Project and GL-account scope resolution, durable encumbrance records, release and reversal events, and requester-facing budget UI remain in #118 and #119.

## Module interface

`BudgetsService.evaluateEnforcement` is the seam used by requisitions and purchase orders. It accepts the organization, department, amount, currency, fiscal year, and an optional requisition to exclude. It returns one of three actions:

- `allow`: no matching budget, enough available budget, or a visibility-only overrun
- `block`: hard-stop overrun, or owner approval without a valid budget owner
- `require_approval`: owner approval is configured and a valid owner was resolved

The module hides policy inheritance, currency conversion, committed requisition totals, owner validation, overrun math, and user-facing messages.

## Policy inheritance

Org settings provide defaults:

- `budget_enforcement_mode`, default `hard_stop` to preserve current behavior
- `budget_pending_requisition_policy`, default `approved_only`

Each budget can override either setting. A null budget value inherits the org setting.

`approved_only` counts approved and converted requisitions. `include_pending` also counts submitted and pending-approval requisitions. The requisition being converted into the PO under evaluation is excluded so the same commitment is not counted twice during that transition.

## Owner approval

Department `budgetOwnerId` remains the owner source. The user must belong to the same organization and be active. If no valid owner exists, owner-approval mode fails closed with a configuration message.

The approval engine stores one optional required approver on an approval request. If a normal rule matches, the required owner becomes the final step. If no rule matches, the owner is the only step. Only that owner may act at the required step.

For a PO, the first issue attempt moves the draft to `pending_approval`. After final approval changes it to `approved`, a second issue attempt performs the budget check again and issues the PO.

## Money and commitments

All comparisons use the organization's base currency. The current request and grouped pending requisitions are converted through the existing exchange-rate module. Budget base totals and base spend are used when present.

Until #118 adds an event-backed encumbrance ledger, converted requisitions are the best available commitment signal. #118 will replace this read-time approximation without changing the enforcement interface.

## Failure behavior

Hard stops return the budget name, available amount before the request, requested amount, and projected overrun. Visibility-only overruns proceed but return the same structured decision and are audit logged. Owner-approval mode never falls back to visibility-only when its owner is missing.
