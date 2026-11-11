/* HPG — mini générateur PDF sans dépendance (polices Helvetica intégrées aux lecteurs PDF).
   Coordonnées en points, origine en haut à gauche. Texte en Windows-1252 (accents français pris en charge). */
(function (root) {
  'use strict';
  var W = { n: [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 761, 556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611, 667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500], b: [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 761, 556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611, 722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556] };
  var CP = { 0x20AC: 128, 0x201A: 130, 0x0192: 131, 0x201E: 132, 0x2026: 133, 0x2020: 134, 0x2021: 135, 0x02C6: 136, 0x2030: 137, 0x0160: 138,
    0x2039: 139, 0x0152: 140, 0x017D: 142, 0x2018: 145, 0x2019: 146, 0x201C: 147, 0x201D: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151,
    0x02DC: 152, 0x2122: 153, 0x0161: 154, 0x203A: 155, 0x0153: 156, 0x017E: 158, 0x0178: 159, 0x202F: 32, 0x00A0: 160, 0x2212: 45 };
  function code(ch) { var c = ch.charCodeAt(0); if (c < 128 || (c >= 160 && c < 256)) return c; return CP[c] || 63; }
  function width(str, size, bold) {
    var t = W[bold ? 'b' : 'n'], s = 0;
    for (var i = 0; i < str.length; i++) { var c = code(str[i]); s += c >= 32 ? t[c - 32] : 0; }
    return s * size / 1000;
  }
  function enc(str) {
    var o = '';
    for (var i = 0; i < str.length; i++) {
      var c = code(str[i]);
      if (c === 40 || c === 41 || c === 92) o += '\\' + String.fromCharCode(c);
      else o += String.fromCharCode(c);
    }
    return o;
  }
  function n(v) { return (Math.round(v * 100) / 100).toString(); }
  function rgb(c) { // '#RRGGBB'
    var h = c.replace('#', ''); return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255].map(function (x) { return n(x); }).join(' ');
  }

  function MiniPdf(pageW, pageH) {
    this.w = pageW || 841.89; this.h = pageH || 595.28; this.pages = []; this.cur = null;
  }
  MiniPdf.prototype.addPage = function () { this.cur = []; this.pages.push(this.cur); return this; };
  MiniPdf.prototype.rect = function (x, y, w, h, fill, stroke, lw) {
    var op = '';
    if (fill) op += rgb(fill) + ' rg ';
    if (stroke) op += rgb(stroke) + ' RG ' + n(lw || 0.5) + ' w ';
    op += n(x) + ' ' + n(this.h - y - h) + ' ' + n(w) + ' ' + n(h) + ' re ' + (fill && stroke ? 'B' : fill ? 'f' : 'S');
    this.cur.push(op); return this;
  };
  MiniPdf.prototype.line = function (x1, y1, x2, y2, color, lw) {
    this.cur.push(rgb(color || '#000000') + ' RG ' + n(lw || 0.5) + ' w ' + n(x1) + ' ' + n(this.h - y1) + ' m ' + n(x2) + ' ' + n(this.h - y2) + ' l S'); return this;
  };
  /* y = ligne de base du texte. opts : size, bold, color, align ('left' | 'center' | 'right'), maxWidth (tronque avec …) */
  MiniPdf.prototype.text = function (str, x, y, opts) {
    opts = opts || {}; var size = opts.size || 10, bold = !!opts.bold; str = String(str == null ? '' : str);
    if (opts.maxWidth) str = this.fit(str, opts.maxWidth, size, bold);
    var tw = width(str, size, bold);
    if (opts.align === 'center') x -= tw / 2; else if (opts.align === 'right') x -= tw;
    this.cur.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + n(size) + ' Tf ' + rgb(opts.color || '#000000') + ' rg ' + n(x) + ' ' + n(this.h - y) + ' Td (' + enc(str) + ') Tj ET');
    return this;
  };
  MiniPdf.prototype.width = width;
  MiniPdf.prototype.fit = function (str, maxW, size, bold) {
    if (width(str, size, bold) <= maxW) return str;
    while (str.length > 1 && width(str + '…', size, bold) > maxW) str = str.slice(0, -1);
    return str + '…';
  };
  MiniPdf.prototype.output = function () {
    var objs = [], pageIds = [], self = this;
    function add(s) { objs.push(s); return objs.length; }
    var catalogId = add(null), pagesId = add(null);
    var f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    var f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    this.pages.forEach(function (ops) {
      var content = ops.join('\n');
      var cId = add('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
      pageIds.push(add('<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 ' + n(self.w) + ' ' + n(self.h) + '] /Resources << /Font << /F1 ' + f1 + ' 0 R /F2 ' + f2 + ' 0 R >> >> /Contents ' + cId + ' 0 R >>'));
    });
    objs[catalogId - 1] = '<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>';
    objs[pagesId - 1] = '<< /Type /Pages /Kids [' + pageIds.map(function (i) { return i + ' 0 R'; }).join(' ') + '] /Count ' + pageIds.length + ' >>';
    var out = '%PDF-1.4\n%âãÏÓ\n', offsets = [];
    objs.forEach(function (o, i) { offsets.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    var xref = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    offsets.forEach(function (o) { out += ('0000000000' + o).slice(-10) + ' 00000 n \n'; });
    out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalogId + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF';
    var bytes = new Uint8Array(out.length);
    for (var i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return bytes;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = MiniPdf; else root.MiniPdf = MiniPdf;
})(typeof window !== 'undefined' ? window : this);
