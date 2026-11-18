(() => {
  "use strict";

  /* ==========================================================================
     1. CONSTANTS, CENTRALIZED CLOCK & TIMESTAMPS
     ========================================================================== */

  const storageKey = "campus-stores.shift.v2";

  // Deterministic simulated clock for the 3 shift phases
  const SHIFT_TIMESTAMPS = [
    "2026-10-23T15:45:00", // Phase 0: Friday 3:45 pm
    "2026-10-23T19:30:00", // Phase 1: Friday 7:30 pm
    "2026-10-24T09:00:00", // Phase 2: Saturday 9:00 am
  ];

  const DUE_TIMESTAMPS = {
    "Fri 8 pm": "2026-10-23T20:00:00",
    "Sat 9 am": "2026-10-24T09:00:00",
    "Sat 10 am": "2026-10-24T10:00:00",
    "Sat noon": "2026-10-24T12:00:00",
  };

  const requests = [
    {
      id: "RQ-214",
      club: "Film Society",
      event: "Courtyard screening",
      owner: "Isha Rao",
      due: "Fri 8 pm",
      items: ["HDMI projector", "Portable speaker", "USB-C → HDMI adapter"],
      note: "Playback is from a USB-C-only laptop. The host will collect at 4 pm.",
    },
    {
      id: "RQ-209",
      club: "Debate Union",
      event: "Finals rehearsal",
      owner: "Tara Shah",
      due: "Sat 10 am",
      items: ["Wireless microphone"],
      note: "Rehearsal runs into the evening.",
    },
    {
      id: "RQ-217",
      club: "Photo Circle",
      event: "Street portrait walk",
      owner: "Dev Menon",
      due: "Sat noon",
      items: ["Digital camera"],
      note: "Collection on Saturday morning.",
    },
  ];

  const initialAssets = [
    { id: "PR-04", type: "HDMI projector", model: "BenQ MH550", bin: "A2", repair: false, inspection: false },
    { id: "PR-06", type: "HDMI projector", model: "Epson EB-X49", bin: "Workshop", repair: true, inspection: false },
    { id: "SP-02", type: "Portable speaker", model: "JBL Eon One", bin: "B1", repair: false, inspection: false },
    { id: "SP-05", type: "Portable speaker", model: "Bose S1", bin: "B2", repair: false, inspection: false },
    { id: "AD-12", type: "USB-C → HDMI adapter", model: "Belkin AVC002", bin: "C4", repair: false, inspection: false },
    { id: "AD-15", type: "USB-C → HDMI adapter", model: "Anker A8312", bin: "C4", repair: false, inspection: false },
    { id: "MI-09", type: "Wireless microphone", model: "Shure BLX", bin: "B3", repair: false, inspection: false },
    { id: "CA-03", type: "Digital camera", model: "Sony A6400", bin: "D2", repair: false, inspection: false },
  ];

  const people = [
    "Isha Rao",
    "Kabir Sen",
    "Leela Das",
    "Tara Shah",
    "Dev Menon",
  ];

  const shifts = [
    {
      time: "Friday · 3:45 pm",
      title: "Pickup at the counter",
      text: "Kabir is here for the Film Society screening. The film starts at four. Can he leave with everything he needs?",
      next: "Move to return time",
    },
    {
      time: "Friday · 7:30 pm",
      title: "The kit comes back in pieces",
      text: "Kabir has brought back the projector and speaker. “Leela still has the adapter. She’ll drop it off tomorrow at nine.” Take the return and hand over to the morning shift.",
      next: "Move to next morning",
    },
    {
      time: "Saturday · 9:00 am",
      title: "Morning shift",
      text: "You’ve just taken over. Leela walks in with an adapter. Work out what was outstanding from the screening and close the loan for the right item.",
    },
  ];

  const pages = [
    ["Shift handover", "clock"],
    ["Requests", "clipboard-list"],
    ["Inventory", "package"],
    ["Loan register", "book-open"],
    ["Desk book", "messages-square"],
  ];

  /* ==========================================================================
     2. PURE DOMAIN LOGIC & TIMESTAMP CALCULATIONS (Exported for Testing)
     ========================================================================== */

  /**
   * Calculates due status based on explicit simulated timestamp comparison.
   * Rank order:
   *   1. Overdue (current > due)
   *   2. Due now (current === due)
   *   3. Due soon (due within 60 minutes)
   *   4. Upcoming (due > 60 minutes)
   */
  function calculateDueStatus(dueKeyOrTimestamp, currentPhase) {
    const currentISO = SHIFT_TIMESTAMPS[currentPhase] || SHIFT_TIMESTAMPS[0];
    const dueISO = DUE_TIMESTAMPS[dueKeyOrTimestamp] || dueKeyOrTimestamp;

    if (!dueISO) {
      return { status: "upcoming", label: "Upcoming", class: "upcoming", rank: 4, diffMinutes: Infinity };
    }

    const diffMs = new Date(dueISO).getTime() - new Date(currentISO).getTime();
    const diffMinutes = Math.round(diffMs / (60 * 1000));

    if (diffMs < 0) {
      const overdueHours = Math.abs(Math.round(diffMinutes / 60));
      return {
        status: "overdue",
        label: `Overdue (${overdueHours > 0 ? overdueHours + "h" : Math.abs(diffMinutes) + "m"})`,
        class: "overdue",
        rank: 1,
        diffMinutes,
      };
    }
    if (diffMs === 0) {
      return { status: "due-now", label: "Due now", class: "due-now", rank: 2, diffMinutes: 0 };
    }
    if (diffMs <= 60 * 60 * 1000) {
      return { status: "due-soon", label: `Due soon (${diffMinutes}m)`, class: "due-soon", rank: 3, diffMinutes };
    }
    return { status: "upcoming", label: "Upcoming", class: "upcoming", rank: 4, diffMinutes };
  }

  function getAssetHelper(assetsList, id) {
    return assetsList.find((x) => x.id === id);
  }

  function getReqHelper(id) {
    return requests.find((x) => x.id === id);
  }

  function isAssetOut(loansList, assetId) {
    return loansList.some((l) => l.asset === assetId && !l.back);
  }

  function canIssueAsset(asset, loansList) {
    if (!asset || asset.repair || asset.inspection) return false;
    return !isAssetOut(loansList, asset.id);
  }

  function executeIssueSlip(req, assetId, who, due, currentState) {
    const unit = getAssetHelper(currentState.assets, assetId);
    const r = getReqHelper(req);

    if (!r || !unit || !people.includes(who)) {
      return { ok: false, error: "Invalid issue parameters." };
    }
    if (!canIssueAsset(unit, currentState.loans)) {
      return { ok: false, error: `Asset ${unit.id} is unavailable (on loan, inspection, or in repair).` };
    }
    if (!r.items.includes(unit.type)) {
      return { ok: false, error: "This equipment type is outside the approved request." };
    }
    if (currentState.loans.some((l) => l.req === req && !l.back && getAssetHelper(currentState.assets, l.asset)?.type === unit.type)) {
      return { ok: false, error: "The approved quantity of this equipment type is already on loan." };
    }

    const num = Math.max(...currentState.loans.map((l) => l.num), 400) + 1;
    const newSlip = {
      num,
      req,
      asset: assetId,
      who,
      currentCustodian: who,
      due,
      dueTimestamp: DUE_TIMESTAMPS[due] || due,
      issuedAt: SHIFT_TIMESTAMPS[currentState.phase],
      issuedPhase: currentState.phase,
      back: false,
      custodyHistory: [],
    };
    currentState.loans.push(newSlip);
    return { ok: true, slip: newSlip };
  }

  /**
   * Custody Transfer logic with audit history.
   */
  function executeCustodyTransfer(loanNum, newCustodian, newDue, note, currentState) {
    const l = currentState.loans.find((x) => x.num === loanNum);
    if (!l) return { ok: false, error: "Loan slip not found." };
    if (l.back) return { ok: false, error: "Cannot transfer custody of a closed loan slip." };

    const currentHolder = l.currentCustodian || l.transferredTo || l.who;
    if (!newCustodian || !people.includes(newCustodian)) {
      return { ok: false, error: "Please select a valid new custodian." };
    }
    if (newCustodian === currentHolder) {
      return { ok: false, error: "New custodian must be different from current custodian." };
    }

    l.custodyHistory = l.custodyHistory || [];
    const transferEvent = {
      type: "CUSTODY_TRANSFER",
      slipId: `L-${l.num}`,
      assetId: l.asset,
      from: currentHolder,
      to: newCustodian,
      previousDue: l.due,
      newDue: newDue || l.due,
      note: note || "",
      timestamp: SHIFT_TIMESTAMPS[currentState.phase],
      shiftTime: shifts[currentState.phase].time,
    };

    l.custodyHistory.push(transferEvent);
    l.currentCustodian = newCustodian;
    l.transferredTo = newCustodian;
    if (newDue) {
      l.due = newDue;
      l.dueTimestamp = DUE_TIMESTAMPS[newDue] || l.dueTimestamp;
    }
    l.custodyNote = note || "";

    const asset = getAssetHelper(currentState.assets, l.asset);
    const req = getReqHelper(l.req);
    const isPastApproved = req && DUE_TIMESTAMPS[l.due] > DUE_TIMESTAMPS[req.due];
    const pastApprovedNote = isPastApproved ? ` [Past approved return (${req.due})]` : "";

    const logText = `Slip L-${l.num} (${l.asset} · ${asset ? asset.type : ""}): custody transferred from ${currentHolder} to ${newCustodian}, due ${l.due}.${pastApprovedNote}${note ? " Note: " + note : ""}`;
    currentState.notes.push({ phase: currentState.phase, text: logText });

    return { ok: true, loan: l };
  }

  /**
   * Equipment Return logic with physical condition check.
   */
  function executeEquipmentReturn(loanNum, returnedBy, condition, note, currentState) {
    const l = currentState.loans.find((x) => x.num === loanNum);
    if (!l) return { ok: false, error: "Loan slip not found." };
    if (l.back) return { ok: false, error: "This loan slip is already closed." };

    const currentHolder = l.currentCustodian || l.transferredTo || l.who;
    const actualReturner = returnedBy || currentHolder;
    const isDiscrepancy = actualReturner !== currentHolder;

    l.back = true;
    l.returnedAt = SHIFT_TIMESTAMPS[currentState.phase];
    l.returnedPhase = currentState.phase;
    l.returnedBy = actualReturner;
    l.returnCondition = condition || "good";
    l.returnNote = note || "";
    l.discrepancy = isDiscrepancy;

    const asset = getAssetHelper(currentState.assets, l.asset);
    if (asset) {
      if (condition === "damaged") {
        asset.repair = true;
        asset.inspection = false;
      } else if (condition === "inspection") {
        asset.inspection = true;
        asset.repair = false;
      } else {
        asset.repair = false;
        asset.inspection = false;
      }
    }

    const returnLog = `Slip L-${l.num} closed: ${l.asset} returned by ${actualReturner} (Condition: ${condition || "good"}).${isDiscrepancy ? " [Discrepancy: expected " + currentHolder + "]" : ""}${note ? " Note: " + note : ""}`;
    currentState.notes.push({ phase: currentState.phase, text: returnLog });

    return { ok: true, loan: l, asset, isDiscrepancy };
  }

  // Node module export for automated test suite
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
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
    };
    return;
  }

  /* ==========================================================================
     3. BROWSER APPLICATION & UI
     ========================================================================== */

  const root = document.getElementById("campus-stores");
  const q = (selector) => root.querySelector(selector);

  function toast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const el = document.createElement("div");
    el.className = "toast" + (type === "warn" ? " warn" : "");
    el.textContent = message;
    el.setAttribute("role", "alert");
    container.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  let confirmResolve = null;
  function confirmAction(title, description) {
    return new Promise((resolve) => {
      const dialog = document.getElementById("confirm-dialog");
      if (!dialog) {
        resolve(true);
        return;
      }
      document.getElementById("confirm-title").textContent = title;
      document.getElementById("confirm-desc").textContent = description;
      confirmResolve = resolve;
      dialog.showModal();
    });
  }
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-confirm]");
    if (!btn || !confirmResolve) return;
    document.getElementById("confirm-dialog").close();
    confirmResolve(btn.dataset.confirm === "ok");
    confirmResolve = null;
  });

  /* ── Check-In Modal ── */
  let returnModalResolve = null;
  function openReturnModal(loanNum) {
    const l = s.loans.find((x) => x.num === loanNum);
    if (!l || l.back) return Promise.resolve(null);

    const asset = getAsset(l.asset);
    const currentHolder = l.currentCustodian || l.transferredTo || l.who;

    const dialog = document.getElementById("return-dialog");
    document.getElementById("return-dialog-title").textContent = `Check In: ${l.asset} (${asset ? asset.type : ""})`;
    document.getElementById("return-dialog-subtitle").textContent = `Slip L-${l.num} · Current custodian: ${currentHolder}`;
    document.getElementById("return-loan-num").value = String(l.num);

    const select = document.getElementById("return-by-select");
    select.innerHTML = people
      .map((p) => `<option value="${esc(p)}"${p === currentHolder ? " selected" : ""}>${esc(p)}</option>`)
      .join("");

    document.getElementById("return-condition-select").value = "good";
    document.getElementById("return-note-input").value = "";

    const discWarning = document.getElementById("return-discrepancy-warning");
    document.getElementById("return-expected-custodian").textContent = currentHolder;
    document.getElementById("return-actual-person").textContent = currentHolder;
    discWarning.hidden = true;

    select.onchange = () => {
      const isMismatch = select.value !== currentHolder;
      discWarning.hidden = !isMismatch;
      document.getElementById("return-actual-person").textContent = select.value;
    };

    return new Promise((resolve) => {
      returnModalResolve = resolve;
      dialog.showModal();
    });
  }

  document.addEventListener("click", (e) => {
    const cancelBtn = e.target.closest('[data-return-action="cancel"]');
    if (cancelBtn && returnModalResolve) {
      document.getElementById("return-dialog").close();
      returnModalResolve(null);
      returnModalResolve = null;
    }
  });

  document.getElementById("return-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!returnModalResolve) return;
    const loanNum = Number(document.getElementById("return-loan-num").value);
    const returnedBy = document.getElementById("return-by-select").value;
    const condition = document.getElementById("return-condition-select").value;
    const note = document.getElementById("return-note-input").value.trim();

    document.getElementById("return-dialog").close();
    returnModalResolve({ loanNum, returnedBy, condition, note });
    returnModalResolve = null;
  });

  /* ── Initial State ── */
  const originalState = () => ({
    version: 2,
    tab: "Shift handover",
    phase: 0,
    selected: "",
    filter: "All items",
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
    editing: false,
    transferring: null,
    onlyOpen: true,
    notice: "Sample shift · All records are fictional.",
  });

  let s = originalState();

  const getAsset = (id) => getAssetHelper(s.assets, id);
  const getReq = (id) => getReqHelper(id);
  const out = (id) => isAssetOut(s.loans, id);

  const esc = (x) =>
    String(x).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );

  const opts = (list, sel = "") =>
    list
      .map(
        ([v, t]) =>
          `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(t)}</option>`,
      )
      .join("");

  const btn = (label, act, val = "", style = "", extra = "") =>
    `<button type="button" data-action="${act}" data-val="${esc(val)}" class="${style}"${extra}>${esc(label)}</button>`;

  const head = (title, sub, control = "") =>
    `<div class="sectionhead"><div><h2>${title}</h2><small>${sub}</small></div>${control}</div>`;

  const row = (label, sub, right) =>
    `<div class="row"><div><strong>${esc(label)}</strong><small>${sub}</small></div><div>${right}</div></div>`;

  const badge = (t, good = false, cls = "") =>
    `<span class="tag${good ? " good" : ""}${cls ? " " + cls : ""}">${esc(t)}</span>`;

  function inventorySummary() {
    let onShelf = 0, onLoan = 0, inRepair = 0, inInspection = 0;
    for (const a of s.assets) {
      if (a.repair) inRepair++;
      else if (a.inspection) inInspection++;
      else if (out(a.id)) onLoan++;
      else onShelf++;
    }
    return { onShelf, onLoan, inRepair, inInspection, total: s.assets.length };
  }

  /* ==========================================================================
     4. VIEWS (FOCUSED ON THE SHIFT HANDOVER DECISION)
     ========================================================================== */

  /**
   * THE CHOSEN DECISION: Smart Shift Handover
   * Sorts queue strictly by urgency:
   *   1. Overdue first
   *   2. Due now second
   *   3. Due soon third
   *   4. Upcoming fourth
   */
  function handoverPage() {
    const phase = shifts[s.phase];
    const outstandingLoans = s.loans.filter((l) => !l.back);
    const counts = inventorySummary();

    // Sort strictly by urgency rank, then by due timestamp ascending
    const sortedQueue = outstandingLoans.slice().sort((a, b) => {
      const statusA = calculateDueStatus(a.dueTimestamp || a.due, s.phase);
      const statusB = calculateDueStatus(b.dueTimestamp || b.due, s.phase);
      if (statusA.rank !== statusB.rank) {
        return statusA.rank - statusB.rank;
      }
      return (DUE_TIMESTAMPS[a.due] || "").localeCompare(DUE_TIMESTAMPS[b.due] || "");
    });

    let overdueCount = 0;
    let dueNowOrSoonCount = 0;
    for (const l of outstandingLoans) {
      const status = calculateDueStatus(l.dueTimestamp || l.due, s.phase);
      if (status.status === "overdue") overdueCount++;
      if (status.status === "due-now" || status.status === "due-soon") dueNowOrSoonCount++;
    }

    let html = head(
      "Shift Handover",
      `${phase.time} · Incoming clerk briefing & check-in queue`,
    );

    // Summary Metrics
    html += `
      <div class="handover-metrics">
        <div class="metric-card${overdueCount > 0 ? " alert" : ""}">
          <small>Overdue</small>
          <strong>${overdueCount}</strong>
        </div>
        <div class="metric-card">
          <small>Due Now / Soon</small>
          <strong>${dueNowOrSoonCount}</strong>
        </div>
        <div class="metric-card">
          <small>Total On Loan</small>
          <strong>${outstandingLoans.length}</strong>
        </div>
        <div class="metric-card">
          <small>In Repair / Check</small>
          <strong>${counts.inRepair + counts.inInspection}</strong>
        </div>
      </div>
    `;

    html += `<h3 style="margin:16px 0 8px">Actionable Equipment Handover Queue</h3>`;

    if (!sortedQueue.length) {
      html += `
        <div class="record" style="border-left-color:var(--ok)">
          <h3>All shift equipment accounts balanced ✓</h3>
          <p>No gear is currently outstanding on loan.</p>
        </div>
      `;
    } else {
      for (const l of sortedQueue) {
        const asset = getAsset(l.asset);
        const req = getReq(l.req);
        const currentHolder = l.currentCustodian || l.transferredTo || l.who;
        const timeStatus = calculateDueStatus(l.dueTimestamp || l.due, s.phase);

        // Past approved return check
        const isPastApproved = req && DUE_TIMESTAMPS[l.due] > DUE_TIMESTAMPS[req.due];
        const pastApprovedBadge = isPastApproved
          ? `<span class="tag overdue" title="Original request approved return was ${req.due}">Past approved return (${req.due})</span>`
          : "";

        let custodyTrailHtml = "";
        if (l.custodyHistory && l.custodyHistory.length > 0) {
          const trail = l.custodyHistory.map((h) => `${h.from} → ${h.to} (${h.shiftTime})`).join(" → ");
          custodyTrailHtml = `<span class="custody-trail">🔀 Custody trail: ${esc(trail)}</span>`;
        }

        html += `
          <div class="handover-item-card">
            <div class="handover-item-header">
              <div>
                <strong>Slip L-${l.num} · ${l.asset}</strong> (${esc(asset ? asset.type : "")})
                <span class="muted">· Bin ${asset ? asset.bin : "?"}</span>
              </div>
              <div style="display:flex;gap:6px;align-items:center;">
                ${pastApprovedBadge}
                <span class="tag ${timeStatus.class}">${esc(timeStatus.label)}</span>
              </div>
            </div>
            <div class="handover-item-body">
              <div><strong>Current Custodian:</strong> ${esc(currentHolder)}${currentHolder !== l.who ? ` <span class="muted">(transferred from original borrower ${esc(l.who)})</span>` : ""}</div>
              <div><strong>Approved Request:</strong> ${esc(req ? req.event : l.req)} (${esc(req ? req.club : "")}) · Return due: <b>${esc(l.due)}</b></div>
              ${l.custodyNote ? `<div class="slip-note">📌 Handover note: ${esc(l.custodyNote)}</div>` : ""}
              ${custodyTrailHtml}
            </div>
            <div class="handover-actions">
              <button type="button" class="primary" data-action="quick-return" data-val="${l.num}">
                ✓ Check in item
              </button>
              <button type="button" data-action="start-transfer" data-val="${l.num}">
                Transfer custody
              </button>
            </div>
          </div>
        `;
      }
    }

    // Previous Shift Notes
    html += `<h3 style="margin:20px 0 8px">Shift Communications Log</h3>`;
    const entries = [
      [
        "Friday · 3:20 pm",
        "Isha Rao · Film Society",
        "Kabir Sen is picking up our whole screening kit. Please issue it in his name. I’m setting up in the courtyard.",
      ],
      [
        "Friday · 3:30 pm",
        "Tara Shah · Debate Union",
        "Our microphone stays with me overnight. I’ll return it by 10 am Saturday.",
      ],
    ];
    if (s.phase >= 1) {
      entries.push([
        "Friday · 7:30 pm",
        "Kabir Sen · Film Society",
        "I brought the projector and speaker. Leela Das has our adapter. She’ll be at the counter at 9 am tomorrow.",
      ]);
    }
    for (const n of s.notes) {
      entries.push([shifts[n.phase].time, "Shift Handover Note", n.text]);
    }

    for (const [t, author, body] of entries.slice().reverse().slice(0, 5)) {
      html += `
        <article class="record" style="margin-top:8px;padding:9px 12px">
          <small>${esc(t)} · ${esc(author)}</small>
          <p style="font-size:13px">${esc(body)}</p>
        </article>
      `;
    }

    return html;
  }

  function requestPage() {
    let html = head(
      "Approved requests",
      "Student Activities Office · 3 approved forms",
    );
    if (s.selected) {
      const r = getReq(s.selected);
      if (!r) return html;

      const reqLoans = s.loans.filter((l) => l.req === r.id);
      const isFulfilled = r.items.every((itemType) =>
        reqLoans.some((l) => getAsset(l.asset)?.type === itemType),
      );
      const allReturned = reqLoans.length > 0 && reqLoans.every((l) => l.back);

      let itemsListHtml = '<ul class="item-status-list">';
      for (const itemType of r.items) {
        const itemLoan = reqLoans.find(
          (l) => getAsset(l.asset)?.type === itemType,
        );
        let statusBadge = "";
        if (itemLoan) {
          if (itemLoan.back) {
            statusBadge = badge(`Returned · L-${itemLoan.num}`, true);
          } else {
            const holder = itemLoan.currentCustodian || itemLoan.transferredTo || itemLoan.who;
            const timeStatus = calculateDueStatus(itemLoan.dueTimestamp || itemLoan.due, s.phase);
            statusBadge = badge(
              `${itemLoan.asset} → ${holder} (L-${itemLoan.num}) · ${timeStatus.label}`,
              false,
              timeStatus.class,
            );
          }
        } else {
          statusBadge = badge("Not issued");
        }
        itemsListHtml += `<li><span>${esc(itemType)}</span> ${statusBadge}</li>`;
      }
      itemsListHtml += "</ul>";

      html += `
        ${btn("← Back to list", "close")}
        <div class="record">
          <small>${r.id} · Approved</small>
          <h3>${esc(r.event)}</h3>
          <p>${esc(r.club)} · Filed by ${esc(r.owner)}</p>
          <p><b>Return by</b> ${esc(r.due)}</p>
          <p><b>Approved equipment</b></p>
          ${itemsListHtml}
          <p>${esc(r.note)}</p>
          <div style="margin-top:14px">
            ${isFulfilled ? (allReturned ? badge("All items returned ✓", true) : badge("Gear on loan") + " " + btn("View in loan register", "tab", "Loan register")) : btn("Issue slip for this request", "new-for-req", r.id, "primary")}
          </div>
        </div>
      `;
    } else {
      html += requests
        .map((r) => {
          const reqLoans = s.loans.filter((l) => l.req === r.id);
          const isFulfilled = r.items.every((itemType) =>
            reqLoans.some((l) => getAsset(l.asset)?.type === itemType),
          );
          const allReturned = reqLoans.length > 0 && reqLoans.every((l) => l.back);
          let statusBadge = isFulfilled
            ? allReturned
              ? badge("Returned", true)
              : badge("On loan")
            : badge("Approved");

          return row(
            r.event,
            `${esc(r.id)} · ${esc(r.club)} · ${r.items.length} items`,
            `${statusBadge} ${btn("View form", "request", r.id)}`,
          );
        })
        .join("");
    }
    return html;
  }

  function inventoryPage() {
    const counts = inventorySummary();
    let html = head(
      "Inventory",
      `${counts.total} physical units · ${counts.onShelf} on shelf · ${counts.onLoan} on loan · ${counts.inInspection} inspecting · ${counts.inRepair} in repair`,
    );

    html += `
      <div class="buttons">
        <label>
          Show
          <select data-filter>
            ${opts(["All items", "On shelf", "On loan", "Needs inspection", "In repair"].map((f) => [f, f]), s.filter)}
          </select>
        </label>
      </div>
    `;

    for (const a of s.assets) {
      const activeLoan = s.loans.find((l) => l.asset === a.id && !l.back);
      const status = a.repair
        ? "In repair"
        : a.inspection
          ? "Needs inspection"
          : activeLoan
            ? "On loan"
            : "On shelf";

      if (s.filter !== "All items" && s.filter !== status) continue;

      let loanInfo = "";
      let statusTag = "";

      if (a.repair) {
        statusTag = badge("In repair", false, "overdue");
      } else if (a.inspection) {
        statusTag = badge("Needs inspection", false, "inspection");
      } else if (activeLoan) {
        const holder = activeLoan.currentCustodian || activeLoan.transferredTo || activeLoan.who;
        const timeStatus = calculateDueStatus(activeLoan.dueTimestamp || activeLoan.due, s.phase);
        loanInfo = `<span class="loan-holder">→ Held by ${esc(holder)} · Slip L-${activeLoan.num} (${timeStatus.label})</span>`;
        statusTag = badge(`On loan · ${timeStatus.label}`, false, timeStatus.class);
      } else {
        statusTag = badge("On shelf", true);
      }

      html += row(
        `${a.id} · ${a.type}`,
        `${esc(a.model)} · Bin ${esc(a.bin)}${loanInfo}`,
        statusTag,
      );
    }
    return html;
  }

  function registerPage() {
    const outstanding = s.loans.filter((l) => !l.back).length;
    let html = head(
      "Loan register",
      `${outstanding} outstanding · ${s.loans.length} total slips`,
      s.editing
        ? btn("Cancel", "cancel")
        : btn("New issue slip", "new", "", "primary"),
    );

    // Issue Slip Form
    // EVIDENCE FOR "WHAT WORKED WELL": PR-06 (in repair in Workshop) is filtered out
    // by canIssueAsset() and can never be issued from this form.
    if (s.editing) {
      const availableUnits = s.assets.filter((a) => canIssueAsset(a, s.loans));
      const select = (label, key, options, preselect = "") =>
        `<label><span>${label}</span><select name="${key}" required><option value="">Select…</option>${opts(options, preselect)}</select></label>`;

      const defaultReq = s.editingReq || "";
      const defaultWho = defaultReq === "RQ-214" ? "Kabir Sen" : "";
      const defaultDue = defaultReq ? getReq(defaultReq)?.due : "Fri 8 pm";

      return (
        html +
        `<form data-issue>
          <div class="form">
            ${select(
              "Approved request",
              "req",
              requests.map((r) => [r.id, `${r.id} · ${r.club}`]),
              defaultReq,
            )}
            ${select(
              "Unit leaving the desk (Home bin shown)",
              "asset",
              availableUnits.map((a) => [a.id, `${a.id} · ${a.type} — Bin ${a.bin}`]),
            )}
            ${select(
              "Collected by",
              "who",
              people.map((p) => [p, p]),
              defaultWho,
            )}
            ${select(
              "Return by",
              "due",
              ["Fri 8 pm", "Sat 9 am", "Sat 10 am", "Sat noon"].map((d) => [d, d]),
              defaultDue,
            )}
          </div>
          <button type="submit" class="primary">Save issue slip</button>
        </form>`
      );
    }

    // Custody Transfer Form (NO hardcoded recipient defaults)
    if (s.transferring) {
      const l = s.loans.find((x) => x.num === s.transferring);
      if (l && !l.back) {
        const asset = getAsset(l.asset);
        const req = getReq(l.req);
        const currentHolder = l.currentCustodian || l.transferredTo || l.who;
        const eligibleRecipients = people
          .filter((p) => p !== currentHolder)
          .map((p) => [p, p]);

        const dueOpts = [
          "Fri 8 pm",
          "Sat 9 am",
          "Sat 10 am",
          "Sat noon",
        ].map((d) => [d, d]);

        return (
          html +
          `<form data-transfer>
            <input type="hidden" name="num" value="${l.num}" />
            <div class="record">
              <small>Slip L-${l.num} · Custody Handover</small>
              <h3>Transfer Custody: ${esc(l.asset)} (${esc(asset ? asset.type : "")})</h3>
              <p>Originally issued to <b>${esc(l.who)}</b> for ${esc(l.req)} · Currently held by <b>${esc(currentHolder)}</b></p>
              <p><b>Original approved request return:</b> ${esc(req ? req.due : "Fri 8 pm")}</p>
            </div>
            <div class="form">
              <label>
                <span>New Custodian (Recipient)</span>
                <select name="who" required>
                  <option value="">Select new custodian…</option>
                  ${opts(eligibleRecipients)}
                </select>
              </label>
              <label>
                <span>Updated Return Time</span>
                <select name="due" required>
                  ${opts(dueOpts, l.due)}
                </select>
              </label>
              <label class="full">
                <span>Handover Note & Reason (Logged to Desk Book)</span>
                <input
                  type="text"
                  name="note"
                  placeholder="e.g. Taking over equipment for morning session"
                  required
                  maxlength="300"
                />
              </label>
            </div>
            <div class="buttons">
              <button type="submit" class="primary">Save custody transfer</button>
              ${btn("Cancel", "cancel-transfer")}
            </div>
          </form>`
        );
      }
    }

    // List Slips
    html += `
      <div class="buttons">
        ${["Outstanding", "All slips"]
          .map(
            (v, i) =>
              `<button type="button" data-action="scope" data-val="${i}" aria-pressed="${s.onlyOpen === (i === 0)}">${v}</button>`,
          )
          .join("")}
      </div>
    `;

    const shown = s.loans
      .filter((l) => !s.onlyOpen || !l.back)
      .slice()
      .reverse();

    if (!shown.length) html += "<p>No slips in this view.</p>";

    for (const l of shown) {
      const asset = getAsset(l.asset);
      const req = getReq(l.req);
      const currentHolder = l.currentCustodian || l.transferredTo || l.who;
      const isTransferred = currentHolder !== l.who;
      const timeStatus = calculateDueStatus(l.dueTimestamp || l.due, s.phase);

      const isPastApproved = req && DUE_TIMESTAMPS[l.due] > DUE_TIMESTAMPS[req.due];
      const pastApprovedBadge = isPastApproved
        ? `<span class="tag overdue" title="Original approved return was ${req.due}">Past approved return (${req.due})</span> `
        : "";

      const holderHtml = isTransferred
        ? `Held by <b>${esc(currentHolder)}</b> <span class="muted">(transferred from ${esc(l.who)})</span>`
        : `Held by <b>${esc(l.who)}</b>`;

      const noteHtml = l.custodyNote
        ? `<div class="slip-note">📌 ${esc(l.custodyNote)}</div>`
        : "";

      let custodyTrailHtml = "";
      if (l.custodyHistory && l.custodyHistory.length > 0) {
        const trail = l.custodyHistory.map((h) => `${h.from} → ${h.to}`).join(" → ");
        custodyTrailHtml = `<span class="custody-trail">History: ${esc(trail)}</span>`;
      }

      let returnDetailsHtml = "";
      if (l.back) {
        returnDetailsHtml = `<span class="muted">· Returned by ${esc(l.returnedBy || currentHolder)} (Condition: ${esc(l.returnCondition || "good")})</span>`;
      }

      const sub = `${esc(l.req)} · ${holderHtml} · Due <b>${esc(l.due)}</b> ${returnDetailsHtml} ${noteHtml} ${custodyTrailHtml}`;

      let actions = "";
      if (l.back) {
        actions = badge("Returned ✓", true);
      } else {
        actions = `
          <button type="button" class="primary" data-action="quick-return" data-val="${l.num}" aria-label="Check in slip L-${l.num}">
            Check in
          </button>
          <button type="button" data-action="start-transfer" data-val="${l.num}" aria-label="Transfer custody of slip L-${l.num}">
            Transfer
          </button>
        `;
      }

      html += row(
        `L-${l.num} · ${l.asset} (${esc(asset ? asset.type : "")})`,
        sub,
        `<span style="margin-right:8px">${pastApprovedBadge}${badge(timeStatus.label, l.back, l.back ? "good" : timeStatus.class)}</span> ${actions}`,
      );
    }
    return html;
  }

  function deskbookPage() {
    let html = head(
      "Desk book",
      "Shift handover logs, return discrepancies, and communications",
    );
    const entries = [
      [
        "Friday · 3:20 pm",
        "Isha Rao · Film Society",
        "Kabir Sen is picking up our whole screening kit. Please issue it in his name. I’m setting up in the courtyard.",
      ],
      [
        "Friday · 3:30 pm",
        "Tara Shah · Debate Union",
        "Our microphone stays with me overnight. I’ll return it by 10 am Saturday.",
      ],
    ];
    if (s.phase >= 1) {
      entries.push([
        "Friday · 7:30 pm",
        "Kabir Sen · Film Society",
        "I brought the projector and speaker. Leela Das has our adapter. She’ll be at the counter at 9 am tomorrow.",
      ]);
    }
    for (const n of s.notes) {
      entries.push([shifts[n.phase].time, "Shift Handover Event", n.text]);
    }
    for (const [t, author, body] of entries.slice().reverse()) {
      html += `
        <article class="record">
          <small>${esc(t)}</small>
          <h3>${esc(author)}</h3>
          <p>${esc(body)}</p>
        </article>
      `;
    }
    return (
      html +
      `<form data-note>
        <div class="form">
          <label class="full">
            <span>Note for the next shift</span>
            <textarea name="note" rows="2" maxlength="400" required placeholder="Leave a handover note for the next desk shift…"></textarea>
          </label>
        </div>
        <button type="submit">Add handover note</button>
      </form>`
    );
  }

  const screens = {
    "Shift handover": handoverPage,
    Requests: requestPage,
    Inventory: inventoryPage,
    "Loan register": registerPage,
    "Desk book": deskbookPage,
  };

  /* ==========================================================================
     5. UI RENDER & PERSISTENCE
     ========================================================================== */

  function paint() {
    const phase = shifts[s.phase];
    q("[data-clock]").textContent = phase.time;
    q("[data-shift-title]").textContent = phase.title;
    q("[data-shift]").textContent = phase.text;

    const advance = q('[data-action="advance"]');
    advance.hidden = !phase.next;
    advance.textContent = phase.next || "";

    q("[data-nav]").innerHTML = pages
      .map(
        ([n, icon], i) => `
          <button type="button" data-action="tab" data-val="${n}" aria-pressed="${s.tab === n}" title="${n} (${i + 1})">
            <svg aria-hidden="true" class="store-icon"><use href="#icon-${icon}"></use></svg>
            ${n}
          </button>
        `,
      )
      .join("");

    q("[data-page]").innerHTML = screens[s.tab]();
    if (q("[data-filter]")) q("[data-filter]").value = s.filter;
    q("[data-status]").textContent = s.notice;
  }

  function commit(msg) {
    if (msg) s.notice = msg;
    paint();
    try {
      localStorage.setItem(storageKey, JSON.stringify(s));
    } catch {
      q("[data-status]").textContent += " Browser storage unavailable.";
    }
  }

  /* ==========================================================================
     6. EVENT LISTENERS
     ========================================================================== */

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const retDialog = document.getElementById("return-dialog");
      if (retDialog && retDialog.open) {
        retDialog.close();
        if (returnModalResolve) returnModalResolve(null);
        return;
      }
      if (s.transferring) { s.transferring = null; commit(); return; }
      if (s.editing) { s.editing = false; s.editingReq = ""; commit(); return; }
      if (s.selected) { s.selected = ""; commit(); return; }
    }
    if (e.key >= "1" && e.key <= "5" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.target.matches("input, textarea, select")) return;
      const idx = Number(e.key) - 1;
      if (pages[idx]) {
        s.tab = pages[idx][0];
        s.editing = false;
        s.transferring = null;
        commit();
      }
    }
  });

  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-action]");
    if (!b) return;
    const v = b.dataset.val;

    switch (b.dataset.action) {
      case "restart":
        confirmAction(
          "Restart sample shift?",
          "This will reset all loan slips, equipment condition records, and handover notes back to the starting state.",
        ).then((ok) => {
          if (!ok) return;
          s = originalState();
          commit();
          toast("Shift reset to starting sample records.");
        });
        return;

      case "advance":
        if (s.phase < 2) {
          s.phase++;
          if (s.phase === 2) {
            s.tab = "Shift handover";
          }
        }
        s.notice = "Shift time updated.";
        toast(`⏰ Desk time: ${shifts[s.phase].time}`);
        break;

      case "tab":
        s.tab = v;
        s.editing = false;
        s.editingReq = "";
        s.transferring = null;
        break;

      case "close":
        s.selected = "";
        break;

      case "request":
        s.selected = v;
        break;

      case "new":
        s.editing = true;
        s.editingReq = "";
        s.transferring = null;
        break;

      case "new-for-req":
        s.tab = "Loan register";
        s.editing = true;
        s.editingReq = v;
        s.transferring = null;
        break;

      case "cancel":
        s.editing = false;
        s.editingReq = "";
        break;

      case "start-transfer":
        s.transferring = Number(v);
        s.tab = "Loan register";
        break;

      case "cancel-transfer":
        s.transferring = null;
        break;

      case "scope":
        s.onlyOpen = v === "0";
        break;

      case "quick-return": {
        const loanNum = Number(v);
        openReturnModal(loanNum).then((res) => {
          if (!res) return;
          handleCheckInResult(res);
        });
        return;
      }
    }
    commit();
  });

  function handleCheckInResult(res) {
    const result = executeEquipmentReturn(res.loanNum, res.returnedBy, res.condition, res.note, s);
    if (!result.ok) {
      toast(result.error, "warn");
      return;
    }

    const asset = result.asset;
    let conditionMsg = "in good condition — back on shelf";
    if (res.condition === "damaged") conditionMsg = "DAMAGED — routed to Workshop for repair";
    if (res.condition === "inspection") conditionMsg = "placed in inspection quarantine";

    const discrepancyMsg = result.isDiscrepancy ? " (Custody discrepancy logged)" : "";
    commit(`Check-in complete: ${asset ? asset.id : ""} ${conditionMsg}.${discrepancyMsg}`);
    toast(`✓ Check-in complete: ${asset ? asset.id : ""} ${conditionMsg}`);
  }

  root.addEventListener("change", (e) => {
    if (e.target.matches("[data-filter]")) {
      s.filter = e.target.value;
      commit();
    }
  });

  root.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const form = new FormData(f);

    const submitBtn = f.querySelector('[type="submit"]');
    if (submitBtn && submitBtn.disabled) return;
    if (submitBtn) submitBtn.disabled = true;
    setTimeout(() => {
      if (submitBtn) submitBtn.disabled = false;
    }, 600);

    if (f.matches("[data-note]")) {
      const text = String(form.get("note")).trim();
      if (!text) return;
      s.notes.push({ phase: s.phase, text });
      commit("Handover note saved.");
      toast("📝 Note added to Desk Book.");
      f.reset();
      return;
    }

    if (f.matches("[data-issue]")) {
      const [req, assetId, who, due] = ["req", "asset", "who", "due"].map((k) => form.get(k));
      const unit = getAsset(assetId);
      const res = executeIssueSlip(req, assetId, who, due, s);
      if (!res.ok) {
        toast(res.error, "warn");
        return;
      }

      s.editing = false;
      s.editingReq = "";
      commit(`Issued ${assetId} to ${who} on slip L-${res.slip.num}.`);
      toast(`✓ Issued ${unit.type} to ${who} — Slip L-${res.slip.num}`);
      return;
    }

    if (f.matches("[data-transfer]")) {
      const num = Number(form.get("num"));
      const who = form.get("who");
      const due = form.get("due");
      const note = String(form.get("note") || "").trim();

      const result = executeCustodyTransfer(num, who, due, note, s);
      if (!result.ok) {
        toast(result.error, "warn");
        return;
      }

      s.transferring = null;
      commit(`Custody for Slip L-${num} transferred to ${who}.`);
      toast(`🔄 Custody transferred to ${who} (Due: ${due})`);
      return;
    }
  });

  /* ==========================================================================
     7. RESTORE STATE
     ========================================================================== */

  function restore(d) {
    if (!d || typeof d !== "object") return;

    const loans = Array.isArray(d.loans)
      ? d.loans.map((l) => ({
          ...l,
          currentCustodian: l.currentCustodian || l.transferredTo || l.who,
          dueTimestamp: l.dueTimestamp || DUE_TIMESTAMPS[l.due] || SHIFT_TIMESTAMPS[1],
          custodyHistory: Array.isArray(l.custodyHistory) ? l.custodyHistory : [],
        }))
      : originalState().loans;

    const assets = Array.isArray(d.assets)
      ? d.assets.map((a) => ({
          ...a,
          repair: Boolean(a.repair),
          inspection: Boolean(a.inspection),
        }))
      : JSON.parse(JSON.stringify(initialAssets));

    s = {
      ...originalState(),
      ...d,
      version: 2,
      tab: screens[d.tab] ? d.tab : "Shift handover",
      phase: Number.isInteger(d.phase) && shifts[d.phase] ? d.phase : 0,
      assets,
      loans,
      notes: Array.isArray(d.notes) ? d.notes : [],
      editingReq: "",
      transferring: null,
    };
    paint();
  }

  paint();
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      restore(JSON.parse(saved));
    }
  } catch {
    // Keep clean state
  }
})();
