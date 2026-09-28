pdf.js (pdfjs-dist) — vendored สำหรับ NongKept web app
=====================================================

- แพ็กเกจ: pdfjs-dist@6.3.289 (legacy build)
- ไฟล์: pdf.min.mjs, pdf.worker.min.mjs (จาก legacy/build/), LICENSE (Apache-2.0)
- วันที่ vendor: 28 ก.ย. 2026

ทำไมใช้ legacy build
--------------------
รองรับเบราว์เซอร์รุ่นเก่ากว่า modern build แต่ pdf.js v6 ทั้งสอง build ยังต้องใช้
URL.parse (Safari 18+) และ Promise.withResolvers (Safari 17.4+) — แอปจึงติด polyfill
2 ตัวนี้ไว้ที่ App.html (โหลดก่อน import pdf.js) และถ้าเบราว์เซอร์ยังเก่ากว่านั้น
แอปจะสลับไปโหมด main-thread (fake worker — ผ่าน globalThis.pdfjsWorker) ให้อัตโนมัติ

หมายเหตุความปลอดภัย
-------------------
- PDF และรหัสถูกถอดในเครื่องผู้ใช้เท่านั้น — ส่งขึ้น Supabase เฉพาะ "แถว" ของ statement
- ตั้ง password ผ่าน getDocument({...password}) — pdf.js ไม่ส่งรหัสไปไหน

อัปเดต 28 ก.ย. 2026 (แอป v4.1.2) — Safari < 26.4 เปิด PDF ไม่ได้
---------------------------------------------------------------
- pdf.js v6 getTextContent() วน `for await (const t of stream)` บน ReadableStream —
  Safari เพิ่งรองรับ async iteration ของ stream ใน 26.4 (Chrome ≥124 · Firefox ≥110 · Node ≥18)
- เบราว์เซอร์ที่ขาด → พังตอน "เปิด PDF" ด้วย "undefined is not a function (near '...t of e...')"
- แอปแก้ที่ App.html: polyfill ReadableStream[Symbol.asyncIterator] (บล็อก NKF-PDF-STREAMITER)
  + ตรวจแล้วสลับเป็น main-thread (fake worker) ให้เบราว์เซอร์กลุ่มนี้ · เทสต์กันถอยหลัง:
  tests/pdf_old_streams.test.js (ลบ [Symbol.asyncIterator] แล้วรันท่อจริง — parity ต้องยังตรง)
