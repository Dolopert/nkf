/* qr_min.js — CC 9 ต.ค. 69 (TASK_cc_billbox_share · รอบ 3): QR ของลิงก์บิลแชร์ (ให้เพื่อนที่โต๊ะสแกนจากจอเจ้าของ)
 * ตัวเข้ารหัส QR ขนาดเล็ก ไม่พึ่งไลบรารีนอก/ไม่ยิงเน็ต — byte mode · ECC ระดับ M · version 1–10 (≤ 213 ไบต์) · เลือก mask ด้วยคะแนนโทษ
 * อ้างอิงอัลกอริทึมตามมาตรฐาน ISO/IEC 18004 (โครงแบบ Nayuki "QR Code generator")
 * ตรวจ: tests/billshare_qr_check.py — ตรงบิตต่อบิตกับ python-qrcode (v1–v10 · ทุก mask) + ถอดด้วย ZXing ได้ทุกลิงก์สุ่ม
 * ใช้: NKF_QR.svg(text) → '<svg …>' (สตริง) · NKF_QR.matrix(text) → { size, get(x,y) }
 */
(function (root) {
  'use strict';
  var ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];   // ระดับ M · index = version
  var NUM_BLOCKS    = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  var MAX_VER = 10;

  function rawModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) { var na = Math.floor(ver / 7) + 2; r -= (25 * na - 10) * na - 55; if (ver >= 7) r -= 36; }
    return r;
  }
  function dataCodewords(ver) { return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver]; }

  // ---- GF(256) / Reed–Solomon (poly 0x11D) ----
  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
    return z & 0xFF;
  }
  function rsDivisor(deg) {
    var res = []; for (var i = 0; i < deg - 1; i++) res.push(0); res.push(1);
    var r = 1;
    for (var k = 0; k < deg; k++) {
      for (var j = 0; j < res.length; j++) { res[j] = gfMul(res[j], r); if (j + 1 < res.length) res[j] ^= res[j + 1]; }
      r = gfMul(r, 0x02);
    }
    return res;
  }
  function rsRemainder(data, div) {
    var res = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ res.shift(); res.push(0);
      div.forEach(function (c, i) { res[i] ^= gfMul(c, f); });
    });
    return res;
  }

  function utf8(s) {
    var out = [], e = unescape(encodeURIComponent(String(s)));
    for (var i = 0; i < e.length; i++) out.push(e.charCodeAt(i));
    return out;
  }

  function encode(text) {
    var bytes = utf8(text);
    var ver = 1;
    for (; ver <= MAX_VER; ver++) {
      var ccBits = ver < 10 ? 8 : 16;
      if (4 + ccBits + bytes.length * 8 <= dataCodewords(ver) * 8) break;
    }
    if (ver > MAX_VER) throw new Error('qr_too_long');
    var bits = [];
    function put(v, n) { for (var i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); }
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    var cap = dataCodewords(ver) * 8;
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    var data = [];
    for (var b = 0; b < bits.length; b += 8) { var v = 0; for (var k = 0; k < 8; k++) v = (v << 1) | bits[b + k]; data.push(v); }

    // แบ่งบล็อก + ECC + สลับไบต์ (interleave)
    var nb = NUM_BLOCKS[ver], ecl = ECC_PER_BLOCK[ver], raw = Math.floor(rawModules(ver) / 8);
    var nShort = nb - raw % nb, shortLen = Math.floor(raw / nb);
    var blocks = [], div = rsDivisor(ecl);
    for (var i = 0, off = 0; i < nb; i++) {
      var dl = shortLen - ecl + (i < nShort ? 0 : 1);
      var dat = data.slice(off, off + dl); off += dl;
      var ec = rsRemainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ec));
    }
    var cw = [];
    for (var x = 0; x < blocks[0].length; x++) {
      for (var j = 0; j < blocks.length; j++) if (x !== shortLen - ecl || j >= nShort) cw.push(blocks[j][x]);
    }
    return { ver: ver, cw: cw };
  }

  function build(text) {
    var e = encode(text), ver = e.ver, size = ver * 4 + 17;
    var mod = [], fn = [];
    for (var y = 0; y < size; y++) { mod.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    function set(x, y, d) { mod[y][x] = d; fn[y][x] = true; }
    // timing
    for (var i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    // finder + separator
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy)), xx = cx + dx, yy = cy + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) set(xx, yy, d !== 2 && d !== 4);
      }
    }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    // alignment
    if (ver >= 2) {
      var na = Math.floor(ver / 7) + 2, step = (ver === 32) ? 26 : Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2;
      var pos = [6];
      for (var p = size - 7; pos.length < na; p -= step) pos.splice(1, 0, p);
      for (var a = 0; a < na; a++) for (var b2 = 0; b2 < na; b2++) {
        if ((a === 0 && b2 === 0) || (a === 0 && b2 === na - 1) || (a === na - 1 && b2 === 0)) continue;
        for (var ay = -2; ay <= 2; ay++) for (var ax = -2; ax <= 2; ax++) set(pos[a] + ax, pos[b2] + ay, Math.max(Math.abs(ax), Math.abs(ay)) !== 1);
      }
    }
    function drawFormat(mask) {
      var data = (0 << 3) | mask;   // ระดับ M = 00
      var rem = data;
      for (var k = 0; k < 10; k++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var bits = ((data << 10) | rem) ^ 0x5412;
      function bit(i) { return ((bits >>> i) & 1) !== 0; }
      for (var q = 0; q <= 5; q++) set(8, q, bit(q));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (q = 9; q < 15; q++) set(14 - q, 8, bit(q));
      for (q = 0; q < 8; q++) set(size - 1 - q, 8, bit(q));
      for (q = 8; q < 15; q++) set(8, size - 15 + q, bit(q));
      set(8, size - 8, true);   // dark module
    }
    drawFormat(0);   // จองตำแหน่ง
    if (ver >= 7) {
      var rem2 = ver;
      for (var k2 = 0; k2 < 12; k2++) rem2 = (rem2 << 1) ^ ((rem2 >>> 11) * 0x1F25);
      var vb = (ver << 12) | rem2;
      for (var vi = 0; vi < 18; vi++) {
        var vd = ((vb >>> vi) & 1) !== 0, va = size - 11 + vi % 3, vbb = Math.floor(vi / 3);
        set(va, vbb, vd); set(vbb, va, vd);
      }
    }
    // วางข้อมูลแบบงูซิกแซก
    var bi = 0, total = e.cw.length * 8;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (var jj = 0; jj < 2; jj++) {
        var xx = right - jj, upward = ((right + 1) & 2) === 0, yy = upward ? size - 1 - vert : vert;
        if (!fn[yy][xx] && bi < total) { mod[yy][xx] = ((e.cw[bi >>> 3] >>> (7 - (bi & 7))) & 1) !== 0; bi++; }
      }
    }
    function applyMask(m) {
      for (var y3 = 0; y3 < size; y3++) for (var x3 = 0; x3 < size; x3++) {
        if (fn[y3][x3]) continue;
        var inv;
        switch (m) {
          case 0: inv = (x3 + y3) % 2 === 0; break;
          case 1: inv = y3 % 2 === 0; break;
          case 2: inv = x3 % 3 === 0; break;
          case 3: inv = (x3 + y3) % 3 === 0; break;
          case 4: inv = (Math.floor(x3 / 3) + Math.floor(y3 / 2)) % 2 === 0; break;
          case 5: inv = x3 * y3 % 2 + x3 * y3 % 3 === 0; break;
          case 6: inv = (x3 * y3 % 2 + x3 * y3 % 3) % 2 === 0; break;
          default: inv = ((x3 + y3) % 2 + x3 * y3 % 3) % 2 === 0;
        }
        if (inv) mod[y3][x3] = !mod[y3][x3];
      }
    }
    // คะแนนโทษตามมาตรฐาน (กฎ 1–4 · แบบเดียวกับ Nayuki: นับ "รูปแบบคล้าย finder" ด้วยประวัติความยาวช่วง + ขอบสว่างนอกภาพ)
    function penalty() {
      var s = 0, dark = 0, a4, b4, x4, y4;
      function addHist(len, h) { if (h[0] === 0) len += size; h.pop(); h.unshift(len); }
      function countPat(h) {
        var nn = h[1], core = nn > 0 && h[2] === nn && h[3] === nn * 3 && h[4] === nn && h[5] === nn;
        return (core && h[0] >= nn * 4 && h[6] >= nn ? 1 : 0) + (core && h[6] >= nn * 4 && h[0] >= nn ? 1 : 0);
      }
      function termCount(col, len, h) { if (col) { addHist(len, h); len = 0; } len += size; addHist(len, h); return countPat(h); }
      for (var dir = 0; dir < 2; dir++) {
        for (a4 = 0; a4 < size; a4++) {
          var runCol = false, run = 0, hist = [0, 0, 0, 0, 0, 0, 0];
          for (b4 = 0; b4 < size; b4++) {
            var v4 = dir ? mod[b4][a4] : mod[a4][b4];
            if (v4 === runCol) { run++; if (run === 5) s += 3; else if (run > 5) s++; }
            else { addHist(run, hist); if (!runCol) s += countPat(hist) * 40; runCol = v4; run = 1; }
          }
          s += termCount(runCol, run, hist) * 40;
        }
      }
      for (y4 = 0; y4 < size - 1; y4++) for (x4 = 0; x4 < size - 1; x4++) {
        var cc = mod[y4][x4];
        if (cc === mod[y4][x4 + 1] && cc === mod[y4 + 1][x4] && cc === mod[y4 + 1][x4 + 1]) s += 3;
      }
      for (y4 = 0; y4 < size; y4++) for (x4 = 0; x4 < size; x4++) if (mod[y4][x4]) dark++;
      var tot = size * size;
      s += (Math.ceil(Math.abs(dark * 20 - tot * 10) / tot) - 1) * 10;
      return s;
    }
    var best = 0, bestScore = Infinity;
    for (var m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      var sc = penalty();
      if (sc < bestScore) { bestScore = sc; best = m; }
      applyMask(m);   // XOR กลับ
    }
    applyMask(best); drawFormat(best);
    return { size: size, version: ver, mask: best, get: function (x, y) { return mod[y][x]; } };
  }

  function svg(text) {
    var q = build(text), n = q.size, border = 4, d = '';
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (q.get(x, y)) d += 'M' + (x + border) + ',' + (y + border) + 'h1v1h-1z';
    var w = n + border * 2;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + w + '" shape-rendering="crispEdges">'
      + '<rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }

  var api = { matrix: build, svg: svg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.NKF_QR = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
