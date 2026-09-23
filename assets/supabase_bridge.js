/**
 * supabase_bridge.js — แก้โดย CC 23 ก.ย. 69 (TASK_p4_pwa_supabase)
 *
 * ให้ App.html เรียก google.script.run.<action>(...) ได้เหมือนเดิมทุกจุด (Proxy เดิมของ static-host)
 * แต่ครั้งนี้แอ็กชันส่วนใหญ่ (ดูตาราง TASK_p4_pwa_supabase.md ข้อ B) วิ่งไป Supabase (anon key + RLS)
 * แทนที่จะยิง JSONP ไป Apps Script — เหลือ importStatement/notifyText/debugFallback ที่ยังเป็นโหมดเดิม (P5 ยังไม่ย้าย)
 * และ markBill/addBillReturn/closeBill/unmarkBill ที่ยังไม่มีตารางใน Supabase v1 (คืน ok:false เสมอ)
 *
 * โหลดหลัง assets/vendor/supabase-js.js และก่อน App.html inline <script> (build_static.py ฉีดลำดับนี้ให้)
 * ต้องมี window.NKF_SB = { url, anon } มาก่อน (มาจาก build_static.py อ่าน .env) — ไม่มี = ไม่ทำอะไรเลย (ตกไปโหมดเดโม่)
 */
(function () {
  'use strict';

  // ---------- มิเรอร์ค่าคงที่จาก Web.gs (ห้ามแก้ Web.gs — คัดลอกมาเพื่อคำนวณฝั่งนี้) ----------
  var WEB_CATS = [
    ['food', '🍽️', 'อาหาร'],
    ['transport', '🚕', 'เดินทาง'],
    ['house', '🏠', 'บ้าน'],
    ['subscriptions', '🔁', 'สมาชิก'],
    ['fuel', '⛽', 'น้ำมัน'],
    ['topup', '💳', 'เติมเงิน'],
    ['income', '💰', 'รายรับ'],
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
  var WEB_MAIN = ['food', 'transport', 'house', 'subscriptions', 'fuel', 'topup', 'income', 'entertainment'];

  // เก็บ "ชื่อที่พี่ตั้ง" ไว้ในคอลัมน์ merchants.name เดียวกับคีย์จับคู่ (ตาราง merchants ไม่มีคอลัมน์แยก
  // เพราะ migrations ของ P1/P3 ห้ามแตะ) — รูปแบบ "<key><SEP><display>" · ไม่มี SEP = ยังไม่เคยตั้งชื่อ
  var NAME_SEP = '||';

  // ยังใช้ต่อกับ 3 แอ็กชันที่ยังไม่ย้าย (importStatement/notifyText/debugFallback) — token เดิมของ static host
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
  var _authCb = null;
  window.NKF_AUTH = {
    init: function (cb) {
      _authCb = cb;
      sb.auth.onAuthStateChange(function (_evt, session) {
        CURRENT_UID = (session && session.user) ? session.user.id : null;
        if (_authCb) _authCb(session || null);
      });
      sb.auth.getSession().then(function (r) {
        var session = (r && r.data) ? r.data.session : null;
        CURRENT_UID = (session && session.user) ? session.user.id : null;
        if (_authCb) _authCb(session || null);
      });
    },
    signIn: function (email, password, cb) {
      sb.auth.signInWithPassword({ email: strv(email).trim(), password: strv(password) })
        .then(function (r) { cb(r.error ? errText(r.error) : null); })
        .catch(function (e) { cb(errText(e)); });
    },
    signOut: function (cb) {
      sb.auth.signOut().then(function () { if (cb) cb(); }).catch(function () { if (cb) cb(); });
    }
  };

  // ---------- legacy JSONP (importStatement/notifyText/debugFallback เท่านั้น — P5 ยังไม่ย้าย) ----------
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
      if (!tok) { resolve({ ok: false, msg: 'ฟีเจอร์นี้ยังไม่ย้ายมาโหมดใหม่ (P5) — ต้องมีลิงก์ส่วนตัวเดิม' }); return; }
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
  function notMoved() { return Promise.resolve({ ok: false, msg: 'ยังไม่ย้ายมาโหมดใหม่ (P5)' }); }

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

  // ---------- มิเรอร์ computeBudgets_ ใน Web.gs (data source = ตาราง budgets แทนแท็บชีต) ----------
  function computeBudgets(budgetRows, rows, monthPrefix, nowDate) {
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
  function fxLogo(name) {
    var s = (name || '').toLowerCase();
    if (/claude/.test(s)) return 'claude';
    if (/netflix/.test(s)) return 'netflix';
    if (/truemoney|ทรูมันนี่/.test(s)) return 'truemoney';
    return '';
  }
  function computeFixed(recurringRows, ackRows, rows, monthPrefix, todayNum) {
    var acks = {};
    for (var i = 0; i < ackRows.length; i++) {
      var a = ackRows[i];
      acks[a.recurring_id + '|' + a.month] = a;
    }
    var out = [];
    for (var j = 0; j < recurringRows.length; j++) {
      var f = recurringRows[j];
      if (f.active === false) continue;
      var ack = acks[f.id + '|' + monthPrefix] || null;
      var status = '', date = '', src;
      if (ack && ack.status === 'paid') { status = 'done'; date = toThaiLocal(ack.created_at).slice(0, 10); src = 'ack'; }
      else if (ack && ack.status === 'wait') { status = 'wait'; src = 'ack'; }
      else {
        var hit = '';
        for (var r = 0; r < rows.length; r++) {
          var it = rows[r];
          if (it.status !== 'saved' || it.direction !== f.direction) continue;
          if (it.at.slice(0, 7) !== monthPrefix) continue;
          if (isWalletXfer(it)) continue;
          var tol = Math.max(Math.round(f.amount_minor * 0.005), 50);
          if (Math.abs(it.amount_minor - f.amount_minor) <= tol) { hit = it.at.slice(0, 10); break; }
        }
        if (hit) { status = 'done'; date = hit; } else status = (f.day_of_month <= todayNum) ? 'pending' : 'wait';
        src = 'auto';
      }
      out.push({
        key: String(f.id), label: f.name, emoji: '', logo: fxLogo(f.name),
        amount_minor: f.amount_minor, day: f.day_of_month, dir: f.direction,
        status: status, date: date, spent_minor: 0, src: src
      });
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
          balance_minor: 0,
          account: strv(r.account)
        };
      });

      var pending = [], history = [], bills = [];
      var pendingSum = 0, monthSpent = 0, monthIncome = 0, skippedCount = 0;
      var monthOut = 0, walletIn = 0, walletCount = 0, walletSpent = 0, latestBalance = 0;

      for (var ri = 0; ri < rows.length; ri++) {
        var it = rows[ri];
        if (it.status === 'skipped') { skippedCount++; continue; }
        var isIn = it.direction === 'in';
        var xf = isWalletXfer(it);
        it.xf = xf;
        it.acct = (isWalletKind(it) || strv(it.account).toLowerCase() === 'truemoney') ? 'truemoney' : 'kplus';
        if (!isIn) {
          var day = it.at.slice(0, 10);
          if (!xf && daily[day] !== undefined) daily[day] += it.amount_minor;
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

      var fx = [];
      try { fx = computeFixed(recurringRows, ackRows, rows, monthPrefix, todayNum); } catch (e) { fx = []; }
      var bud = { items: [], total: { spent_minor: 0, cap_minor: 0 } };
      try { bud = computeBudgets(budgetRows, rows, monthPrefix, nowDateObj); } catch (e) { /* keep default */ }
      var det = { months: [], acct: { kplus: { total_minor: 0, transfer_minor: 0, cats: [] }, truemoney: { total_minor: 0, transfer_minor: 0, cats: [] } } };
      try { det = computeDetail(rows, monthPrefix); } catch (e) { /* keep default */ }

      var accts = {
        kplus: { balance_minor: latestBalance, out_minor: monthOut, in_minor: monthIncome },
        truemoney: { spent_minor: walletSpent, in_minor: walletIn, remain_minor: Math.max(0, walletIn - walletSpent) }
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
        history: history.slice(0, 80),
        bills: bills,
        accts: accts,
        flow: flow,
        fixed: fx,
        budgets: bud.items,
        budgetTotals: bud.total,
        mdet: det.months,
        dacct: det.acct,
        summary: {
          monthSpent: monthSpent, monthIncome: monthIncome, cashflow: monthIncome - monthSpent,
          pendingCount: pending.length, pendingSum: pendingSum,
          today: daily[dayKeys[dayKeys.length - 1]] || 0, daily: dailyArr,
          monthOut: monthOut, walletIn: walletIn, walletSpent: walletSpent, walletCount: walletCount
        },
        meta: {
          total: rows.length, savedCount: history.length, skippedCount: skippedCount,
          sheetUrl: '', logTail: [], genAt: nowLocal, triggerMinutes: 0,
          memCount: merchantRows.length, llmOn: false, mode: 'supabase'
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

  function ackFixed(key, status) {
    var recurringId = parseInt(key, 10);
    status = (status === 'done') ? 'done' : (status === 'wait' ? 'wait' : (status === 'auto' ? 'auto' : ''));
    if (!recurringId || !status) return Promise.resolve({ ok: false, msg: 'ข้อมูลไม่ครบ' });
    var month = thaiNowParts().ym;
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

  var ACTIONS = {
    getData: getData,
    saveCategory: saveCategory,
    skipItem: skipItem,
    undoSkip: undoSkip,
    renameMerchant: renameMerchant,
    markBill: notMoved,
    addBillReturn: notMoved,
    closeBill: notMoved,
    unmarkBill: notMoved,
    appendIncome: appendIncome,
    ackFixed: ackFixed,
    setBudget: setBudget,
    importStatement: function () { return legacyCall('importStatement', Array.prototype.slice.call(arguments)); },
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
