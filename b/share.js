/* share.js — CC 9 ต.ค. 69 (TASK_cc_billbox_share · รอบ 3): หน้าเพื่อน (F) ของบิลแชร์
 *  - ลิงก์ = .../b/#<token 64 hex> (token อยู่หลัง # → ไม่ถูกส่งไปเซิร์ฟเวอร์/Referer)
 *  - ใส่ชื่อครั้งแรก → bill_share_join → ได้ key เก็บในเครื่องนี้ (localStorage) → ติ๊กของตัวเองได้จนเจ้าของปิดบิล
 *  - แตะรายการ = บันทึกทันที (bill_share_set_ticks) · บรรทัดที่คนอื่นติ๊กแล้ว = กดไม่ได้ · ชนกันพร้อมกัน → DB ปฏิเสธ + รีเฟรช
 *  - ยอดของคุณ = ตัวคำนวณชุดเดียวกับแอปเจ้าของ (NKF_BS) · ยอดสุดท้ายหลังเจ้าของปิดบิลมาจาก DB (result)
 *  - ไม่มี NKF_SB (เปิดไฟล์ตรง/ไม่ได้ build) หรือ #demo → โหมดเดโม่ในเครื่อง (ข้อมูลสมมติล้วน)
 *  ห้ามใช้ innerHTML กับข้อความจากผู้ใช้โดยไม่ esc() — ชื่อ/รายการมาจากคนนอก
 */
(function () {
  'use strict';
  var B = window.NKF_BS;
  var TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  var TH_D = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
  var POLL_MS = 15000;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function baht(minor) {
    var s = String(Math.round(Math.abs(minor))); while (s.length < 3) s = '0' + s;
    return (minor < 0 ? '-' : '') + s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + s.slice(-2);
  }
  function price(minor) { return baht(minor).replace(/\.00$/, ''); }
  function thDate(iso) {
    var d = iso ? new Date(iso) : new Date();
    if (isNaN(d.getTime())) return '';
    return d.getDate() + ' ' + TH_M[d.getMonth()] + ' ' + String(d.getFullYear() + 543).slice(2);
  }
  var toastT = null;
  function toast(msg, err) {
    var t = $('toast'); t.textContent = msg; t.className = 'toast on' + (err ? ' err' : '');
    clearTimeout(toastT); toastT = setTimeout(function () { t.className = 'toast' + (err ? ' err' : ''); }, 2600);
  }
  var ERR = {
    not_found: 'ลิงก์นี้ใช้ไม่ได้ (ผิด หรือเจ้าของยกเลิกบิลแล้ว)',
    rate_limited: 'เปิด/กดถี่เกินไป — รอสักครู่แล้วลองใหม่',
    share_locked: 'เจ้าของปิดบิลแล้ว — แก้ติ๊กไม่ได้',
    name_taken: 'ชื่อนี้มีคนใช้แล้ว — ใส่ชื่ออื่น (ถ้าเป็นคุณบนเครื่องอื่น ให้ใช้เครื่องเดิม)',
    bad_key: 'ชื่อนี้ถูกจองจากเครื่องอื่น — ใช้เครื่องเดิมที่ติ๊กไว้',
    bad_name: 'ใส่ชื่อ 1–30 ตัวอักษร',
    too_many_people: 'บิลนี้คนเต็มแล้ว (30 คน)',
    not_in_list: 'บิลนี้หารเท่า — เลือกได้เฉพาะชื่อที่เจ้าของใส่ไว้ (ไม่เจอชื่อ ให้ทักเจ้าของบิล)',
    item_not_found: 'ไม่พบบรรทัดนี้ในบิล',
    too_many_items: 'ติ๊กได้ไม่เกิน 100 บรรทัด'
  };
  function errMsg(e) {
    var m = String((e && (e.message || e.msg)) || e || '');
    for (var k in ERR) if (m.indexOf(k) >= 0) return ERR[k];
    return 'เชื่อมต่อไม่ได้ — ลองใหม่อีกครั้ง';
  }

  // ---------- token / ตัวตนในเครื่องนี้ ----------
  var hash = decodeURIComponent((location.hash || '').replace(/^#/, ''));
  var m = /(?:^|[&?]|t=)([0-9a-f]{64})(?:$|&)/.exec(hash);
  var TOKEN = m ? m[1] : '';
  var DEMO = /(^|&)demo(=1)?($|&)/.test(hash) || !window.NKF_SB || !window.NKF_SB.url || /REPLACE_ME/.test(window.NKF_SB.url || '')
    || typeof window.supabase === 'undefined';
  if (DEMO && !TOKEN) TOKEN = new Array(17).join('dem0').replace(/m/g, 'e');   // 64 hex (เดโม่)
  var KEY_STORE = 'nkf_bs:' + TOKEN;
  function loadMe() { try { var o = JSON.parse(localStorage.getItem(KEY_STORE) || 'null'); return (o && o.name && o.key) ? o : null; } catch (e) { return null; } }
  function saveMe(o) { try { localStorage.setItem(KEY_STORE, JSON.stringify(o)); } catch (e) {} }

  // ---------- ช่องทางคุยกับ DB (RPC 3 ตัว) · เดโม่ = จำลองในเครื่องด้วยกติกาเดียวกัน ----------
  var rpc;
  if (!DEMO) {
    var sb = window.supabase.createClient(window.NKF_SB.url, window.NKF_SB.anon, { auth: { persistSession: false, autoRefreshToken: false } });
    rpc = function (fn, args) {
      return Promise.resolve(sb.rpc(fn, args)).then(function (r) {
        if (r.error) throw r.error;
        return r.data;
      });
    };
  } else {
    rpc = demoRpc();
  }

  var S = { share: null, me: loadMe(), busy: false, err: '', pendingDone: false };

  function view() { return rpc('bill_share_view', { p_token: TOKEN }); }
  function refresh(quiet) {
    if (S.busy) return Promise.resolve();
    return view().then(function (sh) { S.share = sh; S.err = ''; render(); }, function (e) {
      if (!quiet || !S.share) { S.err = errMsg(e); render(); }
    });
  }
  function mineSet() {
    var out = {};
    if (!S.share || !S.me) return out;
    (S.share.ticks || []).forEach(function (t) { if (!t.is_owner && t.person === S.me.name) out[t.item_id] = 1; });
    return out;
  }
  function myPerson() {
    if (!S.share || !S.me) return null;
    var p = null;
    (S.share.people || []).forEach(function (x) { if (x.name === S.me.name) p = x; });
    return p;
  }
  function save(ids, done) {
    S.busy = true;
    return rpc('bill_share_set_ticks', { p_token: TOKEN, p_name: S.me.name, p_key: S.me.key, p_items: ids, p_done: !!done }).then(function (res) {
      S.busy = false;
      if (res && res.share) S.share = res.share;
      if (!res || !res.ok) {
        if (res && res.code === 'taken') toast('มีคนติ๊กบรรทัดนี้ไปก่อนแล้ว — อัปเดตให้แล้ว', true);
        else toast('บันทึกไม่สำเร็จ', true);
      }
      render();
      return res;
    }, function (e) {
      S.busy = false;
      toast(errMsg(e), true);
      if (/bad_key/.test(String(e && e.message))) { S.me = null; try { localStorage.removeItem(KEY_STORE); } catch (x) {} }
      return refresh(true);
    });
  }
  function isEqual() { return !!(S.share && S.share.split_mode === 'equal'); }   // CC 10 ต.ค. 69 (TASK_cc_readauto_party_v1 · 0013): บิลหารเท่า
  function myEqual() {   // ยอดของฉันในบิลหารเท่า — จาก DB (equal_split · สูตร SQL เดียวกับหน้าเจ้าของ) · ไม่เจอ = null
    var out = null;
    if (!S.share || !S.me) return null;
    (S.share.equal_split || []).forEach(function (r) { if (!r.is_owner && r.name === S.me.name) out = Number(r.minor); });
    return out;
  }
  function ack() {   // หารเท่า: «รับทราบ» = บันทึกว่าเห็นยอดแล้ว (ไม่ต้องติ๊กรายการ · ใช้ฟังก์ชัน set_ticks เดิม: ติ๊กว่าง + done)
    if (!S.me || !S.share) return;
    save([], true).then(function (res) { if (res && res.ok) toast('รับทราบแล้ว ✓ — โอนคืนเจ้าของได้เลย'); });
  }
  function toggle(itemId) {
    if (!S.share || S.share.status !== 'open' || !S.me || S.busy || isEqual()) return;
    var mine = mineSet();
    if (mine[itemId]) delete mine[itemId]; else mine[itemId] = 1;
    var ids = Object.keys(mine).map(Number).sort(function (a, b) { return a - b; });
    // แสดงผลทันที (optimistic) แล้วค่อยยืนยันกับ DB
    S.share.ticks = (S.share.ticks || []).filter(function (t) { return t.is_owner || t.person !== S.me.name; })
      .concat(ids.map(function (i) { return { item_id: i, person: S.me.name, is_owner: false }; }));
    var p = myPerson(); if (p) p.done = false;
    render();
    save(ids, false);
  }
  function join(name) {
    var nm = String(name || '').replace(/\s+/g, ' ').trim();
    if (!nm || nm.length > 30) { toast(ERR.bad_name, true); return; }
    S.busy = true;
    rpc('bill_share_join', { p_token: TOKEN, p_name: nm }).then(function (res) {
      S.busy = false;
      S.me = { name: res.name, key: res.key };
      saveMe(S.me);
      return refresh();
    }, function (e) { S.busy = false; toast(errMsg(e), true); });
  }
  function finish() {
    if (!S.me || !S.share) return;
    var ids = Object.keys(mineSet()).map(Number).sort(function (a, b) { return a - b; });
    save(ids, true).then(function (res) { if (res && res.ok) toast('บันทึกแล้ว ✓ — แก้ได้จนเจ้าของปิดบิล'); });
  }

  // ---------- วาดจอ ----------
  function render() {
    $('today').textContent = TH_D[new Date().getDay()] + ' ' + thDate();
    var app = $('app'), bar = $('bar');
    if (!TOKEN) { app.innerHTML = '<div class="msg">' + esc(ERR.not_found) + '</div>'; bar.style.display = 'none'; return; }
    if (!S.share) {
      app.innerHTML = '<div class="msg">' + esc(S.err || 'กำลังเปิดบิล…') + '</div>';
      bar.style.display = 'none';
      return;
    }
    var sh = S.share, locked = sh.status !== 'open';
    var head = '<div class="h">🧾 บิลของ "' + esc(sh.owner_name) + '" · ' + esc(sh.title) + '</div>'
      + '<div class="s">' + esc(thDate(sh.at)) + ' · เปิดจากลิงก์ — <b>ไม่ต้องสมัคร</b> · ' + (isEqual() ? 'บิลหารเท่า — ดูยอดของคุณแล้วกดรับทราบ' : 'แตะติ๊กรายการของคุณ')
      + (DEMO ? ' · <b>โหมดเดโม่</b> (ข้อมูลสมมติ)' : '') + '</div>';
    if (isEqual()) { renderEqual(sh, locked, head); return; }
    if (!S.me) {
      if (locked) { app.innerHTML = head + '<div class="msg">เจ้าของปิดบิลนี้แล้ว</div>'; bar.style.display = 'none'; return; }
      var free = (sh.people || []).filter(function (p) { return !p.joined; });
      app.innerHTML = head + '<div class="card"><div class="lbl">คุณคือใคร? (ชื่อจะโชว์ข้างรายการที่คุณติ๊ก)</div>'
        + (free.length ? '<div class="chips">' + free.map(function (p) { return '<button class="chip" type="button" data-join="' + esc(p.name) + '">' + esc(p.name) + '</button>'; }).join('') + '</div>' : '')
        + '<input class="in" id="nameIn" type="text" maxlength="30" placeholder="หรือพิมพ์ชื่อของคุณ" autocomplete="nickname">'
        + '<button class="btn" type="button" id="joinBtn">เริ่มติ๊กรายการ</button></div>'
        + itemsHtml(sh, {}, true) + footHtml();
      bar.style.display = 'none';
      return;
    }
    var mine = mineSet();
    var lockBox = '';
    if (locked) {
      var fin = null;
      (sh.result || []).forEach(function (r) { if (!r.is_owner && r.name === S.me.name) fin = r.minor; });
      lockBox = '<div class="lock">🔒 เจ้าของปิดบิลแล้ว — แก้ติ๊กไม่ได้' + (fin !== null ? '<br>ยอดของคุณ (สุดท้าย) <b>' + baht(fin) + '฿</b> — โอนคืนเจ้าของได้เลย' : '') + '</div>';
    }
    app.innerHTML = head + lockBox + itemsHtml(sh, mine, locked) + footHtml();
    // แถบล่าง: ยอดของคุณ (สด)
    var sub = 0, n = 0;
    (sh.items || []).forEach(function (it) { if (mine[it.id]) { sub += Number(it.price_minor) || 0; n++; } });
    var est = B ? B.estimate(sub, sh.svc_bp, sh.vat_bp) : sub;
    var extra = est - sub;
    var p = myPerson();
    var parts = 'ของคุณ ' + n + ' รายการ · อาหาร ' + baht(sub)
      + (extra ? ' + ' + (sh.svc_bp ? 'เซอร์วิส ' + sh.svc_bp / 100 + '% ' : '') + (sh.vat_bp ? (sh.svc_bp ? '+ ' : '') + 'VAT ' + sh.vat_bp / 100 + '% ' : '') + baht(extra) : '');
    bar.innerHTML = '<div class="box"><div class="t1">' + esc(parts) + ' · ชื่อ: ' + esc(S.me.name) + '</div>'
      + '<div class="t2">ยอดของคุณ <b>' + baht(est) + '฿</b></div>'
      + (locked ? '' : (p && p.done
          ? '<button class="btn ghost" type="button" id="doneBtn">✓ บันทึกแล้ว — แตะรายการเพื่อแก้ได้จนเจ้าของปิดบิล</button>'
          : '<button class="btn" type="button" id="doneBtn"' + (S.busy ? ' disabled' : '') + '>✓ เสร็จแล้ว — บันทึก</button>'))
      + '</div>';
    bar.style.display = '';
  }
  // บิลหารเท่า (CC 10 ต.ค. 69 · TASK_cc_readauto_party_v1): ยอดของคุณคงที่จาก DB · เลือกได้เฉพาะชื่อในรายชื่อ · ปุ่ม «รับทราบ» (ไม่ต้องติ๊ก)
  function renderEqual(sh, locked, head) {
    var app = $('app'), bar = $('bar');
    var n = (sh.equal_split || []).length;
    var info = '<div class="eq">🎉 <b>บิลนี้หารเท่า</b>' + (n ? ' ' + n + ' คน (รวม "' + esc(sh.owner_name) + '")' : '')
      + ' · ยอดรวม ' + baht(sh.total_minor) + '฿ · ไม่ต้องติ๊กรายการ · เศษสตางค์กระจายให้รวมเท่าบิลจริงเป๊ะ</div>';
    if (!S.me) {
      if (locked) { app.innerHTML = head + '<div class="msg">เจ้าของปิดบิลนี้แล้ว</div>'; bar.style.display = 'none'; return; }
      var free = (sh.people || []).filter(function (p) { return !p.joined; });
      app.innerHTML = head + info + '<div class="card"><div class="lbl">คุณคือใคร? (เลือกชื่อที่เจ้าของใส่ไว้)</div>'
        + (free.length ? '<div class="chips">' + free.map(function (p) { return '<button class="chip" type="button" data-join="' + esc(p.name) + '">' + esc(p.name) + '</button>'; }).join('') + '</div>'
          : '<div class="note">ทุกชื่อถูกเลือกแล้ว — ถ้าเป็นคุณ ให้เปิดจากเครื่องเดิม หรือทักเจ้าของบิล</div>')
        + '</div>' + itemsHtml(sh, {}, true) + footHtml();
      bar.style.display = 'none';
      return;
    }
    var amt = myEqual();
    var lockBox = '';
    if (locked) {
      (sh.result || []).forEach(function (r) { if (!r.is_owner && r.name === S.me.name) amt = Number(r.minor); });
      lockBox = '<div class="lock">🔒 เจ้าของปิดบิลแล้ว — ยอดสุดท้ายของคุณตามด้านล่าง · โอนคืนเจ้าของได้เลย</div>';
    }
    var amtTxt = amt === null ? '—' : baht(amt) + '฿';
    app.innerHTML = head + lockBox + '<div class="eqbig" id="eqMine">🎉 บิลนี้หารเท่า — ยอดของคุณ <b>' + amtTxt + '</b></div>' + info
      + '<div class="lbl" style="margin:4px 2px 8px">รายการในบิล (ดูอย่างเดียว)</div>' + itemsHtml(sh, {}, true) + footHtml();
    var p = myPerson();
    bar.innerHTML = '<div class="box"><div class="t1">บิลหารเท่า' + (n ? ' ' + n + ' คน' : '') + ' · ชื่อ: ' + esc(S.me.name) + '</div>'
      + '<div class="t2">ยอดของคุณ <b>' + amtTxt + '</b></div>'
      + (locked ? '' : (p && p.done
          ? '<button class="btn ghost" type="button" id="ackBtn" disabled>✓ รับทราบแล้ว — โอนคืนเจ้าของได้เลย</button>'
          : '<button class="btn" type="button" id="ackBtn"' + (S.busy ? ' disabled' : '') + '>รับทราบ</button>'))
      + '</div>';
    bar.style.display = '';
  }
  function itemsHtml(sh, mine, readOnly) {
    return (sh.items || []).map(function (it) {
      var t = null;
      (sh.ticks || []).forEach(function (x) { if (x.item_id === it.id) t = x; });
      var isMine = !!mine[it.id];
      var cls = isMine ? 'mine' : (t ? 'other' : '');
      var who = isMine ? '✓ ' + esc(S.me.name) : (t ? '✓ ' + esc(t.is_owner ? sh.owner_name : t.person) : '');
      var dis = (readOnly || (t && !isMine)) ? ' disabled' : '';
      return '<button class="it ' + cls + '" type="button" data-item="' + it.id + '"' + dis + '><span class="ck">' + (isMine ? '✓' : '') + '</span>'
        + '<span class="nm">' + esc(it.name) + '</span>' + (who ? '<span class="who">' + who + '</span>' : '')
        + '<span class="pr">' + price(it.price_minor) + '</span></button>';
    }).join('');
  }
  function footHtml() {
    return '<div class="note">ติ๊กได้อย่างเดียว — แก้/ลบรายการบิลไม่ได้ · ลิงก์นี้เห็นเฉพาะบิลนี้ · ยอดทุกคนรวมกันเท่ายอดบิลจริงเป๊ะ (เศษสตางค์ปัดให้)</div>'
      + '<div class="foot">NongKept — จดรายจ่ายอัตโนมัติจากอีเมลธนาคาร</div>';
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('button') : null;
    if (!t || t.disabled) return;
    if (t.hasAttribute('data-item')) { toggle(Number(t.getAttribute('data-item'))); return; }
    if (t.hasAttribute('data-join')) { join(t.getAttribute('data-join')); return; }
    if (t.id === 'joinBtn') { join(($('nameIn') || {}).value); return; }
    if (t.id === 'doneBtn') { finish(); return; }
    if (t.id === 'ackBtn') { ack(); return; }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target && e.target.id === 'nameIn') join(e.target.value); });
  window.addEventListener('hashchange', function () { location.reload(); });

  render();
  refresh();
  setInterval(function () { if (!document.hidden && S.share && S.share.status === 'open') refresh(true); }, POLL_MS);

  // ---------- เดโม่ (ไม่มีเน็ต · ข้อมูลสมมติล้วน) — กติกาเดียวกับฟังก์ชันใน 0012 ----------
  function demoRpc() {
    var items = [['อาคามิยากิ จานใหญ่', 198], ['ข้าวญี่ปุ่น', 35], ['เบียร์ Asahi', 49], ['บูตะยากิ จานใหญ่', 169], ['เบียร์ Sapporo', 79], ['คาราเมลคัสตาร์ด', 48],
      ['Set อาคามิ', 324], ['เมนไทโกะ', 119], ['ยุกเกะ (ผักดอง)', 138], ['โค้ก', 25]];
    var db = {
      title: 'ร้านปิ้งย่างตัวอย่าง', owner_name: 'เจ้าของบิล', at: new Date().toISOString(), svc_bp: 0, vat_bp: 700, status: 'open', result: null,
      items: items.map(function (x, i) { return { id: i + 1, name: x[0], price_minor: x[1] * 100 }; }),
      ticks: [{ item_id: 7, person: 'เจ้าของบิล', is_owner: true }, { item_id: 8, person: 'เจ้าของบิล', is_owner: true }, { item_id: 10, person: 'เพื่อน B', is_owner: false }],
      people: [{ name: 'เพื่อน A', done: false, joined: false, key: '' }, { name: 'เพื่อน B', done: true, joined: true, key: 'x' }]
    };
    db.total_minor = B ? B.grossOf(db.items.reduce(function (a, it) { return a + it.price_minor; }, 0), 0, 700) : 0;
    function pub() {
      return JSON.parse(JSON.stringify({ title: db.title, owner_name: db.owner_name, at: db.at, items: db.items, svc_bp: db.svc_bp, vat_bp: db.vat_bp,
        total_minor: db.total_minor, status: db.status, result: db.result, ticks: db.ticks, split_mode: 'tick', equal_split: null, share_minor: null,
        people: db.people.map(function (p) { return { name: p.name, done: p.done, joined: p.joined }; }) }));
    }
    return function (fn, a) {
      return new Promise(function (res, rej) {
        setTimeout(function () {
          if (fn === 'bill_share_view') return res(pub());
          if (fn === 'bill_share_join') {
            var nm = String(a.p_name || '').trim();
            var p = db.people.filter(function (x) { return x.name === nm; })[0];
            if (nm === db.owner_name || (p && p.joined)) return rej(new Error('name_taken'));
            var key = 'demo-' + Math.random().toString(16).slice(2);
            if (p) { p.joined = true; p.key = key; } else db.people.push({ name: nm, done: false, joined: true, key: key });
            return res({ ok: true, name: nm, key: key });
          }
          if (fn === 'bill_share_set_ticks') {
            var me = db.people.filter(function (x) { return x.name === a.p_name && x.key === a.p_key; })[0];
            if (!me) return rej(new Error('bad_key'));
            var taken = db.ticks.filter(function (t) { return a.p_items.indexOf(t.item_id) >= 0 && (t.is_owner || t.person !== me.name); }).map(function (t) { return t.item_id; });
            if (taken.length) return res({ ok: false, code: 'taken', items: taken, share: pub() });
            db.ticks = db.ticks.filter(function (t) { return t.is_owner || t.person !== me.name; })
              .concat(a.p_items.map(function (i) { return { item_id: i, person: me.name, is_owner: false }; }));
            me.done = !!a.p_done;
            return res({ ok: true, share: pub() });
          }
          rej(new Error('unknown'));
        }, 120);
      });
    };
  }
})();
