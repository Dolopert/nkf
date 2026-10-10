/* billshare_calc.js — CC 9 ต.ค. 69 (TASK_cc_billbox_share · รอบ 3 บิลแชร์)
 *
 * ตัวคำนวณ "บิลแชร์" ชุดเดียวที่ใช้ร่วม 3 ที่: แอปเจ้าของ (App.html) · bridge (ตอนสรุปเข้าบิลรอคืน) · หน้าเพื่อน (share/index.html)
 * กติกาเงิน (ตาม bill_split.py + tools/billshare_logic_check.py):
 *   - จำนวนเต็ม "สตางค์" ตลอด · เปอร์เซ็นต์เก็บเป็น basis points (700 = 7%) → คิดแบบเศษส่วนเป๊ะด้วย BigInt (ไม่มี float)
 *   - ต่อคน: ยอดรายการ × (1 + เซอร์วิส) × (1 + VAT) → floor → แจกเศษ (ยอดจ่ายจริง − Σ floor) ทีละ 1 สตางค์
 *     ให้คนที่เศษมากสุดก่อน (largest remainder · เสมอกัน = ลำดับก่อน) → Σ ต่อคน = ยอดจ่ายจริงเป๊ะ (diff 0.00)
 *   - เศษที่ต้องแจกต้องอยู่ในช่วง 0..จำนวนคน (≤ 1 สตางค์ต่อคน) — นอกช่วง = รายการไม่ตรงบิลจริง → ห้ามเงียบ (ok:false + diff)
 * ไม่มี DOM/เน็ต — require ได้ใน node (เทสต์) และโหลดเป็น <script> ในเบราว์เซอร์ (window.NKF_BS)
 */
(function (root) {
  'use strict';
  var HUNDRED_PCT = 10000n;            // basis points
  var MAX_ITEMS = 100;
  var MAX_PRICE_MINOR = 10000000;      // ฿100,000 ต่อบรรทัด
  var MAX_QTY = 20;

  function big(n) { return BigInt(Math.round(Number(n) || 0)); }
  function factorDen() { return HUNDRED_PCT * HUNDRED_PCT; }
  function factorNum(svcBp, vatBp) { return (HUNDRED_PCT + big(svcBp)) * (HUNDRED_PCT + big(vatBp)); }

  // ยอดเต็มของรายการชุดหนึ่ง (half-up ทั้งก้อน) — ใช้เทียบกับยอดจ่ายจริงตอนสร้างบิล
  function grossOf(subMinor, svcBp, vatBp) {
    var num = big(subMinor) * factorNum(svcBp, vatBp), den = factorDen();
    return Number((num * 2n + den) / (2n * den));   // half-up (ค่าบวกเสมอ)
  }

  // ต่อคน → ยอดเป๊ะ: subs = [สตางค์ต่อคน] · target = ยอดจ่ายจริง
  // คืน { ok, per[], remainder, diff, calc } — calc = Σ half-up ต่อคนแบบดิบ (ไว้โชว์) · diff = target − ยอดเต็มจากรายการ
  function alloc(subs, targetMinor, svcBp, vatBp) {
    var fnum = factorNum(svcBp, vatBp), den = factorDen();
    var n = subs.length;
    var floors = [], fracs = [], sumFloor = 0n;
    for (var i = 0; i < n; i++) {
      var num = big(subs[i]) * fnum;
      var fl = num / den;
      floors.push(fl);
      fracs.push(num - fl * den);
      sumFloor += fl;
    }
    var subTotal = 0;
    for (var k = 0; k < n; k++) subTotal += Number(subs[k]) || 0;
    var gross = grossOf(subTotal, svcBp, vatBp);
    var target = big(targetMinor);
    var remainder = target - sumFloor;
    var res = { ok: false, per: [], remainder: Number(remainder), diff: Number(target) - gross, gross: gross };
    if (n === 0 || remainder < 0n || remainder > BigInt(n)) {
      res.per = floors.map(function (f, j) { return Number(fracs[j] * 2n >= den ? f + 1n : f); });   // ไว้โชว์ (ยังไม่ดุล)
      return res;
    }
    var order = [];
    for (var o = 0; o < n; o++) order.push(o);
    order.sort(function (a, b) { return fracs[a] === fracs[b] ? a - b : (fracs[a] > fracs[b] ? -1 : 1); });
    var out = floors.slice();
    for (var r = 0; r < Number(remainder); r++) out[order[r]] += 1n;
    res.ok = true;
    res.per = out.map(Number);
    return res;
  }

  // ยอดประมาณการต่อคน (ระหว่างที่ยังติ๊กไม่ครบ) — half-up ของส่วนตัวเอง · ตัวสุดท้ายอาจขยับ ±1 สตางค์ตอนสรุป
  function estimate(subMinor, svcBp, vatBp) { return grossOf(subMinor, svcBp, vatBp); }

  // แยกราคาบรรทัดเดียวเป็น n ส่วน โดยเก็บหน่วยสตางค์ตลอดทาง
  // เศษต้องไปส่วนท้าย (ไม่ใช่ปัดทุกส่วนแยกกัน) เพื่อให้ผลรวมเท่าราคาเดิมเป๊ะ
  function splitParts(priceMinor, n) {
    var price = Math.round(Number(priceMinor) || 0);
    var count = Math.floor(Number(n) || 0);
    if (count < 1) return [];
    var base = Math.floor(price / count), out = [];
    for (var i = 0; i < count; i++) out.push(base);
    out[count - 1] += price - base * count;
    return out;
  }

  /* โหมด «หารเท่า» (CC 10 ต.ค. 69 · TASK_cc_readauto_party_v1): ยอด ÷ n คน → [สตางค์ต่อคน] Σ = ยอดเป๊ะ
   *   ต่อหัว = half-up ของ total/n · ส่วนต่าง (total − ต่อหัว×n · ไม่เกิน n/2 สตางค์) กระจายทีละ ±1 สตางค์จากคนแรก
   *   ลำดับ = เจ้าของ (index 0) ก่อน แล้วเพื่อนตามลำดับรายชื่อ → 2,923.24 ÷ 5 = [584.64, 584.65 ×4]
   *   สูตรเดียวกับ SQL bill_share_equal_split_ (migration 0013) — หน้าเพื่อน (SQL) กับหน้าเจ้าของ (JS) ได้เลขเดียวกัน
   *   (ไม่ใช้ alloc: alloc แจกเศษจาก floor ให้คนแรกก่อน → เจ้าของได้ 584.65 และเพื่อนคนท้าย 584.64 = ไม่ตรงสเปก) */
  function equalSplit(totalMinor, n) {
    var t = Math.round(Number(totalMinor) || 0), k = Math.floor(Number(n) || 0);
    if (k < 1 || !(t > 0)) return [];
    var base = Math.floor((2 * t + k) / (2 * k));
    var diff = t - base * k, out = [];
    for (var i = 0; i < k; i++) out.push(base + (diff > 0 && i < diff ? 1 : (diff < 0 && i < -diff ? -1 : 0)));
    return out;
  }

  /* สรุปบิลแชร์จากรายการ + ติ๊ก
   *   share = { items:[{id,name,price_minor}], ticks:[{item_id, person, is_owner}], svc_bp, vat_bp, total_minor, owner_name }
   * คืน { people:[{name, is_owner, items:[id], sub, est, final|null}], unclaimed:[id], unclaimedSub, complete, alloc,
   *        ownerFinal, friendsFinal, check:{ ok, diff } }
   *   - complete = ทุกบรรทัดมีคนติ๊ก และ alloc.ok (Σ ต่อคน = ยอดจ่ายจริงเป๊ะ)
   *   - เจ้าของ ("ส่วนของเรา") เป็นคนหนึ่งในการหาร แต่ไม่นับเข้า friendsFinal (= expect ของบิลรอคืน) */
  function summarize(share) {
    var items = share.items || [];
    var ticks = share.ticks || [];
    var svc = share.svc_bp || 0, vat = share.vat_bp || 0;
    var price = {};
    items.forEach(function (it) { price[String(it.id)] = Number(it.price_minor) || 0; });
    var byItem = {};
    ticks.forEach(function (t) { if (String(t.item_id) in price) byItem[String(t.item_id)] = t; });
    var people = [], idx = {};
    function person(name, isOwner) {
      var key = (isOwner ? '1:' : '0:') + name;
      if (!(key in idx)) { idx[key] = people.length; people.push({ name: name, is_owner: !!isOwner, items: [], sub: 0, est: 0, final: null }); }
      return people[idx[key]];
    }
    var ownerName = share.owner_name || 'เรา';
    person(ownerName, true);   // เจ้าของอยู่แถวแรกเสมอ (แม้ยังไม่ติ๊ก)
    var unclaimed = [], unclaimedSub = 0;
    items.forEach(function (it) {
      var t = byItem[String(it.id)];
      if (!t) { unclaimed.push(it.id); unclaimedSub += Number(it.price_minor) || 0; return; }
      var p = t.is_owner ? person(ownerName, true) : person(String(t.person), false);
      p.items.push(it.id);
      p.sub += Number(it.price_minor) || 0;
    });
    people.forEach(function (p) { p.est = estimate(p.sub, svc, vat); });
    var a = alloc(people.map(function (p) { return p.sub; }), share.total_minor || 0, svc, vat);
    var complete = unclaimed.length === 0 && a.ok;
    var ownerFinal = null, friendsFinal = null;
    if (complete) {
      people.forEach(function (p, i) { p.final = a.per[i]; });
      ownerFinal = people[0].final;
      friendsFinal = (share.total_minor || 0) - ownerFinal;
    }
    var itemsSub = 0;
    items.forEach(function (it) { itemsSub += Number(it.price_minor) || 0; });
    var g = grossOf(itemsSub, svc, vat);
    return {
      people: people, unclaimed: unclaimed, unclaimedSub: unclaimedSub, complete: complete, alloc: a,
      ownerFinal: ownerFinal, friendsFinal: friendsFinal,
      claimedEst: people.reduce(function (s, p) { return s + p.est; }, 0),
      check: billCheck(items, svc, vat, share.total_minor || 0),
      gross: g
    };
  }

  // เช็คดุลบิลจริง: ยอดเต็มจากรายการ (Σ ราคา × เซอร์วิส × VAT · half-up ทั้งก้อน) ต้อง = ยอดจ่ายจริงเป๊ะ (diff 0.00 เท่านั้น)
  //   ผ่านข้อนี้ ⇒ alloc แบ่งกี่คนก็ได้เศษ 0..n เสมอ (Σ floor อยู่ในช่วง (exact − n, exact] · ยอดจริง = round(exact))
  //   ไม่ผ่าน = รายการ/ราคา/เปอร์เซ็นต์ไม่ตรงบิลจริง → ต้องแก้ก่อน (ห้ามเงียบ · ห้ามโปะเศษเอง)
  function billCheck(items, svcBp, vatBp, totalMinor) {
    var sub = 0;
    (items || []).forEach(function (it) { sub += Number(it.price_minor) || 0; });
    var g = grossOf(sub, svcBp, vatBp);
    return { ok: (items || []).length > 0 && g === Number(totalMinor), gross: g, sub: sub, diff: Number(totalMinor) - g };
  }

  /* แกะลิสต์ที่พิมพ์/วาง (0 token): บรรทัดละรายการ "ชื่อ ราคา" · ต่อท้าย ×2 / x2 / *2 = แยกเป็นหลายบรรทัด (ราคาต่อหน่วย)
   *   ตัวอย่าง: "อาคามิยากิ จานใหญ่ 198" · "ข้าวญี่ปุ่น 35 x2" · "เบียร์ Asahi 49" · "1,190.50" · เลขไทย ๐-๙ ได้
   *   บรรทัดที่ไม่มีราคา → errors (ไม่เดา) */
  var THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
  function thaiToArabic(s) { return String(s).replace(/[๐-๙]/g, function (c) { return String(THAI_DIGITS.indexOf(c)); }); }
  function parseList(text) {
    var items = [], errors = [];
    String(text || '').split(/\r?\n/).forEach(function (raw, li) {
      var line = thaiToArabic(raw).replace(/\s+/g, ' ').trim();
      if (!line) return;
      var qty = 1;
      var mq = line.match(/(?:^|\s)(?:[x×*]\s?(\d{1,2})|(\d{1,2})\s?[x×*])(?=\s|$)/i);   // ×2 · x 2 · 2x (ที่ไหนก็ได้ในบรรทัด)
      if (mq) { qty = parseInt(mq[1] || mq[2], 10); line = (line.slice(0, mq.index) + ' ' + line.slice(mq.index + mq[0].length)).replace(/\s+/g, ' ').trim(); }
      var mp = line.match(/(?:^|\s)฿?\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s?(?:฿|บาท|\.-)?\s*$/);
      if (!mp) { errors.push({ line: li + 1, text: raw.trim(), msg: 'ไม่เจอราคา' }); return; }
      var price = Math.round(parseFloat(mp[1].replace(/,/g, '')) * 100);
      var name = line.slice(0, mp.index).replace(/[\s:–\-·.]+$/, '').trim();
      if (!name) name = 'รายการ ' + (items.length + 1);
      if (!(price > 0) || price > MAX_PRICE_MINOR) { errors.push({ line: li + 1, text: raw.trim(), msg: 'ราคาไม่ถูกต้อง' }); return; }
      if (!(qty >= 1 && qty <= MAX_QTY)) { errors.push({ line: li + 1, text: raw.trim(), msg: 'จำนวนไม่ถูกต้อง' }); return; }
      for (var q = 1; q <= qty; q++) items.push({ name: (qty > 1 ? name + ' (' + q + '/' + qty + ')' : name).slice(0, 80), price_minor: price });
    });
    if (items.length > MAX_ITEMS) { errors.push({ line: 0, text: '', msg: 'เกิน ' + MAX_ITEMS + ' รายการ' }); items = items.slice(0, MAX_ITEMS); }
    return { items: items, errors: errors };
  }

  // ตรวจรายการก่อนสร้าง (ฝั่งแอป + bridge ใช้ชุดเดียวกัน) → '' = ผ่าน
  function validateItems(items) {
    if (!items || !items.length) return 'ยังไม่มีรายการในบิล';
    if (items.length > MAX_ITEMS) return 'รายการเกิน ' + MAX_ITEMS + ' บรรทัด';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var nm = String(it.name || '').trim();
      if (!nm || nm.length > 80) return 'บรรทัดที่ ' + (i + 1) + ': ใส่ชื่อรายการ (ไม่เกิน 80 ตัว)';
      var p = Number(it.price_minor);
      if (!(p > 0) || p !== Math.floor(p) || p > MAX_PRICE_MINOR) return 'บรรทัดที่ ' + (i + 1) + ': ราคาไม่ถูกต้อง';
    }
    return '';
  }

  var api = {
    alloc: alloc, estimate: estimate, grossOf: grossOf, summarize: summarize, billCheck: billCheck, splitParts: splitParts, equalSplit: equalSplit,
    parseList: parseList, validateItems: validateItems,
    MAX_ITEMS: MAX_ITEMS, MAX_PRICE_MINOR: MAX_PRICE_MINOR
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.NKF_BS = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
