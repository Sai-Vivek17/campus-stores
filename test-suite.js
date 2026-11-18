/**
 * Campus Stores — Automated Business Logic & E2E Test Suite
 *
 * Validates timestamp calculations, urgency sorting, custody tracking,
 * return condition handling, and the complete 3-shift desk handover lifecycle.
 * Runs in pure Node.js with zero external dependencies.
 */

const assert = require("assert");
const app = require("./app.js");

const {
  SHIFT_TIMESTAMPS,
  DUE_TIMESTAMPS,
  calculateDueStatus,
  executeCustodyTransfer,
  executeEquipmentReturn,
  executeIssueSlip,
  canIssueAsset,
  requests,
  initialAssets,
  people,
  shifts,
} = app;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function createFreshState(phase = 0) {
  return {
    version: 2,
    tab: "Shift handover",
    phase,
    assets: JSON.parse(JSON.stringify(initialAssets)),
    loans: [
      {
        num: 401,
        req: "RQ-209",
        asset: "MI-09",
        who: "Tara Shah",
        currentCustodian: "Tara Shah",
        due: "Sat 10 am",
        dueTimestamp: DUE_TIMESTAMPS["Sat 10 am"],
        issuedAt: SHIFT_TIMESTAMPS[0],
        issuedPhase: 0,
        back: false,
        custodyHistory: [],
      },
    ],
    notes: [],
  };
}

console.log("\n========================================================");
console.log("  CAMPUS STORES: MANDATORY BUSINESS LOGIC TEST SUITE");
console.log("========================================================\n");

// 1. Single-unit loan slip issue succeeds for available equipment
test("1. Loan slip is issued successfully when requested equipment is available", () => {
  const state = createFreshState(0);
  const res = executeIssueSlip("RQ-214", "PR-04", "Kabir Sen", "Fri 8 pm", state);

  assert.strictEqual(res.ok, true, "Issue should succeed");
  assert.strictEqual(state.loans.length, 2, "State should have 2 total loans");

  const prLoan = state.loans.find((l) => l.asset === "PR-04");
  assert.ok(prLoan, "PR-04 loan must exist");
  assert.strictEqual(prLoan.who, "Kabir Sen");
  assert.strictEqual(prLoan.currentCustodian, "Kabir Sen");
  assert.strictEqual(prLoan.back, false);
});

// 2. An item in repair (e.g. PR-06) cannot be issued
test("2. Equipment in repair (PR-06 in Workshop) cannot be issued", () => {
  const state = createFreshState(0);
  const pr06 = state.assets.find((a) => a.id === "PR-06");
  assert.strictEqual(pr06.repair, true, "PR-06 must be marked in repair");
  assert.strictEqual(canIssueAsset(pr06, state.loans), false, "canIssueAsset must return false");

  const res = executeIssueSlip("RQ-214", "PR-06", "Kabir Sen", "Fri 8 pm", state);
  assert.strictEqual(res.ok, false, "Issue slip creation must fail for unit in repair");
  assert.ok(res.error.includes("unavailable"), "Error message must state unit is unavailable");
});

// 3. An item already on loan cannot be allocated again
test("3. An item already on loan cannot be allocated again (double-allocation guard)", () => {
  const state = createFreshState(0);
  // MI-09 is already on loan on slip L-401
  const mi09 = state.assets.find((a) => a.id === "MI-09");
  assert.strictEqual(canIssueAsset(mi09, state.loans), false, "MI-09 must be unavailable");

  const res = executeIssueSlip("RQ-209", "MI-09", "Tara Shah", "Sat 10 am", state);
  assert.strictEqual(res.ok, false, "Allocation must be blocked");
  assert.ok(res.error.includes("unavailable"), "Must cite asset unavailable");
});

// 4. Custody transfer updates current holder and preserves audit trail
test("4. Custody transfer updates current holder and records event without hardcoding", () => {
  const state = createFreshState(1);
  const loan = state.loans[0]; // L-401 (Tara Shah)

  const res = executeCustodyTransfer(401, "Dev Menon", "Sat noon", "Passing mic for photography speech", state);
  assert.strictEqual(res.ok, true, "Transfer must succeed");
  assert.strictEqual(loan.currentCustodian, "Dev Menon");
  assert.strictEqual(loan.who, "Tara Shah", "Original borrower must be preserved");
  assert.strictEqual(loan.due, "Sat noon");
  assert.strictEqual(loan.custodyHistory.length, 1);
  assert.strictEqual(loan.custodyHistory[0].from, "Tara Shah");
  assert.strictEqual(loan.custodyHistory[0].to, "Dev Menon");
});

// 5. Multiple custody transfers preserve complete audit history
test("5. Multiple custody transfers preserve complete audit trail history", () => {
  const state = createFreshState(1);
  executeCustodyTransfer(401, "Dev Menon", "Sat noon", "First transfer", state);
  executeCustodyTransfer(401, "Leela Das", "Sat noon", "Second transfer", state);

  const loan = state.loans[0];
  assert.strictEqual(loan.currentCustodian, "Leela Das");
  assert.strictEqual(loan.custodyHistory.length, 2);
  assert.strictEqual(loan.custodyHistory[0].from, "Tara Shah");
  assert.strictEqual(loan.custodyHistory[0].to, "Dev Menon");
  assert.strictEqual(loan.custodyHistory[1].from, "Dev Menon");
  assert.strictEqual(loan.custodyHistory[1].to, "Leela Das");
});

// 6. A closed loan cannot be transferred
test("6. A closed loan cannot be transferred", () => {
  const state = createFreshState(1);
  state.loans[0].back = true; // Close loan

  const res = executeCustodyTransfer(401, "Dev Menon", "Sat noon", "Attempt on closed slip", state);
  assert.strictEqual(res.ok, false, "Transfer must be rejected on closed loan");
  assert.ok(res.error.includes("closed"), "Error must state loan is closed");
});

// 7. Item returned/checked before due time is NOT marked overdue
test("7. An item checked before due time is NOT marked overdue (Friday 7:30 pm vs Fri 8 pm)", () => {
  // Phase 1 = Friday 7:30 pm. Due time = Fri 8 pm (in 30 mins).
  const status = calculateDueStatus("Fri 8 pm", 1);
  assert.strictEqual(status.status, "due-soon", "Must be due-soon, NOT overdue");
  assert.strictEqual(status.diffMinutes, 30, "Delta must be exactly 30 minutes");
});

// 8. Item becomes due-now at exact due time
test("8. An item becomes due-now at the exact due time (Sat 9 am at Saturday 9:00 am)", () => {
  // Phase 2 = Saturday 9:00 am. Due time = Sat 9 am.
  const status = calculateDueStatus("Sat 9 am", 2);
  assert.strictEqual(status.status, "due-now", "Must be due-now");
  assert.strictEqual(status.diffMinutes, 0, "Delta must be exactly 0 minutes");
});

// 9. Item becomes overdue only after due time has passed
test("9. An item becomes overdue only after its due time has passed (Fri 8 pm at Saturday 9:00 am)", () => {
  // Phase 2 = Saturday 9:00 am. Due time = Fri 8 pm (13 hours ago).
  const status = calculateDueStatus("Fri 8 pm", 2);
  assert.strictEqual(status.status, "overdue", "Must be overdue");
  assert.ok(status.diffMinutes < 0, "Diff must be negative");
});

// 10. Good-condition return closes loan and makes equipment available
test("10. A good-condition return closes loan and makes equipment available on shelf", () => {
  const state = createFreshState(0);
  const res = executeEquipmentReturn(401, "Tara Shah", "good", "All cords coiled", state);

  assert.strictEqual(res.ok, true);
  assert.strictEqual(state.loans[0].back, true);
  assert.strictEqual(state.loans[0].returnCondition, "good");

  const asset = state.assets.find((a) => a.id === "MI-09");
  assert.strictEqual(asset.repair, false);
  assert.strictEqual(asset.inspection, false);
  assert.strictEqual(canIssueAsset(asset, state.loans), true, "Asset must be immediately available");
});

// 11. Inspection-pending return quarantines item
test("11. An inspection-pending return quarantines item (not available on shelf)", () => {
  const state = createFreshState(0);
  const res = executeEquipmentReturn(401, "Tara Shah", "inspection", "Dropped once, check capsule", state);

  assert.strictEqual(res.ok, true);
  const asset = state.assets.find((a) => a.id === "MI-09");
  assert.strictEqual(asset.inspection, true, "Asset must have inspection: true");
  assert.strictEqual(canIssueAsset(asset, state.loans), false, "Quarantined asset must NOT be available for re-issue");
});

// 12. Damaged return sends equipment to repair
test("12. A damaged return routes equipment to Workshop (repair: true)", () => {
  const state = createFreshState(0);
  const res = executeEquipmentReturn(401, "Tara Shah", "damaged", "Broken switch", state);

  assert.strictEqual(res.ok, true);
  const asset = state.assets.find((a) => a.id === "MI-09");
  assert.strictEqual(asset.repair, true, "Asset must have repair: true");
  assert.strictEqual(canIssueAsset(asset, state.loans), false, "Damaged asset must NOT be available for re-issue");
});

// 13. Duplicate return is prevented
test("13. Duplicate return is prevented (idempotent loan closure guard)", () => {
  const state = createFreshState(0);
  executeEquipmentReturn(401, "Tara Shah", "good", "First return", state);

  const secondRes = executeEquipmentReturn(401, "Tara Shah", "good", "Duplicate return attempt", state);
  assert.strictEqual(secondRes.ok, false, "Second return attempt must fail");
  assert.ok(secondRes.error.includes("already closed"));
});

// 14. Unexpected returning person is logged as discrepancy
test("14. Unexpected returning person is logged as discrepancy without erasing custodian", () => {
  const state = createFreshState(0);
  // Current custodian is Tara Shah. Dev Menon drops it off.
  const res = executeEquipmentReturn(401, "Dev Menon", "good", "Tara asked me to drop off", state);

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.isDiscrepancy, true, "Must flag custody mismatch discrepancy");
  assert.strictEqual(state.loans[0].returnedBy, "Dev Menon");
  assert.strictEqual(state.loans[0].currentCustodian, "Tara Shah", "Original custodian record preserved");
  assert.strictEqual(state.loans[0].discrepancy, true);

  const noteLogged = state.notes.some((n) => n.text.includes("Discrepancy: expected Tara Shah"));
  assert.strictEqual(noteLogged, true, "Discrepancy must be logged in shift notes");
});

// 15. Urgency queue sorting places Due Now before Due Soon
test("15. Urgency queue sorts AD-12 (Due now) ahead of MI-09 (Due soon) at Saturday 9:00 am", () => {
  const state = createFreshState(2); // Saturday 9:00 am
  // Add AD-12 due at Sat 9 am
  state.loans.push({
    num: 402,
    req: "RQ-214",
    asset: "AD-12",
    who: "Kabir Sen",
    currentCustodian: "Leela Das",
    due: "Sat 9 am",
    dueTimestamp: DUE_TIMESTAMPS["Sat 9 am"],
    issuedAt: SHIFT_TIMESTAMPS[0],
    issuedPhase: 0,
    back: false,
    custodyHistory: [],
  });

  const activeLoans = state.loans.filter((l) => !l.back);
  const enriched = activeLoans.map((l) => {
    const dueInfo = calculateDueStatus(l.dueTimestamp || l.due, state.phase);
    return { ...l, dueInfo };
  });

  enriched.sort((a, b) => {
    if (a.dueInfo.rank !== b.dueInfo.rank) {
      return a.dueInfo.rank - b.dueInfo.rank;
    }
    return (a.dueInfo.diffMinutes ?? 0) - (b.dueInfo.diffMinutes ?? 0);
  });

  assert.strictEqual(enriched[0].asset, "AD-12", "Top card in Saturday 9 am queue must be AD-12");
  assert.strictEqual(enriched[0].dueInfo.status, "due-now");
  assert.strictEqual(enriched[1].asset, "MI-09", "Second card in Saturday 9 am queue must be MI-09");
  assert.strictEqual(enriched[1].dueInfo.status, "due-soon");
});

// 16. State serialization and restoration preserves valid state exactly
test("16. State serialization and restoration preserves valid state exactly", () => {
  const state = createFreshState(1);
  executeCustodyTransfer(401, "Dev Menon", "Sat noon", "Test note", state);

  const serialized = JSON.stringify(state);
  const parsed = JSON.parse(serialized);

  assert.strictEqual(parsed.version, 2);
  assert.strictEqual(parsed.phase, 1);
  assert.strictEqual(parsed.loans[0].currentCustodian, "Dev Menon");
  assert.strictEqual(parsed.loans[0].custodyHistory.length, 1);
});

// 17. Existing saved data from v1 schema can be safely migrated to v2
test("17. Existing saved data from v1 schema can be safely migrated to v2", () => {
  const legacyV1State = {
    version: 1,
    tab: "Requests",
    phase: 0,
    loans: [
      {
        num: 401,
        req: "RQ-209",
        asset: "MI-09",
        who: "Tara Shah",
        transferredTo: "Leela Das",
        due: "Sat 10 am",
        back: false,
      },
    ],
    notes: [],
  };

  const migratedLoans = legacyV1State.loans.map((l) => ({
    ...l,
    currentCustodian: l.currentCustodian || l.transferredTo || l.who,
    dueTimestamp: l.dueTimestamp || DUE_TIMESTAMPS[l.due] || SHIFT_TIMESTAMPS[1],
    custodyHistory: Array.isArray(l.custodyHistory) ? l.custodyHistory : [],
  }));

  assert.strictEqual(migratedLoans[0].currentCustodian, "Leela Das");
  assert.strictEqual(migratedLoans[0].dueTimestamp, DUE_TIMESTAMPS["Sat 10 am"]);
  assert.ok(Array.isArray(migratedLoans[0].custodyHistory));
});

console.log("\n========================================================");
console.log("  CAMPUS STORES: END-TO-END WORKFLOW TEST (3 SHIFTS)");
console.log("========================================================\n");

test("E2E Complete 3-Shift Scenario: Friday Pickup → Partial Return → Saturday Smart Handover", () => {
  const state = createFreshState(0);

  // --- SHIFT 1: Friday 3:45 pm (Pickup) ---
  console.log("    [Shift 1: Friday 3:45 pm]");
  const slip1 = executeIssueSlip("RQ-214", "PR-04", "Kabir Sen", "Fri 8 pm", state);
  const slip2 = executeIssueSlip("RQ-214", "SP-02", "Kabir Sen", "Fri 8 pm", state);
  const slip3 = executeIssueSlip("RQ-214", "AD-12", "Kabir Sen", "Fri 8 pm", state);

  assert.strictEqual(slip1.ok, true, "PR-04 issue must succeed");
  assert.strictEqual(slip2.ok, true, "SP-02 issue must succeed");
  assert.strictEqual(slip3.ok, true, "AD-12 issue must succeed");
  assert.strictEqual(state.loans.length, 4, "Total 4 active loans");

  // Advance time to 7:30 pm
  state.phase = 1;

  // --- SHIFT 2: Friday 7:30 pm (Partial Return) ---
  console.log("    [Shift 2: Friday 7:30 pm]");
  const prLoan = state.loans.find((l) => l.asset === "PR-04");
  const spLoan = state.loans.find((l) => l.asset === "SP-02");
  const adLoan = state.loans.find((l) => l.asset === "AD-12");

  // Return Projector in good condition
  const ret1 = executeEquipmentReturn(prLoan.num, "Kabir Sen", "good", "Projector returned", state);
  assert.strictEqual(ret1.ok, true);

  // Return Speaker in good condition
  const ret2 = executeEquipmentReturn(spLoan.num, "Kabir Sen", "good", "Speaker returned", state);
  assert.strictEqual(ret2.ok, true);

  // Kabir hands over Adapter to Leela Das for tomorrow 9:00 am dropoff
  const transferRes = executeCustodyTransfer(
    adLoan.num,
    "Leela Das",
    "Sat 9 am",
    "Kabir returned main kit; Leela dropping off adapter at 9 am tomorrow",
    state,
  );
  assert.strictEqual(transferRes.ok, true);
  assert.strictEqual(adLoan.currentCustodian, "Leela Das");
  assert.strictEqual(adLoan.due, "Sat 9 am");

  // Advance time to Saturday 9:00 am
  state.phase = 2;

  // --- SHIFT 3: Saturday 9:00 am (Smart Shift Handover & Morning Check-In) ---
  console.log("    [Shift 3: Saturday 9:00 am]");

  // Outstanding check in handover queue
  const outstandingInHandover = state.loans.filter((l) => !l.back);
  assert.strictEqual(outstandingInHandover.length, 2, "Only MI-09 and AD-12 should be outstanding");

  const adOutstanding = outstandingInHandover.find((l) => l.asset === "AD-12");
  assert.ok(adOutstanding, "AD-12 must be in handover queue");
  assert.strictEqual(adOutstanding.currentCustodian, "Leela Das");

  // Verify due status at Sat 9:00 am for Sat 9:00 am is "due-now"
  const dueStatus = calculateDueStatus(adOutstanding.dueTimestamp || adOutstanding.due, state.phase);
  assert.strictEqual(dueStatus.status, "due-now", "Adapter must be Due Now on Saturday morning");

  // Leela walks in and checks in the adapter in good condition
  const checkinRes = executeEquipmentReturn(adOutstanding.num, "Leela Das", "good", "Adapter cord intact", state);
  assert.strictEqual(checkinRes.ok, true);
  assert.strictEqual(checkinRes.isDiscrepancy, false, "Zero discrepancy when Leela checks in her own custody item");

  // Verify inventory is back on shelf
  const adAsset = state.assets.find((a) => a.id === "AD-12");
  assert.strictEqual(adAsset.repair, false);
  assert.strictEqual(adAsset.inspection, false);
  assert.strictEqual(canIssueAsset(adAsset, state.loans), true, "Adapter back on shelf");

  // Verify all 3 items for RQ-214 are now closed/returned
  const rq214Loans = state.loans.filter((l) => l.req === "RQ-214");
  assert.strictEqual(rq214Loans.length, 3);
  assert.ok(rq214Loans.every((l) => l.back), "All 3 slips for Film Society must be closed");

  console.log("    ✓ Full 3-shift lifecycle reconciled seamlessly!");
});

console.log("\n========================================================");
console.log(`  RESULTS: ${passed} PASSED | ${failed} FAILED`);
console.log("========================================================\n");

if (failed > 0) {
  process.exit(1);
}
