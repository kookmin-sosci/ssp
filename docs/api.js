/* SSP 웹앱 — 서버(구글 Apps Script) 연결
 * API_URL 이 있으면 구글로, 없으면 이 기기에만 저장하는 체험 모드로 동작해요. */
(function () {
  "use strict";
  const DAY_START = new Date("2026-11-19T00:00:00+09:00");
  const DAY_END = new Date("2026-11-20T00:00:00+09:00");
  const URL_ = ((window.SSP_CONFIG || {}).API_URL || "").trim();

  /* ---------- 구글 API ---------- */
  async function remote(action, payload) {
    // text/plain 으로 보내면 브라우저가 사전 요청(CORS preflight)을 하지 않아요.
    const res = await fetch(URL_, {
      method: "POST",
      body: JSON.stringify(Object.assign({ action: action }, payload || {})),
      redirect: "follow"
    });
    if (!res.ok) throw new Error("http " + res.status);
    return res.json();
  }

  /* ---------- 체험 모드 (이 기기에만 저장) ---------- */
  const K = "ssp-demo-v2";
  const BEN = { coffee: "커피쿠폰", lucky: "럭키드로우 1회 추가" };
  function load() {
    try { const s = localStorage.getItem(K); if (s) return JSON.parse(s); } catch (e) {}
    return { regs: [], pin: "1119", couponLimit: 30, mode: "auto" };
  }
  let mem = load();
  const save = () => { try { localStorage.setItem(K, JSON.stringify(mem)); } catch (e) {} };
  const stamp = d => {
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const modeNow = s => s && s !== "auto" ? s : (new Date() < DAY_START ? "pre" : new Date() < DAY_END ? "day" : "post");
  const left = () => Math.max(0, mem.couponLimit - mem.regs.filter(r => r.benefit === "coffee").length);
  const find = sid => mem.regs.find(r => r.sid === sid);
  const pub = r => ({ name: r.name, sid: r.sid, code: r.code, redeemed: r.redeemed, benefit: r.benefit, redeemedAt: r.redeemedAt });
  const validSid = s => /^\d{8,10}$/.test(String(s || ""));
  function redeem(sid, code, benefit, via) {
    if (!BEN[benefit]) return { ok: false, reason: "invalid" };
    const r = find(sid); if (!r || r.code !== code) return { ok: false, reason: "not_found" };
    if (r.redeemed) return { ok: false, reason: "used", reg: r };
    if (benefit === "coffee" && left() <= 0) return { ok: false, reason: "soldout", left: 0 };
    Object.assign(r, { redeemed: true, benefit: benefit, redeemedAt: stamp(new Date()), via: via });
    save(); return { ok: true, reg: Object.assign({}, r), left: left() };
  }
  function adminData() {
    return { ok: true, regs: mem.regs.map(r => Object.assign({}, r)),
      config: { couponLimit: mem.couponLimit, modeSetting: mem.mode, mode: modeNow(mem.mode) },
      stats: { total: mem.regs.length, paid: mem.regs.filter(r => r.redeemed).length,
        coffee: mem.regs.filter(r => r.benefit === "coffee").length,
        lucky: mem.regs.filter(r => r.benefit === "lucky").length, left: left() },
      sheetUrl: "", updatedAt: new Date().toISOString() };
  }
  async function local(action, p) {
    p = p || {};
    await new Promise(r => setTimeout(r, 250)); // 실제 서버처럼 약간 기다림
    mem = load();
    const pinOk = String(p.pin || "") === mem.pin;
    switch (action) {
      case "config": return { ok: true, mode: modeNow(mem.mode), modeSetting: mem.mode, couponLimit: mem.couponLimit, left: left() };
      case "check": return validSid(p.sid) ? { ok: true, exists: !!find(p.sid) } : { ok: false, reason: "invalid" };
      case "apply": {
        if (String(p.name || "").trim().length < 2 || !validSid(p.sid)) return { ok: false, reason: "invalid" };
        if (modeNow(mem.mode) !== "pre") return { ok: false, reason: "closed" };
        if (find(p.sid)) return { ok: false, reason: "exists" };
        const r = { name: p.name.trim(), sid: p.sid, code: String(Math.floor(Math.random() * 1e4)).padStart(4, "0"),
          createdAt: stamp(new Date()), redeemed: false, benefit: null, redeemedAt: "", via: "", memo: "" };
        mem.regs.push(r); save(); return { ok: true, reg: pub(r) };
      }
      case "lookup": { const r = find(p.sid); return r && r.name === String(p.name || "").trim() ? { ok: true, reg: pub(r) } : { ok: false, reason: "not_found" }; }
      case "verify": { const r = find(p.sid); return r && r.code === p.code ? { ok: true, reg: pub(r), left: left() } : { ok: false, reason: "not_found" }; }
      case "redeem": return pinOk ? redeem(p.sid, p.code, p.benefit, "참여자 화면에서 확인") : { ok: false, reason: "pin" };
      case "adminLogin": return pinOk ? { ok: true } : { ok: false, reason: "pin" };
      case "adminData": return pinOk ? adminData() : { ok: false, reason: "pin" };
      case "adminFind": { if (!pinOk) return { ok: false, reason: "pin" }; const r = find(p.sid); return r ? { ok: true, reg: Object.assign({}, r), left: left() } : { ok: false, reason: "not_found" }; }
      case "adminRedeem": { if (!pinOk) return { ok: false, reason: "pin" }; const r = find(p.sid); return r ? redeem(p.sid, r.code, p.benefit, "학번으로 찾아 지급") : { ok: false, reason: "not_found" }; }
      case "adminUndo": {
        if (!pinOk) return { ok: false, reason: "pin" }; const r = find(p.sid); if (!r) return { ok: false, reason: "not_found" };
        r.memo = (r.memo ? r.memo + " / " : "") + "지급 취소 " + stamp(new Date());
        Object.assign(r, { redeemed: false, benefit: null, redeemedAt: "", via: "" }); save();
        return { ok: true, reg: Object.assign({}, r), left: left() };
      }
      case "adminSetConfig": {
        if (!pinOk) return { ok: false, reason: "pin" };
        if (p.couponLimit !== undefined) { const n = parseInt(p.couponLimit, 10); if (isNaN(n) || n < 0) return { ok: false, reason: "invalid" }; mem.couponLimit = n; }
        if (p.mode !== undefined) mem.mode = p.mode;
        save(); return adminData();
      }
    }
    return { ok: false, reason: "unknown_action" };
  }

  window.SSP_API = {
    demo: !URL_,
    call: (action, payload) => (URL_ ? remote(action, payload) : local(action, payload)),
    BENEFIT_LABEL: BEN,
    DAY_START: DAY_START, DAY_END: DAY_END
  };
})();
