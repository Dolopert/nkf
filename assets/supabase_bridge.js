/**
 * supabase_bridge.js — แก้โดย CC 23 ก.ย. 69 (TASK_p4_pwa_supabase)
 *
 * ให้ App.html เรียก google.script.run.<action>(...) ได้เหมือนเดิมทุกจุด (Proxy เดิมของ static-host)
 * แต่ครั้งนี้แอ็กชันส่วนใหญ่ (ดูตาราง TASK_p4_pwa_supabase.md ข้อ B) วิ่งไป Supabase (anon key + RLS)
 * แทนที่จะยิง JSONP ไป Apps Script — ท่อนำเข้า statement ย้ายมาโหมดใหม่แล้ว (P5: RPC ingest_statement)
 * · เหลือ notifyText/debugFallback ที่ยังเป็นโหมดเดิม (ใช้กับลิงก์ส่วนตัวเดิม)
 * และ markBill/addBillReturn/closeBill/unmarkBill ที่ยังไม่มีตารางใน Supabase v1 (คืน ok:false เสมอ)
 *
 * โหลดหลัง assets/vendor/supabase-js.js และก่อน App.html inline <script> (build_static.py ฉีดลำดับนี้ให้)
 * ต้องมี window.NKF_SB = { url, anon } มาก่อน (มาจาก build_static.py อ่าน .env) — ไม่มี = ไม่ทำอะไรเลย (ตกไปโหมดเดโม่)
 */
(function () {
  'use strict';

  // แก้โดย Hermes 28 ก.ย. 69 (forgot-password): จำ hash ตั้งต้นก่อน supabase-js ล้างทิ้ง — ใช้แยก "มากจากลิงก์ตั้งรหัสใหม่" กับ "ลิงก์เสีย/หมดอายุ"
  var INIT_HASH = location.hash || '';

  // ---------- มิเรอร์ค่าคงที่จาก Web.gs (ห้ามแก้ Web.gs — คัดลอกมาเพื่อคำนวณฝั่งนี้) ----------
  var WEB_CATS = [
    ['food', '🍽️', 'อาหาร'],
    ['transport', '🚕', 'เดินทาง'],
    ['house', '🏠', 'บ้าน'],
    ['subscriptions', '🔁', 'สมาชิก'],
    ['fuel', '⛽', 'น้ำมัน'],
    ['topup', '💳', 'เติมเงิน'],
    ['income', '💰', 'รายรับ'],
    ['personal', '🙋', 'ค่าใช้จ่ายส่วนตัว'],
    ['entertainment', '🎬', 'บันเทิง'],
    ['shopping', '🛍️', 'ช้อปปิ้ง'],
    ['health', '🏥', 'สุขภาพ'],
    ['education', '📚', 'การศึกษา'],
    ['beauty', '💇', 'ดูแลตัวเอง'],
    ['travel', '✈️', 'ท่องเที่ยว'],
    ['gifts', '🎁', 'ของขวัญ/ช่วยเหลือ'],
    ['investment', '📈', 'ลงทุน'],
    ['sports', '⚽', 'กีฬา']
  ];
  var WEB_MAIN = ['food', 'transport', 'house', 'subscriptions', 'fuel', 'topup', 'personal', 'entertainment'];

  // เก็บ "ชื่อที่พี่ตั้ง" ไว้ในคอลัมน์ merchants.name เดียวกับคีย์จับคู่ (ตาราง merchants ไม่มีคอลัมน์แยก
  // เพราะ migrations ของ P1/P3 ห้ามแตะ) — รูปแบบ "<key><SEP><display>" · ไม่มี SEP = ยังไม่เคยตั้งชื่อ
  var NAME_SEP = '||';

  // ยังใช้ต่อกับ 2 แอ็กชันที่ยังไม่ย้าย (notifyText/debugFallback) — token เดิมของ static host
  var LEGACY_EXEC_URL = 'https://script.google.com/macros/s/' +
    'AKfycbwm6T3wPwHlOaQIWQ_79r_9Ux-Wu7WUUftkvGcc7NsZvVqRp72Z6YkvJnm8KusBf8yPMA/exec';

  if (!window.NKF_SB || !window.NKF_SB.url || !window.NKF_SB.anon ||
      String(window.NKF_SB.url).indexOf('REPLACE_ME') >= 0) {
    console.warn('[nkf bridge] NKF_SB ไม่ได้ตั้งค่า (ไม่มี .env ตอน build) — ปล่อยให้แอปตกไปโหมดเดโม่');
    return;
  }
  if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
    console.error('[nkf bridge] supabase-js ไม่โหลด — ตรวจ assets/vendor/supabase-js.js');
    return;
  }

  var sb = window.supabase.createClient(window.NKF_SB.url, window.NKF_SB.anon, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
  var CURRENT_UID = null;

  // ---------- helpers ----------
  function strv(v) { return v === null || v === undefined ? '' : String(v); }
  function numv(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function nowIso() { return new Date().toISOString(); }

  // แปลง timestamptz (UTC, จาก Postgres) → สตริงเวลาไทยแบบเดิมที่ App.html สไลซ์ตรง ๆ ("yyyy-MM-ddTHH:mm:ss")
  function toThaiLocal(isoUtc) {
    if (!isoUtc) return '';
    var d = new Date(isoUtc);
    if (isNaN(d.getTime())) return '';
    var t = new Date(d.getTime() + 7 * 3600 * 1000);
    return t.getUTCFullYear() + '-' + pad2(t.getUTCMonth() + 1) + '-' + pad2(t.getUTCDate()) + 'T' +
      pad2(t.getUTCHours()) + ':' + pad2(t.getUTCMinutes()) + ':' + pad2(t.getUTCSeconds());
  }
  function thaiNowParts() {
    var s = toThaiLocal(nowIso());
    return { ymd: s.slice(0, 10), ym: s.slice(0, 7), day: parseInt(s.slice(8, 10), 10) };
  }

  function errText(e) {
    var m = (e && (e.message || e.error_description || e.msg)) || (typeof e === 'string' ? e : '');
    if (/invalid.*(credential|login)/i.test(m)) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
    if (/not allowed|not.*invit|403/i.test(m)) return 'อีเมลนี้ยังไม่ได้รับเชิญ — ติดต่อเจ้าของแอป';
    if (/network|fetch|failed to fetch|timeout/i.test(m)) return 'เน็ตหลุด — ลองใหม่อีกครั้ง';
    // แก้โดย Hermes 28 ก.ย. 69 (forgot-password): ข้อความไทยของ error ฝั่งรีเซ็ตรหัส
    if (/security purposes|rate limit|too many/i.test(m)) return 'ทำรายการถี่เกินไป — รอสักครู่แล้วลองใหม่';
    if (/at least 6|minimum.*6|password.*(short|weak)/i.test(m)) return 'รหัสผ่านสั้นเกินไป — ตั้งอย่างน้อย 6 ตัว';
    if (/different from the old/i.test(m)) return 'รหัสใหม่ต้องไม่ซ้ำกับรหัสเดิม';
    if (/otp.*expired|token.*expired|expired|invalid.*(token|grant)/i.test(m)) return 'ลิงก์หมดอายุหรือถูกใช้ไปแล้ว — ขอลิงก์ใหม่';
    return m || 'เกิดข้อผิดพลาด';
  }

  // ---------- มิเรอร์ merchantKeyFor_/normalizeMerchant_ ใน Code.js (ห้ามแก้ Code.js) ----------
  function normalizeMerchant(name) {
    if (!name) return '';
    var t = String(name).trim().toLowerCase();
    t = t.split(/\s*สาขา(?![0-9a-zA-Z_ก-๙])/)[0];
    t = t.replace(/[^a-z0-9ก-๙\s-]/g, '');
    t = t.replace(/\s+/g, ' ').trim();
    return t;
  }
  function merchantKeyFor(counterparty, kind) {
    var cp = strv(counterparty);
    var m = cp.match(/\((\d{6,12})\)/);
    if (m) return 'code:' + m[1];
    if (strv(kind) === 'wallet_card' || cp.indexOf('รูดการ์ด') >= 0) return 'card:unknown';
    return normalizeMerchant(cp);
  }
  function splitMerchantName(raw) {
    var s = strv(raw);
    var i = s.indexOf(NAME_SEP);
    if (i < 0) return { key: s, display: '' };
    return { key: s.slice(0, i), display: s.slice(i + NAME_SEP.length) };
  }

  // ---------- auth ----------
  // แก้โดย Hermes 28 ก.ย. 69 (forgot-password): ส่ง event ให้ App แยกโหมด PASSWORD_RECOVERY + ฟังก์ชันรีเซ็ตรหัสผ่าน
  var _authCb = null, _recovery = false;
  function emitAuth(evt, session) {
    CURRENT_UID = (session && session.user) ? session.user.id : null;
    if (_authCb) _authCb(session || null, _recovery ? 'PASSWORD_RECOVERY' : (evt || ''));
  }
  window.NKF_AUTH = {
    initHashRecovery: /(^|[#&])type=recovery/.test(INIT_HASH),
    initHashError: /(^|[#&])error=/.test(INIT_HASH),
    init: function (cb) {
      _authCb = cb;
      sb.auth.onAuthStateChange(function (evt, session) {
        if (evt === 'PASSWORD_RECOVERY') _recovery = true;
        if (evt === 'SIGNED_OUT') _recovery = false;
        emitAuth(evt, session);
      });
      sb.auth.getSession().then(function (r) {
        var session = (r && r.data) ? r.data.session : null;
        emitAuth('', session);
      });
    },
    signIn: function (email, password, cb) {
      sb.auth.signInWithPassword({ email: strv(email).trim(), password: strv(password) })
        .then(function (r) { cb(r.error ? errText(r.error) : null); })
        .catch(function (e) { cb(errText(e)); });
    },
    resetPassword: function (email, cb) {
      sb.auth.resetPasswordForEmail(strv(email).trim(), { redirectTo: location.origin + location.pathname })
        .then(function (r) { cb(r.error ? errText(r.error) : null); })
        .catch(function (e) { cb(errText(e)); });
    },
    updatePassword: function (password, cb) {
      sb.auth.updateUser({ password: strv(password) })
        .then(function (r) { if (!r.error) _recovery = false; cb(r.error ? errText(r.error) : null); })
        .catch(function (e) { cb(errText(e)); });
    },
    signOut: function (cb) {
      sb.auth.signOut().then(function () { _recovery = false; if (cb) cb(); }).catch(function () { _recovery = false; if (cb) cb(); });
    }
  };

  // ---------- legacy JSONP (notifyText/debugFallback เท่านั้น — ยังไม่ย้ายมาโหมดใหม่) ----------
  function legacyToken() {
    try {
      var mh = (location.hash || '').match(/[#&]k=([a-f0-9]{16,64})/);
      if (mh) { try { localStorage.setItem('nkf_k', mh[1]); } catch (_e) {} return mh[1]; }
      var ms = (location.search || '').match(/[?&]k=([a-f0-9]{16,64})/);
      if (ms) { try { localStorage.setItem('nkf_k', ms[1]); } catch (_e) {} return ms[1]; }
      return localStorage.getItem('nkf_k') || '';
    } catch (_e) { return ''; }
  }
  function legacyCall(method, args) {
    return new Promise(function (resolve) {
      var tok = legacyToken();
      if (!tok) { resolve({ ok: false, msg: 'ฟีเจอร์นี้ยังไม่ย้ายมาโหมดใหม่ — ต้องใช้ลิงก์ส่วนตัวเดิม (โหมดเก่า)' }); return; }
      var cb = 'nkfcb_' + Math.random().toString(36).slice(2) + '_' + Date.now();
      var done = false;
      var s = document.createElement('script');
      var to = setTimeout(function () {
        if (!done) { done = true; cleanup(); resolve({ ok: false, msg: 'เชื่อมต่อโหมดเก่าไม่ได้ (timeout)' }); }
      }, 20000);
      function cleanup() {
        clearTimeout(to);
        try { delete window[cb]; } catch (_e) { window[cb] = null; }
        if (s.parentNode) s.parentNode.removeChild(s);
      }
      window[cb] = function (res) { if (!done) { done = true; cleanup(); resolve(res); } };
      s.onerror = function () { if (!done) { done = true; cleanup(); resolve({ ok: false, msg: 'เชื่อมต่อโหมดเก่าไม่ได้' }); } };
      s.src = LEGACY_EXEC_URL + '?cb=' + cb + '&t=' + encodeURIComponent(tok) +
        '&action=' + encodeURIComponent(method) + '&a=' + encodeURIComponent(JSON.stringify(args || [])) + '&_=' + Date.now();
      document.head.appendChild(s);
    });
  }
  function notMoved() { return Promise.resolve({ ok: false, msg: 'ยังไม่ย้ายมาโหมดใหม่นี้ — ใช้ผ่านโหมดเดิมไปก่อน' }); }

  // ---------- มิเรอร์ isWalletXfer_/isWalletKind_ ใน Web.gs ----------
  function isWalletXfer(it) {
    if (it.direction !== 'out') return false;
    if (it.kind === 'topup') return true;
    if (it.kind === 'qr_merchant' && /truemoney|ทรูมันนี่/i.test(strv(it.counterparty))) return true;
    return false;
  }
  function isWalletKind(it) {
    var k = it.kind;
    return (k === 'wallet_card' || k === 'wallet_online' || k === 'wallet_online_xb' || k === 'wallet_settle');
  }

  // แก้โดย Hermes 5 ต.ค. 69 (P สั่ง · เธรด "ปุ่มเปิด-ปิดรายการย่อยใน TrueMoney"): โหมดสรุปกระเป๋า —
  // ธง 'nkf_tm_track' = '0' → ตัดรายการกระเป๋า (kind wallet_* / account truemoney) ออกจากทุกยอด/ลิสต์ · ข้อมูลยังอยู่ครบ เปิดกลับเห็นเหมือนเดิม
  function tmTrackOn_() {
    try { return String(localStorage.getItem('nkf_tm_track') || '') !== '0'; } catch (e) { return true; }
  }
  function isTmWalletRow_(it) {
    return isWalletKind(it) || strv(it.account).toLowerCase() === 'truemoney' || strv(it.kind).indexOf('wallet_') === 0;
  }

  // ---------- มิเรอร์ computeBudgets_ ใน Web.gs (data source = ตาราง budgets แทนแท็บชีต) ----------
  // แก้โดย CC — TASK_v42_recurring.md (3 ต.ค. 69): excludeRefs = {ref:true} ของ tx ที่จับคู่รายการประจำแล้ว
  // (มาจาก matchFixedRefs ชุดเดียวกับ computeFixed) → ไม่นับซ้ำในยอด "ใช้ไป" ของงบรายหมวด
  function computeBudgets(budgetRows, rows, monthPrefix, nowDate, excludeRefs) {
    excludeRefs = excludeRefs || {};
    var daysIn = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0).getDate();
    var out = [], totSpent = 0, totCap = 0;
    for (var i = 0; i < budgetRows.length; i++) {
      var b = budgetRows[i];
      if (b.active === false) continue;
      var key = strv(b.key); if (!key) continue;
      var label = strv(b.label) || key;
      var emoji = strv(b.emoji);
      var cats = strv(b.cats).split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x; });
      var perDay = numv(b.cap_per_day);
      var cap = numv(b.cap_minor);
      var day = numv(b.day);
      if (!cap && perDay) cap = perDay * daysIn;
      var spent = 0;
      for (var r = 0; r < rows.length; r++) {
        var it = rows[r];
        if (it.status !== 'saved' || it.direction !== 'out') continue;
        if (it.at.slice(0, 7) !== monthPrefix) continue;
        if (isWalletXfer(it)) continue;
        if (cats.indexOf(it.category) === -1) continue;
        if (excludeRefs[it.ref]) continue;  // แก้โดย CC — TASK_v42_recurring.md (3 ต.ค. 69)
        spent += it.amount_minor;
      }
      var pct = cap > 0 ? Math.round(spent / cap * 100) : 0;
      out.push({
        key: key, label: label, emoji: emoji, cats: cats, per_day: perDay, cap_minor: cap,
        spent_minor: spent, remain_minor: Math.max(0, cap - spent), over_minor: Math.max(0, spent - cap),
        pct: pct, day: day, overlap: day > 0
      });
      totSpent += spent; totCap += cap;
    }
    return { items: out, total: { spent_minor: totSpent, cap_minor: totCap } };
  }

  // ---------- มิเรอร์ computeDetail_ ใน Web.gs ----------
  function computeDetail(rows, monthPrefix) {
    var dmap = {};
    function mm(mp) {
      if (!dmap[mp]) dmap[mp] = { total: 0, income: 0, cats: {}, days: {}, mer: {}, merN: {}, count: 0 };
      return dmap[mp];
    }
    for (var i = 0; i < rows.length; i++) {
      var it = rows[i];
      if (it.status === 'skipped') continue;
      var mp = it.at.slice(0, 7);
      var m = mm(mp);
      m.count++;
      if (it.direction === 'in') { m.income += it.amount_minor; continue; }
      if (isWalletXfer(it)) continue;
      var net = it.amount_minor;
      m.total += net;
      if (it.category) m.cats[it.category] = (m.cats[it.category] || 0) + net;
      var dk = it.at.slice(0, 10);
      m.days[dk] = (m.days[dk] || 0) + net;
      var nm = strv(it.display_name) || strv(it.counterparty);
      if (nm) { m.mer[nm] = (m.mer[nm] || 0) + net; m.merN[nm] = (m.merN[nm] || 0) + 1; }
    }
    var months = [];
    for (var k in dmap) if (Object.prototype.hasOwnProperty.call(dmap, k)) months.push(k);
    months.sort(function (a2, b2) { return a2 < b2 ? 1 : -1; });
    months = months.slice(0, 6);
    function flat(ob) {
      var arr = [];
      for (var c2 in ob) if (Object.prototype.hasOwnProperty.call(ob, c2)) arr.push({ cat: c2, n: ob[c2] });
      arr.sort(function (x, y) { return y.n - x.n; });
      if (arr.length > 6) {
        var rs = 0;
        for (var q = 5; q < arr.length; q++) rs += arr[q].n;
        arr = arr.slice(0, 5);
        if (rs > 0) arr.push({ cat: 'other', n: rs });
      }
      return arr;
    }
    var outM = [];
    for (var mi = 0; mi < months.length; mi++) {
      var mp2 = months[mi], m2 = dmap[mp2];
      var topDay = '', topDayN = 0;
      for (var dk2 in m2.days) if (m2.days[dk2] > topDayN) { topDayN = m2.days[dk2]; topDay = dk2; }
      var topMer = '', topMerN = 0, topMerSum = 0;
      for (var nm2 in m2.merN) {
        if (m2.merN[nm2] > topMerN || (m2.merN[nm2] === topMerN && m2.mer[nm2] > topMerSum)) {
          topMer = nm2; topMerN = m2.merN[nm2]; topMerSum = m2.mer[nm2];
        }
      }
      outM.push({
        m: mp2, total_minor: m2.total, income_minor: m2.income, count: m2.count,
        cats: flat(m2.cats), top_day: topDay, top_day_n: topDayN,
        top_merchant: topMer, top_merchant_n: topMerN, top_merchant_sum: topMerSum
      });
    }
    var dacct = { kplus: { total: 0, transfer: 0, cats: {} }, truemoney: { total: 0, transfer: 0, cats: {} } };
    for (var r2 = 0; r2 < rows.length; r2++) {
      var it2 = rows[r2];
      if (it2.status !== 'saved' || it2.direction !== 'out') continue;
      if (it2.at.slice(0, 7) !== monthPrefix) continue;
      var a = it2.acct || 'kplus';
      if (!dacct[a]) continue;
      if (isWalletXfer(it2)) { dacct[a].transfer += it2.amount_minor; continue; }
      dacct[a].total += it2.amount_minor;
      if (it2.category) dacct[a].cats[it2.category] = (dacct[a].cats[it2.category] || 0) + it2.amount_minor;
    }
    return {
      months: outM,
      acct: {
        kplus: { total_minor: dacct.kplus.total, transfer_minor: dacct.kplus.transfer, cats: flat(dacct.kplus.cats) },
        truemoney: { total_minor: dacct.truemoney.total, transfer_minor: dacct.truemoney.transfer, cats: flat(dacct.truemoney.cats) }
      }
    };
  }

  // ---------- รายการประจำ: มาจากตาราง recurring/recurring_ack แทน FIXED_ITEMS ที่ฮาร์ดโค้ดในชีตเดิม ----------
  // แก้โดย CC — TASK_v42x_quickadd.md (3 ต.ค. 69): ขยายเป็น 10 แบรนด์ (ครบ LOGO_URL ใน App.html)
  // ชุดกติกา (ลำดับ + regex) ต้องตรงกับ BRAND_RULES/brandOf ใน App.html — เทสต์ quickadd_typing ข้อ 8 เช็ค parity
  var BRAND_RULES = [
    ['truemoney', /truemoney|true money|ทรูมันนี่|ทรูมันนี/],
    ['make', /\bmake\b/],
    ['kplus', /kbank|k ?plus|กสิกร/],
    ['bbl', /\bbbl\b|bualuang|บัวหลวง|ธนาคารกรุงเทพ/],
    ['claude', /claude/],
    ['netflix', /netflix|เน็ตฟลิกซ์/],
    ['spotify', /spotify|สปอติฟาย/],
    ['grab', /grab|แกร็บ/],
    ['steam', /\bsteam\b|สตีม/],
    ['apple', /\bapple\b|icloud|itunes|app store|แอปเปิ้ล|แอปเปิล/]
  ];
  function fxLogo(name) {
    var s = strv(name).toLowerCase();
    for (var i = 0; i < BRAND_RULES.length; i++) if (BRAND_RULES[i][1].test(s)) return BRAND_RULES[i][0];
    return '';
  }
  // ---------- แก้โดย CC — TASK_v42x_weekly.md (3 ต.ค. 69): รายสัปดาห์ — ตัวช่วยวัน/งวด (บริสุทธิ์ · รับวันที่ชัดเจน) ----------
  // dow 0=อาทิตย์ … 6=เสาร์ (= JS getDay() = recurring.day_of_week ใน 0007) · ต้องตรงกับ TH_DOW ใน App.html
  var TH_DOW = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  var DAY_MS = 86400000;
  // 'YYYY-MM-DD' (วันที่ไทยแล้ว) → ms ของเที่ยงคืน UTC วันนั้น · คิดด้วยปี/เดือน/วันจริง (ไม่ขึ้นกับโซนเครื่อง) · ผิดรูป/วันไม่มีจริง → NaN
  function ymdMs(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(strv(s));
    if (!m) return NaN;
    var y = +m[1], mo = +m[2], d = +m[3];
    var t = Date.UTC(y, mo - 1, d), c = new Date(t);
    if (c.getUTCFullYear() !== y || c.getUTCMonth() !== mo - 1 || c.getUTCDate() !== d) return NaN;
    return t;
  }
  function msYmd(t) {
    var c = new Date(t);
    return c.getUTCFullYear() + '-' + pad2(c.getUTCMonth() + 1) + '-' + pad2(c.getUTCDate());
  }
  function validDow(dow) {
    var n = parseInt(dow, 10);
    return (String(n) === strv(dow).trim() && n >= 0 && n <= 6) ? n : -1;
  }
  // งวดนี้ = วัน dow ที่ใกล้สุดย้อนหลัง ≤ วันนี้ (วันนี้ตรง dow → วันนี้) · ข้อมูลไม่ถูกต้อง → ''
  function weeklyDueDate(dow, todayStr) {
    var n = validDow(dow), t = ymdMs(todayStr);
    if (n < 0 || !isFinite(t)) return '';
    var back = (new Date(t).getUTCDay() - n + 7) % 7;
    return msYmd(t - back * DAY_MS);
  }
  // หน้าต่างจับคู่ของงวด = [due−3, due+3] (7 วัน · ไม่ทับหน้าต่างงวดถัดไปที่ due+7)
  function weeklyWindow(dueStr) {
    var t = ymdMs(dueStr);
    if (!isFinite(t)) return ['', ''];
    return [msYmd(t - 3 * DAY_MS), msYmd(t + 3 * DAY_MS)];
  }
  // วัน (1..31) ในเดือน y-m (m = 1..12) ที่ตรง dow — จุดปฏิทิน
  function weeklyDotDays(dow, y, m) {
    var n = validDow(dow), out = [];
    if (n < 0) return out;
    var dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (var d = 1; d <= dim; d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === n) out.push(d);
    return out;
  }
  function absDays(a, b) { return Math.round(Math.abs(ymdMs(a) - ymdMs(b)) / DAY_MS); }
  function isWeekly(f) { return strv(f.freq) === 'weekly'; }

  // แก้โดย CC — TASK_v42_recurring.md (3 ต.ค. 69): รายการนี้ถึงกำหนดในเดือน monthPrefix ไหม
  // freq ไม่ใช่ 'yearly' (รวม null จากแถวที่ apply migration ช้า) = ทุกเดือน · 'yearly' = เฉพาะเดือน month_of_year
  // แก้โดย CC — TASK_v42x_weekly.md (3 ต.ค. 69): 'weekly' = มีงวดทุกเดือน (ไม่กรองเดือน — ตกเข้า return true เดิม)
  function isDueMonth(f, monthPrefix) {
    if (strv(f.freq) !== 'yearly') return true;
    return parseInt(f.month_of_year, 10) === parseInt(strv(monthPrefix).slice(5, 7), 10);
  }
  // แก้โดย CC — TASK_v42_recurring.md (3 ต.ค. 69): ตัวจับคู่ tx ↔ รายการประจำ "ชุดเดียว" ที่ computeFixed
  // และ computeBudgets ใช้ร่วมกัน (กันเลขสองที่เพี้ยนกัน) → byId: {recurringId: tx.ref} · refs: {tx.ref: true}
  // แก้โดย CC — TASK_cc_fix_v42.md (3 ต.ค. 69): กติกาจับคู่ (deterministic — ลำดับแถวจาก DB ไม่มีผล):
  //   - เงื่อนไขพื้นฐานเดิม: saved · ทิศเดียวกัน · อยู่เดือนนี้ · ไม่ใช่ wallet transfer · ยอดต่างไม่เกิน tol
  //   - รายการมี category → tx ต้องหมวดเดียวกัน (รายการเก่า category ว่าง = ไม่เช็คหมวด เหมือนเดิม)
  //   - 1 tx จับได้ 1 รายการเท่านั้น — รายการวนตาม id น้อย→มาก ("รายการแรก" = id น้อยสุด) แล้วข้าม ref ที่ถูกจับแล้ว
  //   - ผู้สมัครหลายตัว → วันในเดือนใกล้ day_of_month สุด · เสมอ → at เก่าสุด · ยังเสมอ → ref น้อยสุด
  // แก้โดย CC — TASK_v42x_weekly.md (3 ต.ค. 69): ขยายเป็น "ต่อ-งวด" (monthly/yearly พฤติกรรมเดิมเป๊ะ):
  //   - weekly: งวดนี้ due = weeklyDueDate(day_of_week, todayStr) · tx ต้องอยู่ใน weeklyWindow(due) แทนเงื่อนไข "เดือนนี้"
  //     (หน้าต่างข้ามเดือนได้) · ระยะห่างนับเป็นวันจริงจาก due · คีย์ byId = id + '|' + due (monthly/yearly คง String(id))
  //   - 1 tx → 1 งวดของ 1 รายการเท่านั้น: refs ใช้ร่วมกันทุก freq (tx เดียวห้ามนับซ้ำสองที่ — งบรายวันหักถูก)
  //   - todayStr ('YYYY-MM-DD' เวลาไทย) ไม่ส่ง = วันนี้จริง · ใช้เฉพาะ weekly
  // แก้โดย CC — TASK_cc_fix_v42x.md (3 ต.ค. 69): weekly = จับ "ทุกงวดของเดือนจนถึงวันนี้" (ไม่ใช่แค่งวดล่าสุด)
  //   - งวด = due−7k ที่ตกในเดือน monthPrefix (D <= วันนี้ เสมอเพราะ due <= วันนี้) + งวดล่าสุด due เสมอ
  //     (due ตกเดือนก่อนได้ — คงไว้เพื่อให้ computeFixed เดิมเป๊ะ) · งวดก่อน due ที่ตกเดือนก่อน = ไม่นับ (ไม่หักข้ามเดือน)
  //   - ไล่งวดเก่า → ใหม่ · ทุกงวดใช้กติกาเดิม (หน้าต่าง D±3 · ทิศ · tol · หมวด · ไม่ใช่ wallet xfer · ใกล้ D → at → ref)
  //   - กันจับซ้ำร่วมทุก freq (1 tx → 1 งวดของ 1 รายการ) → refs = tx ของงวดที่ D ตกเดือนนี้ → computeBudgets หักครบทุกงวด
  //     (due ตกเดือนก่อน → จับให้ byId ได้ แต่ไม่เข้า refs) · byId เก็บเฉพาะ id|due (งวดล่าสุด) เหมือนเดิม
  function matchFixedRefs(recurringRows, rows, monthPrefix, todayStr) {
    var byId = {}, refs = {};
    var taken = {};  // แก้โดย CC — TASK_cc_fix_v42x.md (3 ต.ค. 69): tx ที่ถูกจับแล้ว (ทุกงวด) — refs = เฉพาะที่หักงบเดือนนี้
    todayStr = todayStr || thaiNowParts().ymd;
    var recs = recurringRows.slice(0).sort(function (a, b) {
      var na = Number(a.id), nb = Number(b.id);
      if (na !== nb && isFinite(na) && isFinite(nb)) return na - nb;
      var sa = String(a.id), sb2 = String(b.id);
      return sa < sb2 ? -1 : (sa > sb2 ? 1 : 0);
    });
    for (var j = 0; j < recs.length; j++) {
      var f = recs[j];
      if (f.active === false) continue;
      if (!isDueMonth(f, monthPrefix)) continue;
      var tol = Math.max(Math.round(f.amount_minor * 0.005), 50);
      var fcat = strv(f.category);
      var want = parseInt(f.day_of_month, 10) || 0;
      // แก้โดย CC — TASK_v42x_weekly.md (3 ต.ค. 69): weekly → งวดนี้ + หน้าต่าง ±3 วัน (dow เสีย = ข้าม)
      var weekly = isWeekly(f), due = '';
      if (!weekly) {
        var hit = pickFixedTx(f, rows, taken, tol, fcat, null, '', monthPrefix, want);
        if (hit) { byId[String(f.id)] = hit.ref; refs[hit.ref] = true; taken[hit.ref] = true; }
        continue;
      }
      due = weeklyDueDate(f.day_of_week, todayStr);
      if (!due) continue;
      // แก้โดย CC — TASK_cc_fix_v42x.md (3 ต.ค. 69): งวดก่อนหน้าในเดือนนี้ (เก่า → ใหม่) แล้วปิดด้วยงวดล่าสุด due
      var insts = [], dueMs = ymdMs(due);
      for (var k = 5; k >= 1; k--) {
        var dk = msYmd(dueMs - 7 * k * DAY_MS);
        if (dk.slice(0, 7) === monthPrefix) insts.push(dk);
      }
      insts.push(due);
      for (var q = 0; q < insts.length; q++) {
        var got = pickFixedTx(f, rows, taken, tol, fcat, weeklyWindow(insts[q]), insts[q], monthPrefix, want);
        if (!got) continue;
        taken[got.ref] = true;
        // งวดล่าสุดที่ตกเดือนก่อน: จับไว้ให้การ์ด (byId) + กันจับซ้ำ (taken) แต่ไม่ใส่ refs → ไม่หักงบเดือนนี้
        if (insts[q].slice(0, 7) === monthPrefix) refs[got.ref] = true;
        if (insts[q] === due) byId[String(f.id) + '|' + due] = got.ref;
      }
    }
    return { byId: byId, refs: refs };
  }
  // แก้โดย CC — TASK_cc_fix_v42x.md (3 ต.ค. 69): ตัวเลือก tx ของ "หนึ่งงวด" (ย้ายมาจากลูปเดิมใน matchFixedRefs — กติกาเดิมเป๊ะ)
  //   win = [D−3, D+3] (weekly — ระยะ = วันจริงจาก D) · win null = monthly/yearly (เดือนนี้ — ระยะ = |วันที่ − want|)
  function pickFixedTx(f, rows, refs, tol, fcat, win, instDate, monthPrefix, want) {
    var best = null, bestDiff = 0;
    for (var r = 0; r < rows.length; r++) {
      var it = rows[r];
      if (it.status !== 'saved' || it.direction !== f.direction) continue;
      if (win) {
        var ad = it.at.slice(0, 10);
        if (ad < win[0] || ad > win[1]) continue;
      } else if (it.at.slice(0, 7) !== monthPrefix) continue;
      if (isWalletXfer(it)) continue;
      if (refs[it.ref]) continue;
      if (fcat && it.category !== fcat) continue;
      if (Math.abs(it.amount_minor - f.amount_minor) > tol) continue;
      var diff = win ? absDays(it.at.slice(0, 10), instDate) : Math.abs((parseInt(it.at.slice(8, 10), 10) || 0) - want);
      if (!best || diff < bestDiff
        || (diff === bestDiff && (it.at < best.at || (it.at === best.at && String(it.ref) < String(best.ref))))) {
        best = it; bestDiff = diff;
      }
    }
    return best;
  }
  function findRowByRef(rows, ref) {
    for (var i = 0; i < rows.length; i++) if (rows[i].ref === ref) return rows[i];
    return null;
  }
  // แก้โดย CC — TASK_v42_recurring.md (3 ต.ค. 69): รับ matched (ผล matchFixedRefs) แทนการวนจับคู่เอง ·
  // ข้ามรายการที่ไม่ถึงกำหนดเดือนนี้ · ส่ง freq/month_of_year/category ให้ UI
  // แก้โดย CC — TASK_v42x_weekly.md (3 ต.ค. 69): weekly — งวดนี้ D = weeklyDueDate(day_of_week, todayStr)
  //   ack key = id|D (recurring_ack.month เก็บ 'YYYY-MM-DD' · monthly/yearly คง id|YYYY-MM — ไม่ชนกัน) · auto-match ใช้ byId[id|D]
  //   ลำดับตัดสินเดิม: ack paid → ack wait → auto-match → D <= วันนี้ ? pending : wait · ส่งออกเพิ่ม dow, due (day = วันที่ของ D ไว้เรียงแถว)
  //   todayStr ไม่ส่ง = monthPrefix + todayNum (ค่าชุดเดียวกับที่ getData ใช้)
  function computeFixed(recurringRows, ackRows, rows, monthPrefix, todayNum, matched, todayStr) {
    todayStr = todayStr || (monthPrefix + '-' + pad2(todayNum));
    matched = matched || matchFixedRefs(recurringRows, rows, monthPrefix, todayStr);
    var acks = {};
    for (var i = 0; i < ackRows.length; i++) {
      var a = ackRows[i];
      acks[a.recurring_id + '|' + a.month] = a;
    }
    var out = [];
    for (var j = 0; j < recurringRows.length; j++) {
      var f = recurringRows[j];
      if (f.active === false) continue;
      if (!isDueMonth(f, monthPrefix)) continue;
      var weekly = isWeekly(f), due = '';
      if (weekly) { due = weeklyDueDate(f.day_of_week, todayStr); if (!due) continue; }
      var inst = weekly ? due : monthPrefix;
      var ack = acks[f.id + '|' + inst] || null;
      var status = '', date = '', src;
      if (ack && ack.status === 'paid') { status = 'done'; date = toThaiLocal(ack.created_at).slice(0, 10); src = 'ack'; }
      else if (ack && ack.status === 'wait') { status = 'wait'; src = 'ack'; }
      else {
        var hitRef = matched.byId[weekly ? String(f.id) + '|' + due : String(f.id)];
        var hitRow = hitRef !== undefined ? findRowByRef(rows, hitRef) : null;
        if (hitRow) { status = 'done'; date = hitRow.at.slice(0, 10); }
        else if (weekly) status = (due <= todayStr) ? 'pending' : 'wait';
        else status = (f.day_of_month <= todayNum) ? 'pending' : 'wait';
        src = 'auto';
      }
      var yearly = strv(f.freq) === 'yearly';
      var row = {
        key: String(f.id), label: f.name, emoji: '', logo: fxLogo(f.name),
        amount_minor: f.amount_minor, day: weekly ? parseInt(due.slice(8, 10), 10) : f.day_of_month, dir: f.direction,
        status: status, date: date, spent_minor: 0, src: src,
        freq: weekly ? 'weekly' : (yearly ? 'yearly' : 'monthly'),
        month_of_year: yearly ? (parseInt(f.month_of_year, 10) || null) : null,
        category: strv(f.category)
      };
      if (weekly) { row.dow = validDow(f.day_of_week); row.due = due; }
      out.push(row);
    }
    return out;
  }

  // ---------- merchants: key → { display, category, hits } ----------
  function buildMerchantMap(merchantRows) {
    var map = {};
    for (var i = 0; i < merchantRows.length; i++) {
      var m = merchantRows[i];
      var parts = splitMerchantName(m.name);
      map[parts.key] = { id: m.id, key: parts.key, display: parts.display, category: m.category, hits: numv(m.hits) };
    }
    return map;
  }

  // ---------- แก้โดย CC — TASK_v42x_quickadd.md (3 ต.ค. 69): "รายการของฉัน" สำหรับ suggest ในฟอร์มรายการประจำ ----------
  // seed ข้อมูลตั้งต้นของเจ้าของ ณ 3 ต.ค. 69 (รายการที่ระบบรู้จากนอกแอป — forecast ฝั่งบอท) — data ไม่ใช่ logic
  // รีเฟรชได้ด้วยเครื่องมือ Hermes (เฟส 2) · ห้ามใช้ค่าในเทสต์
  var RECALL_SEED = [
    { name: 'Netflix', amount_minor: 10500, day: 13, cat: 'subscriptions', dir: 'out', freq: 'monthly' },
    { name: 'เติม TrueMoney', amount_minor: 70000, day: 8, cat: 'topup', dir: 'out', freq: 'monthly' },
    { name: 'งบน้ำมัน', amount_minor: 48000, day: 30, cat: 'fuel', dir: 'out', freq: 'monthly' }
  ];
  var RECALL_MAX = 40;
  // รวม recurring ∪ seed ∪ merchants ∪ ประวัติ (saved) เป็นชุดเดียว dedupe ด้วย key เดียวกับทั้งระบบ (merchantKeyFor/splitMerchantName)
  // แหล่งที่มาก่อนชนะ (rec → seed → mem → hist) · ช่องที่ยังว่างเติมจากแหล่งถัดไป · เรียง rec → seed → mem(hits) → hist(ล่าสุดก่อน)
  // seed ส่งมาแทนได้ (เทสต์ใช้ [] / ชุดสังเคราะห์) — ไม่ส่ง = RECALL_SEED
  function computeRecall(recurringRows, merchantRows, rows, seed) {
    var RANK = { rec: 0, seed: 1, mem: 2, hist: 3 };
    var map = {}, list = [];
    function keyOf(name, kind) {
      var k = merchantKeyFor(name, kind);
      return (k && k !== 'card:unknown') ? k : '';
    }
    function entry(key, src) {
      if (!key) return null;
      if (map[key]) return map[key];
      var e = { key: key, name: '', cat: '', amount_minor: 0, day: 0, dir: '', freq: '', month: null, dow: null, src: src, hits: 0, isRec: false, rid: '', _n: list.length };
      map[key] = e; list.push(e);
      return e;
    }
    function fill(e, o) {
      if (!e) return;
      if (!e.name && o.name) e.name = o.name;
      if (!e.cat && o.cat) e.cat = o.cat;
      if (!(e.amount_minor > 0) && o.amount_minor > 0) e.amount_minor = o.amount_minor;
      if (!(e.day > 0) && o.day > 0) e.day = o.day;
      if (!e.dir && o.dir) e.dir = o.dir;
      if (!e.freq && o.freq) { e.freq = o.freq; e.month = o.month || null; e.dow = (o.dow >= 0 && o.dow <= 6) ? o.dow : null; }  // แก้โดย CC — TASK_v42x_weekly.md (3 ต.ค. 69): + dow
      if (o.hits > e.hits) e.hits = o.hits;
    }
    // 1) recurring (id น้อย→มาก)
    var recs = (recurringRows || []).slice(0).sort(function (a, b) { return numv(a.id) - numv(b.id); });
    recs.forEach(function (f) {
      if (!f || f.active === false) return;
      var e = entry(keyOf(f.name), 'rec');
      if (!e) return;
      var yearly = strv(f.freq) === 'yearly';
      var wk = isWeekly(f);  // แก้โดย CC — TASK_v42x_weekly.md (3 ต.ค. 69): รายสัปดาห์ → freq weekly + dow (ไม่มี day)
      fill(e, { name: strv(f.name).trim(), cat: strv(f.category), amount_minor: numv(f.amount_minor), day: wk ? 0 : (parseInt(f.day_of_month, 10) || 0),
        dir: strv(f.direction) === 'in' ? 'in' : 'out', freq: wk ? 'weekly' : (yearly ? 'yearly' : 'monthly'), month: yearly ? (parseInt(f.month_of_year, 10) || null) : null,
        dow: wk ? validDow(f.day_of_week) : null });
      if (!e.isRec) { e.isRec = true; e.rid = String(f.id); }
    });
    // 2) seed
    (seed || []).forEach(function (s) {
      fill(entry(keyOf(s.name), 'seed'), { name: strv(s.name), cat: strv(s.cat), amount_minor: numv(s.amount_minor), day: numv(s.day),
        dir: strv(s.dir) || 'out', freq: strv(s.freq) || 'monthly', month: s.month || null });
    });
    // 3) merchants memory (hits มาก→น้อย · เสมอ → key)
    var mems = (merchantRows || []).map(function (m) {
      var p = splitMerchantName(m.name);
      return { key: p.key, display: p.display, cat: strv(m.category), hits: numv(m.hits) };
    }).filter(function (m) {
      return m.key && m.key !== 'card:unknown' && (m.display || m.key.indexOf('code:') !== 0);  // รหัสร้านล้วนไม่มีชื่อ = ไม่มีความหมายให้ suggest
    }).sort(function (a, b) { return (b.hits - a.hits) || (a.key < b.key ? -1 : (a.key > b.key ? 1 : 0)); });
    mems.forEach(function (m) { fill(entry(m.key, 'mem'), { name: m.display || m.key, cat: m.cat, hits: m.hits }); });
    // 4) ประวัติ saved (ล่าสุดก่อน — ต่อ key เอายอด/วันในเดือน/หมวดล่าสุด)
    var hist = (rows || []).filter(function (it) { return it && it.status === 'saved'; }).slice(0).sort(function (a, b) {
      if (a.at !== b.at) return a.at > b.at ? -1 : 1;
      return a.ref < b.ref ? -1 : (a.ref > b.ref ? 1 : 0);
    });
    hist.forEach(function (it) {
      var name = strv(it.display_name) || strv(it.counterparty).replace(/\s*\([^)]*\)\s*$/, '').trim();
      fill(entry(keyOf(it.counterparty, it.kind), 'hist'), { name: name, cat: strv(it.category), amount_minor: numv(it.amount_minor),
        day: parseInt(strv(it.at).slice(8, 10), 10) || 0, dir: it.direction === 'in' ? 'in' : 'out' });
    });
    list.sort(function (a, b) { return (RANK[a.src] - RANK[b.src]) || (a._n - b._n); });
    return list.filter(function (e) { return e.name; }).slice(0, RECALL_MAX).map(function (e) {
      return { key: e.key, name: e.name, brand: fxLogo(e.name), cat: e.cat, amount_minor: e.amount_minor, day: e.day,
        dir: e.dir || 'out', freq: e.freq || 'monthly', month: e.month, dow: e.dow, src: e.src, hits: e.hits, isRec: e.isRec, rid: e.rid };
    });
  }

  function fetchMerchants() {
    return sb.from('merchants').select('id,name,category,hits').then(function (r) {
      if (r.error) throw r.error;
      return r.data || [];
    });
  }
  function findMerchantByKey(merchantRows, key) {
    for (var i = 0; i < merchantRows.length; i++) {
      if (splitMerchantName(merchantRows[i].name).key === key) return merchantRows[i];
    }
    return null;
  }
  // อัปเดต/สร้างแถว merchants สำหรับ key นี้ — คง display เดิมไว้ถ้าไม่ได้สั่งเปลี่ยน (opts.display)
  function upsertMerchant(key, opts) {
    opts = opts || {};
    return fetchMerchants().then(function (merchantRows) {
      var found = findMerchantByKey(merchantRows, key);
      var display = (opts.display !== undefined) ? opts.display : (found ? splitMerchantName(found.name).display : '');
      var name = display ? (key + NAME_SEP + display) : key;
      var category = (opts.category !== undefined) ? opts.category : (found ? found.category : null);
      // แถวใหม่ (found=null) เริ่มที่ 1 เสมอ (ไม่ว่าจะเกิดจากบันทึกหมวดครั้งแรกหรือแค่ตั้งชื่อ) — บวกเพิ่มเฉพาะร้านที่เจอแล้วและมีการยืนยันหมวดจริง (bumpHits)
      var hits = found ? (numv(found.hits) + (opts.bumpHits ? 1 : 0)) : 1;
      if (found) {
        return sb.from('merchants').update({ name: name, category: category, hits: hits, last_seen: nowIso() }).eq('id', found.id);
      }
      return sb.from('merchants').insert({ user_id: CURRENT_UID, name: name, category: category, hits: hits, last_seen: nowIso() });
    }).then(function (r) { if (r && r.error) throw r.error; });
  }

  // ---------- getData ----------
  function getData() {
    return Promise.all([
      sb.from('transactions').select('*'),
      sb.from('merchants').select('id,name,category,hits'),
      sb.from('budgets').select('*'),
      sb.from('recurring').select('*'),
      sb.from('recurring_ack').select('*')
    ]).then(function (results) {
      for (var i = 0; i < results.length; i++) if (results[i].error) throw results[i].error;
      var txRows = results[0].data || [];
      var merchantRows = results[1].data || [];
      var budgetRows = results[2].data || [];
      var recurringRows = results[3].data || [];
      var ackRows = results[4].data || [];

      var merchMap = buildMerchantMap(merchantRows);
      var STATUS_IN = { confirmed: 'saved', new: 'new', skipped: 'skipped' };

      var nowLocal = toThaiLocal(nowIso());
      var monthPrefix = nowLocal.slice(0, 7);
      var todayNum = parseInt(nowLocal.slice(8, 10), 10);
      var todayStr = nowLocal.slice(0, 10);  // แก้โดย CC — TASK_v42x_weekly.md (3 ต.ค. 69): งวดรายสัปดาห์อิงวันนี้ (เวลาไทย)
      var nowDateObj = new Date(nowLocal);

      var dayKeys = [];
      var baseDate = new Date(nowLocal.slice(0, 10) + 'T00:00:00');
      for (var d = 8; d >= 0; d--) {
        var dt = new Date(baseDate.getTime() - d * 86400000);
        dayKeys.push(dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate()));
      }
      var daily = {};
      for (var dk = 0; dk < dayKeys.length; dk++) daily[dayKeys[dk]] = 0;

      var rows = txRows.map(function (r) {
        var key = merchantKeyFor(r.counterparty, r.kind);
        var mm = merchMap[key];
        return {
          at: toThaiLocal(r.at),
          ref: strv(r.ref),
          kind: strv(r.kind),
          direction: strv(r.direction),
          amount_minor: numv(r.amount_minor),
          counterparty: strv(r.counterparty),
          status: STATUS_IN[r.status] || 'new',
          category: strv(r.category),
          saved_at: toThaiLocal(r.confirmed_at),
          display_name: (mm && mm.display) ? mm.display : '',
          suggested: strv(r.suggested),
          bill_expect: 0, bill_returned: 0, bill_status: '',
          balance_minor: numv(r.balance_minor),
          account: strv(r.account)
        };
      });

      // แก้โดย Hermes 5 ต.ค. 69 (P สั่ง · เธรด "ปุ่มเปิด-ปิดรายการย่อยใน TrueMoney"): โหมดสรุปกระเป๋า — กรองตั้งแต่ต้นทาง
      var tmHiddenN = 0;
      if (!tmTrackOn_()) {
        var keepRows = [];
        for (var wr = 0; wr < rows.length; wr++) {
          if (isTmWalletRow_(rows[wr])) tmHiddenN++;
          else keepRows.push(rows[wr]);
        }
        rows = keepRows;
      }

      var pending = [], history = [], bills = [];
      var pendingSum = 0, monthSpent = 0, monthIncome = 0, skippedCount = 0;
      var monthOut = 0, walletIn = 0, walletCount = 0, walletSpent = 0, latestBalance = 0;
      // แก้โดย Hermes 3 ต.ค. 69 (บัคบัญชีของฉัน): การ์ด K PLUS = ยอดคงเหลือล่าสุดจากแถวจริง (คอลัมน์ balance_minor — เพิ่มใน migration 0008)
      //   · การ์ด TrueMoney = ยอดใช้จากกระเป๋าของ "เดือนล่าสุดที่มีข้อมูล" (statement ป้อนรายเดือน — เดือนว่างโชว์ 0 หลอกตา)
      var balAt = '';
      var walletByMonth = {};

      for (var ri = 0; ri < rows.length; ri++) {
        var it = rows[ri];
        if (it.status === 'skipped') { skippedCount++; continue; }
        var isIn = it.direction === 'in';
        var xf = isWalletXfer(it);
        it.xf = xf;
        it.acct = (isWalletKind(it) || strv(it.account).toLowerCase() === 'truemoney') ? 'truemoney' : 'kplus';
        if (it.balance_minor && (!balAt || it.at >= balAt)) { latestBalance = it.balance_minor; balAt = it.at; }
        if (!isIn) {
          var day = it.at.slice(0, 10);
          if (!xf && daily[day] !== undefined) daily[day] += it.amount_minor;
          if (!xf && isWalletKind(it)) { var wmk = it.at.slice(0, 7); walletByMonth[wmk] = (walletByMonth[wmk] || 0) + it.amount_minor; }
        }
        if (it.at.slice(0, 7) === monthPrefix) {
          if (isIn) monthIncome += it.amount_minor;
          else {
            monthOut += it.amount_minor;
            if (xf) { walletIn += it.amount_minor; walletCount++; }
            else {
              monthSpent += it.amount_minor;
              if (isWalletKind(it)) walletSpent += it.amount_minor;
            }
          }
        }
        if (it.status === 'saved') history.push(it);
        else { pending.push(it); if (!isIn) pendingSum += it.amount_minor; }
      }
      pending.sort(function (a, b) { return a.at < b.at ? -1 : (a.at > b.at ? 1 : 0); });
      history.sort(function (a, b) { return a.at > b.at ? -1 : (a.at < b.at ? 1 : 0); });

      var dailyArr = [];
      for (var k2 = 0; k2 < dayKeys.length; k2++) dailyArr.push({ d: dayKeys[k2], n: daily[dayKeys[k2]] });

      // แก้โดย CC — TASK_v42_recurring.md (3 ต.ค. 69): จับคู่รายการประจำครั้งเดียว → ใช้ทั้งในลิสต์รายการประจำ
      // และหัก tx ที่จับคู่แล้วออกจากยอด "ใช้ไป" ของงบรายหมวด (ชุดเดียวกัน — ตัวเลขสองที่ไม่เพี้ยนกัน)
      var matched = { byId: {}, refs: {} };
      try { matched = matchFixedRefs(recurringRows, rows, monthPrefix, todayStr); } catch (e) { /* keep default */ }
      var fx = [];
      try { fx = computeFixed(recurringRows, ackRows, rows, monthPrefix, todayNum, matched, todayStr); } catch (e) { fx = []; }
      var bud = { items: [], total: { spent_minor: 0, cap_minor: 0 } };
      try { bud = computeBudgets(budgetRows, rows, monthPrefix, nowDateObj, matched.refs); } catch (e) { /* keep default */ }
      var det = { months: [], acct: { kplus: { total_minor: 0, transfer_minor: 0, cats: [] }, truemoney: { total_minor: 0, transfer_minor: 0, cats: [] } } };
      try { det = computeDetail(rows, monthPrefix); } catch (e) { /* keep default */ }
      // แก้โดย CC — TASK_v42x_quickadd.md (3 ต.ค. 69): รายการของฉัน (suggest) — พังได้แต่ห้ามทำ getData ล้ม
      var recall = [];
      try { recall = computeRecall(recurringRows, merchantRows, rows, RECALL_SEED); } catch (e) { recall = []; }

      // แก้โดย Hermes 3 ต.ค. 69: เดือนล่าสุดที่มีข้อมูลใช้จากกระเป๋า (การ์ด TrueMoney ใช้ค่านี้เมื่อเดือนปัจจุบันว่าง)
      var tmMonth = '';
      for (var mk in walletByMonth) { if (walletByMonth[mk] > 0 && (!tmMonth || mk > tmMonth)) tmMonth = mk; }
      var tmSpent = tmMonth ? walletByMonth[tmMonth] : 0;

      var accts = {
        kplus: { balance_minor: latestBalance, out_minor: monthOut, in_minor: monthIncome },
        truemoney: { spent_minor: tmSpent, spent_month: tmMonth, spent_is_current: (tmMonth !== '' && tmMonth === monthPrefix),
                     in_minor: walletIn, remain_minor: Math.max(0, walletIn - walletSpent) }
      };
      var flow = {
        out_total: monthOut, spend: monthSpent, wallet_in: walletIn, wallet_count: walletCount,
        wallet_spent: walletSpent, wallet_remain: Math.max(0, walletIn - walletSpent)
      };

      return {
        ok: true,
        cats: WEB_CATS,
        main: WEB_MAIN,
        pending: pending,
        history: history.slice(0, 400),  // แก้โดย Hermes 4 ต.ค. 69: เพิ่มจาก 80 — แท็บประวัติแยกเดือน+แก้ได้ ต้องเห็นย้อนหลังครบ (ตอนนี้ 165 แถว/2 เดือน) · กันเพดานไว้ 400
        bills: bills,
        accts: accts,
        flow: flow,
        fixed: fx,
        budgets: bud.items,
        budgetTotals: bud.total,
        mdet: det.months,
        dacct: det.acct,
        recall: recall,  // แก้โดย CC — TASK_v42x_quickadd.md (3 ต.ค. 69)
        summary: {
          monthSpent: monthSpent, monthIncome: monthIncome, cashflow: monthIncome - monthSpent,
          pendingCount: pending.length, pendingSum: pendingSum,
          today: daily[dayKeys[dayKeys.length - 1]] || 0, daily: dailyArr,
          monthOut: monthOut, walletIn: walletIn, walletSpent: walletSpent, walletCount: walletCount
        },
        meta: {
          total: rows.length, savedCount: history.length, skippedCount: skippedCount,
          sheetUrl: '', logTail: [], genAt: nowLocal, triggerMinutes: 0,
          memCount: merchantRows.length, llmOn: false, mode: 'supabase', tmHiddenCount: tmHiddenN
        }
      };
    }).catch(function (e) {
      return { ok: false, msg: errText(e) };
    });
  }

  // ---------- actions ----------
  function validCategory(cat) {
    for (var i = 0; i < WEB_CATS.length; i++) if (WEB_CATS[i][0] === cat) return true;
    return false;
  }
  function getTxByRef(ref) {
    return sb.from('transactions').select('id,ref,counterparty,kind').eq('ref', ref).limit(1).then(function (r) {
      if (r.error) throw r.error;
      return (r.data && r.data[0]) || null;
    });
  }

  function saveCategory(ref, category) {
    if (!validCategory(category)) return Promise.resolve({ ok: false, msg: 'หมวดไม่ถูกต้อง' });
    if (!ref) return Promise.resolve({ ok: false, msg: 'ไม่พบรายการ' });
    return getTxByRef(ref).then(function (tx) {
      if (!tx) return { ok: false, msg: 'ไม่พบรายการนี้ในตาราง' };
      return sb.from('transactions').update({ status: 'confirmed', category: category, confirmed_at: nowIso() }).eq('ref', ref)
        .then(function (r) {
          if (r.error) throw r.error;
          var key = merchantKeyFor(tx.counterparty, tx.kind);
          if (key && key !== 'card:unknown') {
            return upsertMerchant(key, { category: category, bumpHits: true }).then(function () { return { ok: true }; });
          }
          return { ok: true };
        });
    }).catch(function (e) { return { ok: false, msg: errText(e) }; });
  }

  function skipItem(ref) {
    if (!ref) return Promise.resolve({ ok: false, msg: 'ไม่พบรายการ' });
    return sb.from('transactions').update({ status: 'skipped' }).eq('ref', ref).then(function (r) {
      if (r.error) throw r.error;
      return { ok: true };
    }).catch(function (e) { return { ok: false, msg: errText(e) }; });
  }

  function undoSkip(ref) {
    if (!ref) return Promise.resolve({ ok: false, msg: 'ไม่พบรายการ' });
    return sb.from('transactions').update({ status: 'new' }).eq('ref', ref).then(function (r) {
      if (r.error) throw r.error;
      return { ok: true };
    }).catch(function (e) { return { ok: false, msg: errText(e) }; });
  }

  // แก้โดย Hermes 4 ต.ค. 69 (P สั่ง · เธรดประวัติ): คืนแถวที่บันทึกแล้ว → 'new' (กลับเข้าคิว "รอยืนยัน") — ใช้กับปุ่ม ↩︎ ในแท็บประวัติ
  function unsaveItem(ref) {
    if (!ref) return Promise.resolve({ ok: false, msg: 'ไม่พบรายการ' });
    return sb.from('transactions').update({ status: 'new' }).eq('ref', ref).then(function (r) {
      if (r.error) throw r.error;
      return { ok: true };
    }).catch(function (e) { return { ok: false, msg: errText(e) }; });
  }

  function renameMerchant(ref, name) {
    name = strv(name).replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!ref || !name) return Promise.resolve({ ok: false, msg: 'ข้อมูลไม่ครบ' });
    return getTxByRef(ref).then(function (tx) {
      if (!tx) return { ok: false, msg: 'ไม่พบรายการนี้ในตาราง' };
      var key = merchantKeyFor(tx.counterparty, tx.kind);
      if (!key || key === 'card:unknown') {
        return { ok: false, msg: 'รูดการ์ดที่ไม่มีรหัสร้าน ยังตั้งชื่อแยกไม่ได้ในโหมดนี้ (ต้องรอ P5)' };
      }
      return upsertMerchant(key, { display: name }).then(function () { return { ok: true }; });
    }).catch(function (e) { return { ok: false, msg: errText(e) }; });
  }

  function setBudget(key, patch) {
    key = strv(key).replace(/[^a-z0-9\-_]/gi, '').slice(0, 32);
    if (!key) return Promise.resolve({ ok: false, msg: 'ข้อมูลไม่ครบ' });
    patch = patch || {};
    return sb.from('budgets').select('*').eq('key', key).limit(1).then(function (r) {
      if (r.error) throw r.error;
      var existing = (r.data && r.data[0]) || null;
      var row = {
        user_id: CURRENT_UID,
        key: key,
        label: patch.label !== undefined ? strv(patch.label).slice(0, 120) : (existing ? existing.label : key),
        emoji: patch.emoji !== undefined ? strv(patch.emoji).slice(0, 16) : (existing ? existing.emoji : ''),
        cats: patch.cats !== undefined ? strv(patch.cats).slice(0, 120) : (existing ? existing.cats : ''),
        cap_per_day: patch.cap_per_day !== undefined ? numv(patch.cap_per_day) : (existing ? existing.cap_per_day : 0),
        cap_minor: patch.cap_minor !== undefined ? numv(patch.cap_minor) : (existing ? existing.cap_minor : 0),
        day: patch.day !== undefined ? numv(patch.day) : (existing ? existing.day : 0),
        active: patch.active !== undefined ? !!Number(patch.active) : (existing ? existing.active : true)
      };
      if (existing) return sb.from('budgets').update(row).eq('id', existing.id);
      return sb.from('budgets').insert(row);
    }).then(function (r) {
      if (r.error) throw r.error;
      return { ok: true };
    }).catch(function (e) { return { ok: false, msg: errText(e) }; });
  }

  // แก้โดย Hermes 4 ต.ค. 69 (P สั่ง · เธรด 🛒): ลบงบรายหมวดทั้งแถว (ปุ่ม 🗑 ในกางแถวการ์ดปฏิทิน)
  function deleteBudget(key) {
    key = strv(key).replace(/[^a-z0-9\-_]/gi, '').slice(0, 32);
    if (!key) return Promise.resolve({ ok: false, msg: 'ข้อมูลไม่ครบ' });
    return sb.from('budgets').delete().eq('key', key).then(function (r) {
      if (r.error) throw r.error;
      return { ok: true };
    }).catch(function (e) { return { ok: false, msg: errText(e) }; });
  }

  // แก้โดย CC — TASK_v42x_weekly.md (3 ต.ค. 69): พารามิเตอร์ที่ 3 instDate = วันที่ของ "งวดนี้" (เฉพาะ weekly)
  //   อ่าน freq ของรายการก่อน → monthly/yearly: month = เดือนปัจจุบัน YYYY-MM (เดิมเป๊ะ · instDate ไม่สน)
  //   weekly: ต้องส่ง instDate 'YYYY-MM-DD' ที่มีจริง · ห่างวันนี้ไม่เกิน ±8 วัน · ตรงวันในสัปดาห์ของรายการ → ใช้เป็น month key
  //   ('auto' = ลบ ack เฉพาะงวดนั้น — งวดอื่นไม่โดน)
  // แก้โดย CC — TASK_cc_fix_v42x.md (3 ต.ค. 69): ล็อก weekly ให้แคบ — instDate ต้องเป็น "งวดปัจจุบัน" เท่านั้น:
  //   weeklyDueDate(dow, วันนี้) หรือ weeklyDueDate(dow, เมื่อวาน) (เผื่อแท็บค้างข้ามเที่ยงคืน) · นอกนั้น (เช่น due+7 / due−14) = ไม่รับ
  function ackFixed(key, status, instDate) {
    var recurringId = parseInt(key, 10);
    status = (status === 'done') ? 'done' : (status === 'wait' ? 'wait' : (status === 'auto' ? 'auto' : ''));
    if (!recurringId || !status) return Promise.resolve({ ok: false, msg: 'ข้อมูลไม่ครบ' });
    var month = thaiNowParts().ym;
    return sb.from('recurring').select('id,freq,day_of_week').eq('id', recurringId).limit(1).then(function (rr0) {
      if (rr0.error) throw rr0.error;
      var rec = (rr0.data && rr0.data[0]) || null;
      if (rec && isWeekly(rec)) {
        var inst = strv(instDate), today = thaiNowParts().ymd;
        if (!isFinite(ymdMs(inst))) return { ok: false, msg: 'รายการรายสัปดาห์ต้องระบุงวด (วันที่ไม่ถูกต้อง)' };
        // แก้โดย CC — TASK_cc_fix_v42x.md (3 ต.ค. 69): แทนเช็ค ±8 วัน + dow เดิม (งวดที่รับได้ตรง dow อยู่แล้ว)
        var curInst = weeklyDueDate(rec.day_of_week, today);
        var prevInst = weeklyDueDate(rec.day_of_week, msYmd(ymdMs(today) - DAY_MS));
        if (!curInst || (inst !== curInst && inst !== prevInst)) return { ok: false, msg: 'ไม่ใช่วันงวดปัจจุบัน — รีเฟรชแล้วลองใหม่' };
        month = inst;
      }
      return ackWrite(recurringId, month, status);
    }).catch(function (e) { return { ok: false, msg: errText(e) }; });
  }
  function ackWrite(recurringId, month, status) {
    return sb.from('recurring_ack').select('id').eq('recurring_id', recurringId).eq('month', month).limit(1).then(function (r) {
      if (r.error) throw r.error;
      var existing = (r.data && r.data[0]) || null;
      if (status === 'auto') {
        if (!existing) return { ok: true };
        return sb.from('recurring_ack').delete().eq('id', existing.id).then(function (rr) {
          if (rr.error) throw rr.error;
          return { ok: true };
        });
      }
      var dbStatus = status === 'done' ? 'paid' : 'wait';
      if (existing) {
        return sb.from('recurring_ack').update({ status: dbStatus }).eq('id', existing.id).then(function (rr) {
          if (rr.error) throw rr.error;
          return { ok: true };
        });
      }
      return sb.from('recurring_ack').insert({ user_id: CURRENT_UID, recurring_id: recurringId, month: month, status: dbStatus }).then(function (rr) {
        if (rr.error) throw rr.error;
        return { ok: true };
      });
    }).catch(function (e) { return { ok: false, msg: errText(e) }; });
  }

  function appendIncome(label, amountMinor, atDate) {
    var v = Math.round(Number(amountMinor));
    label = strv(label).replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!(v > 0)) return Promise.resolve({ ok: false, msg: 'ยอดไม่ถูกต้อง' });
    if (!label) return Promise.resolve({ ok: false, msg: 'ใส่ชื่อรายรับด้วย' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(strv(atDate))) return Promise.resolve({ ok: false, msg: 'วันที่ไม่ถูกต้อง' });
    var ref = 'MANIN-' + String(atDate).replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    var row = {
      user_id: CURRENT_UID, at: atDate + 'T12:00:00+07:00', ref: ref, kind: 'manual_in', direction: 'in',
      amount_minor: v, fee_minor: 0, account: 'Manual', counterparty: label, category: 'income',
      source: 'manual', status: 'confirmed', confirmed_at: nowIso()
    };
    return sb.from('transactions').insert(row).then(function (r) {
      if (r.error) throw r.error;
      return { ok: true, ref: ref };
    }).catch(function (e) { return { ok: false, msg: errText(e) }; });
  }

  // แก้โดย CC — TASK_v42_recurring.md (3 ต.ค. 69): เพิ่ม/ลบรายการประจำจากในแอป (รายเดือน/รายปี · หมวดไม่บังคับ)
  function isIntIn(v, lo, hi) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= lo && v <= hi; }
  function blank(v) { return v === undefined || v === null || v === ''; }
  function addRecurring(payload) {
    var p = payload || {};
    var name = strv(p.name).replace(/\s+/g, ' ').trim();
    if (!name || name.length > 60) return Promise.resolve({ ok: false, msg: 'ใส่ชื่อรายการ (ไม่เกิน 60 ตัวอักษร)' });
    var amt = p.amount_minor;
    // แก้โดย CC — TASK_cc_fix_v42.md (3 ต.ค. 69): ต้องเป็น number จริง (ไม่รับ true/[5]/สตริง ที่ Number() แปลงผ่าน)
    if (typeof amt !== 'number' || !isIntIn(amt, 1, Number.MAX_SAFE_INTEGER)) return Promise.resolve({ ok: false, msg: 'ยอดไม่ถูกต้อง' });
    // แก้โดย CC — TASK_v42x_weekly.md (3 ต.ค. 69): รับ freq 'weekly' — ต้องมี dow 0–6 (0=อา … 6=ส) · ไม่ใช้ day (ไม่เช็ค 1–31)
    var freq = blank(p.freq) ? 'monthly' : strv(p.freq);
    if (freq !== 'monthly' && freq !== 'yearly' && freq !== 'weekly') return Promise.resolve({ ok: false, msg: 'ความถี่ไม่ถูกต้อง' });
    var dow = null;
    if (freq === 'weekly') {
      dow = Number(p.dow);
      if (blank(p.dow) || typeof p.dow === 'boolean' || !isIntIn(dow, 0, 6)) return Promise.resolve({ ok: false, msg: 'รายการรายสัปดาห์ต้องเลือกวัน (อา–ส)' });
    }
    var day = Number(p.day);
    if (freq !== 'weekly' && (blank(p.day) || !isIntIn(day, 1, 31))) return Promise.resolve({ ok: false, msg: 'วันที่จ่ายต้องเป็น 1–31' });
    var direction = blank(p.direction) ? 'out' : strv(p.direction);
    if (direction !== 'in' && direction !== 'out') return Promise.resolve({ ok: false, msg: 'ประเภทไม่ถูกต้อง (จ่าย/รับ)' });
    var month = null;
    if (freq === 'yearly') {
      month = Number(p.month);
      if (blank(p.month) || !isIntIn(month, 1, 12)) return Promise.resolve({ ok: false, msg: 'รายการรายปีต้องเลือกเดือน' });
    }
    var category = strv(p.category).trim();
    if (category && !validCategory(category)) return Promise.resolve({ ok: false, msg: 'หมวดไม่ถูกต้อง' });
    var row = {
      user_id: CURRENT_UID, name: name, amount_minor: amt, day_of_month: day, kind: null, active: true,
      direction: direction, freq: freq, month_of_year: month, category: category || null
    };
    if (freq === 'weekly') { row.day_of_month = null; row.day_of_week = dow; }  // แก้โดย CC — TASK_v42x_weekly.md (3 ต.ค. 69): monthly/yearly payload เดิมเป๊ะ
    return sb.from('recurring').insert(row).select('id').then(function (r) {
      if (r.error) throw r.error;
      var d = r.data;
      var id = (d && d[0] && d[0].id !== undefined) ? d[0].id : null;
      rememberRecurringName(name, category);  // แก้โดย CC — TASK_v42x_quickadd.md (3 ต.ค. 69)
      return { ok: true, id: id };
    }).catch(function (e) { return { ok: false, msg: errText(e) }; });
  }
  // แก้โดย CC — TASK_v42x_quickadd.md (3 ต.ค. 69): "จำชื่อใหม่" — หลังเพิ่มรายการประจำสำเร็จ upsert ชื่อเข้า merchants memory
  // (ครั้งถัดไปขึ้น suggest + ติดโลโก้) · ผ่าน upsertMerchant เดิม · ไม่ bumpHits (แถวใหม่ = 1 ตามกติกาเดิม · แถวเดิม hits คงเดิม)
  // ไม่ทับชื่อที่ตั้งไว้/หมวดที่เรียนแล้ว · ทำแยกจังหวะ (ไม่รอ) และกลืน error — พังได้แต่ห้ามกระทบ { ok:true } ของ recurring
  function rememberRecurringName(name, category) {
    setTimeout(function () {
      try {
        var key = merchantKeyFor(name, '');
        if (!key || key === 'card:unknown') return;
        fetchMerchants().then(function (merchantRows) {
          var found = findMerchantByKey(merchantRows, key);
          var opts = {};
          if (!found || !splitMerchantName(found.name).display) opts.display = name;
          if (category && (!found || !found.category)) opts.category = category;
          if (found && opts.display === undefined && opts.category === undefined) return null;
          return upsertMerchant(key, opts);
        }).catch(function () { /* เงียบ — ไม่กระทบ flow หลัก */ });
      } catch (e) { /* เงียบ */ }
    }, 0);
  }
  function removeRecurring(id) {
    var rid = Number(id);
    if (blank(id) || !isIntIn(rid, 1, Number.MAX_SAFE_INTEGER)) return Promise.resolve({ ok: false, msg: 'ไม่พบรายการ' });
    // recurring_ack ผูก FK on delete cascade → ลบตามเอง
    // แก้โดย CC — TASK_cc_fix_v42.md (3 ต.ค. 69): .select('id') → รู้ว่าลบจริงไหม (0 แถว = ไม่พบ/ไม่มีสิทธิ์ตาม RLS)
    return sb.from('recurring').delete().eq('id', rid).select('id').then(function (r) {
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) return { ok: false, msg: 'ไม่พบรายการนี้ (อาจถูกลบไปแล้ว)' };
      return { ok: true };
    }).catch(function (e) { return { ok: false, msg: errText(e) }; });
  }

  // แก้โดย CC — TASK_v42x_weekly.md (3 ต.ค. 69): เปิดตัวช่วยบริสุทธิ์ของรายการประจำให้เทสต์ offline เรียกตรง (อ่านอย่างเดียว · ไม่แตะ DB)
  window.NKF_FX = {
    TH_DOW: TH_DOW.slice(0), weeklyDueDate: weeklyDueDate, weeklyWindow: weeklyWindow, weeklyDotDays: weeklyDotDays,
    isDueMonth: isDueMonth, matchFixedRefs: matchFixedRefs, computeFixed: computeFixed,
    computeBudgets: computeBudgets  // แก้โดย CC — TASK_cc_fix_v42x.md (3 ต.ค. 69): ให้เทสต์ยอดงบรายวันด้วยวันอ้างอิงตายตัว
  };

  var ACTIONS = {
    getData: getData,
    saveCategory: saveCategory,
    skipItem: skipItem,
    undoSkip: undoSkip,
    unsaveItem: unsaveItem,  // แก้โดย Hermes 4 ต.ค. 69: แถวบันทึกแล้ว → กลับเป็นรอยืนยัน (ปุ่ม ↩︎ ในแท็บประวัติ)
    renameMerchant: renameMerchant,
    markBill: notMoved,
    addBillReturn: notMoved,
    closeBill: notMoved,
    unmarkBill: notMoved,
    appendIncome: appendIncome,
    ackFixed: ackFixed,
    setBudget: setBudget,
    deleteBudget: deleteBudget,  // แก้โดย Hermes 4 ต.ค. 69: ลบงบรายหมวด (การ์ดปฏิทิน → กางแถว → 🗑)
    addRecurring: addRecurring,        // แก้โดย CC — TASK_v42_recurring.md (3 ต.ค. 69)
    removeRecurring: removeRecurring,  // แก้โดย CC — TASK_v42_recurring.md (3 ต.ค. 69)
    importStatement: function (account, rows, meta) {
      // P5: ย้ายมาโหมดใหม่แล้ว — เขียนตรงผ่าน RPC "ingest_statement" (ประตูเดียว: ตรวจแถว/กันซ้ำ ref/ข้ามเงินเข้า/แคป 300)
      if (!CURRENT_UID) return Promise.resolve({ ok: false, msg: 'ยังไม่ได้ล็อกอิน — เข้าสู่ระบบก่อนนำเข้า' });
      if (!rows || !rows.length) return Promise.resolve({ ok: false, msg: 'ไม่มีรายการ' });
      var payload = rows.slice(0, 300).map(function (r) {
        return {
          at: strv(r.at),
          direction: (String(r.direction) === 'in') ? 'in' : 'out',
          amount_minor: Math.round(numv(r.amount_minor)),
          detail: strv(r.detail),
          wallet: !!r.wallet
        };
      });
      var m = meta || {};
      return sb.rpc('ingest_statement', {
        p_account: (String(account || '') === 'truemoney') ? 'truemoney' : 'kplus',
        p_rows: payload,
        p_source: strv(m.source) || 'upload',
        p_file_name: strv(m.file) || null
      }).then(function (r) {
        if (r.error) throw r.error;
        var d = r.data || {};
        if (!d.ok) return { ok: false, msg: d.msg || 'นำเข้าไม่สำเร็จ' };
        return { ok: true, added: d.added, dup: d.dup, skipped: d.skipped, in_skip: d.in_skip };
      }).catch(function (e) { return { ok: false, msg: errText(e) }; });
    },
    notifyText: function () { return legacyCall('notifyText', Array.prototype.slice.call(arguments)); },
    debugFallback: function () { return legacyCall('debugFallback', Array.prototype.slice.call(arguments)); }
  };

  // ---------- google.script.run shim (Proxy เดิมของ static-host bridge) ----------
  var _hnd = { ok: null, err: null };
  var _proxy = null;
  var _base = {
    withSuccessHandler: function (f) { _hnd.ok = f; return _proxy; },
    withFailureHandler: function (f) { _hnd.err = f; return _proxy; }
  };
  _proxy = new Proxy(_base, {
    get: function (t, k) {
      if (k in t) return t[k];
      if (typeof k !== 'string') return undefined;
      var fn = ACTIONS[k];
      return function () {
        var args = Array.prototype.slice.call(arguments);
        var ok = _hnd.ok, err = _hnd.err;
        _hnd.ok = null; _hnd.err = null;
        if (!fn) { if (ok) ok({ ok: false, msg: 'ไม่รู้จักคำสั่ง: ' + k }); return; }
        var result;
        try { result = fn.apply(null, args); } catch (e) { result = Promise.reject(e); }
        Promise.resolve(result).then(function (res) {
          if (ok) ok((res === undefined || res === null) ? { ok: false, msg: 'ว่างเปล่า' } : res);
        }).catch(function (e) {
          if (err) err(e); else if (ok) ok({ ok: false, msg: errText(e) });
        });
      };
    }
  });
  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = _proxy;
})();
