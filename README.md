# Campus Stores · Product Engineering Practical

**Live Application:** [sai-vivek17.github.io/campus-stores](https://sai-vivek17.github.io/campus-stores/)  
**Repository:** [github.com/Sai-Vivek17/campus-stores](https://github.com/Sai-Vivek17/campus-stores)  

---

## 1. Context & The Core Decision

Campus Stores is an operational counter tool for a university media equipment desk across three shifts: Friday pickup, Friday evening return, and Saturday morning check-in.

I focused on **one core decision: closing the Shift Handover and Custody Gap.**

In campus equipment operations, gear is frequently split: during Shift 2 (Friday 7:30 pm), Kabir Sen returns the projector and speaker from `RQ-214`, but Leela Das keeps the HDMI adapter (`AD-12`) for an event next morning. The original application provided no mechanism to transfer custody of an individual slip, no way to flag that an item was held past the approved booking window, and no consolidated shift handover queue. The incoming Saturday morning clerk had to cross-reference disconnected slips and desk notes to understand who held what and why.

---

## 2. What Worked Well in the Original Application

The original application had solid domain guardrails. Specifically:

> **Evidence:** `PR-06` (in repair in Workshop) is filtered out in `registerPage()` and can never be selected or issued from the issue form.

The system also maintains single-unit serial slips (`L-401`, `L-402`), physical shelf coordinates (`A2`, `B1`, `C4`), and a lightweight offline-first architecture with predictable `localStorage` persistence. I preserved these foundational choices entirely.

---

## 3. The Prototype: Shift Handover & Supporting Upgrades

I introduced a dedicated **Shift Handover** workflow and three supporting mechanisms:

1. **Shift Handover Overview & Urgency Queue:**
   - Summarizes counter readiness (Outstanding Loans, Due Now, Overdue, Items in Repair/Quarantine).
   - An urgency-ranked queue sorts items strictly by operational urgency: `Overdue` → `Due now` → `Due soon` → `Upcoming`.
   - At Saturday 9:00 am, `AD-12` (due Sat 9 am) is correctly ranked `Due now` and surfaces as the top card over `MI-09` (due Sat 10 am, `Due soon`).
   - A direct `[Check in item]` action on each card allows immediate return processing without jumping across tabs.

2. **Contextual Custody Transfer:**
   - Lets the desk clerk transfer an active slip to a new student with reason notes and an updated due time.
   - Preserves original borrower (`who`), updates `currentCustodian`, appends an immutable audit event to `custodyHistory`, and writes a note to the Desk Book.
   - **Past Approved Return Flag:** If a transfer pushes return time past the request's approved return date (e.g., `RQ-214` approved until Fri 8 pm, pushed to Sat 9 am), a `Past approved return (Fri 8 pm)` warning tag is flagged on both the slip and handover card.

3. **Deterministic Due Time Calculations:**
   - Replaced fragile string/phase heuristics with centralized timestamps for shifts and due times.
   - Statuses (`Upcoming`, `Due soon`, `Due now`, `Overdue`) are derived mathematically from current simulated clock timestamps.

4. **Equipment Condition Check-In:**
   - Return modal captures physical condition (`Good` → back on shelf; `Needs inspection` → quarantined; `Damaged` → Workshop).
   - Captures the actual returning person, recording a custody mismatch discrepancy if someone other than the active custodian returns the unit.

---

## 4. What I Would Measure at a Real Counter

Rather than relying on unverified estimates, the single metric I would measure at a physical campus desk is:

> **Counter Transaction Duration during Shift Changeover:** The elapsed time (in seconds) from a student stepping up to the desk to complete a morning drop-off (identifying borrower, verifying serial number, checking condition, and updating custody/stock) between 8:50 am and 9:15 am.

If the handover queue successfully provides incoming clerks with immediate context, this duration should decrease and eliminate unrecorded custody handoffs.

---

## 5. Verification & Automated Test Suite

An automated test suite (`test-suite.js`) validates all business logic and edge cases in pure Node.js with zero dependencies:

- **17 Unit Tests:** Covers timestamp calculation, urgency queue ordering, repair exclusions, custody audit trail, return condition routing, discrepancy logging, and state migrations.
- **1 End-to-End Test:** Reconciles the complete 3-shift journey from Friday pickup to Friday partial return & custody transfer to Saturday morning handover and return.

Run tests:
```bash
npm test
```
All 18 tests pass with zero failures.
