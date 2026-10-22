/* 藏书管家 · 轻量 XLSX 读写（无第三方依赖）
 * 写：生成标准 .xlsx（ZIP 存储法，Excel / WPS / Numbers 均可打开）
 * 读：解析 .xlsx 首个工作表为二维数组（依赖浏览器 DecompressionStream）
 */
(function (global) {
  'use strict';

  /* ---------------- CRC32 ---------------- */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  var enc = new TextEncoder();

  function u16(n) { return [n & 0xFF, (n >>> 8) & 0xFF]; }
  function u32(n) { return [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]; }

  /* ---------------- ZIP（存储模式，不压缩） ---------------- */
  function zipStore(files) {
    // files: [{name, data: Uint8Array}]
    var chunks = [];
    var central = [];
    var offset = 0;
    var now = new Date();
    var dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() / 2)) & 0xFFFF;
    var dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;

    files.forEach(function (f) {
      var nameBytes = enc.encode(f.name);
      var crc = crc32(f.data);
      var size = f.data.length;

      var local = [].concat(
        u32(0x04034b50), u16(20), u16(0), u16(0), u16(dosTime), u16(dosDate),
        u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0)
      );
      chunks.push(new Uint8Array(local), nameBytes, f.data);

      central.push({
        nameBytes: nameBytes, crc: crc, size: size, offset: offset,
        time: dosTime, date: dosDate
      });
      offset += local.length + nameBytes.length + size;
    });

    var centralStart = offset;
    var centralChunks = [];
    central.forEach(function (e) {
      var rec = [].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(e.time), u16(e.date),
        u32(e.crc), u32(e.size), u32(e.size), u16(e.nameBytes.length), u16(0), u16(0),
        u16(0), u16(0), u32(0), u32(e.offset)
      );
      centralChunks.push(new Uint8Array(rec), e.nameBytes);
      offset += rec.length + e.nameBytes.length;
    });

    var eocd = new Uint8Array([].concat(
      u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
      u32(offset - centralStart), u32(centralStart), u16(0)
    ));

    var total = chunks.reduce(function (s, c) { return s + c.length; }, 0) +
      centralChunks.reduce(function (s, c) { return s + c.length; }, 0) + eocd.length;
    var out = new Uint8Array(total);
    var pos = 0;
    chunks.concat(centralChunks, [eocd]).forEach(function (c) {
      out.set(c, pos);
      pos += c.length;
    });
    return out;
  }

  /* ---------------- XML 片段 ---------------- */
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  function colName(n) {
    var s = '';
    n = n + 1;
    while (n > 0) {
      var r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  var XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  /* ---------------- 写 XLSX ---------------- */
  function write(rows, sheetName, opts) {
    opts = opts || {};
    var widths = opts.widths || null;
    var sheet = [];
    sheet.push(XML_HEAD + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">');
    sheet.push('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" ' +
      'activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>');
    if (widths) {
      sheet.push('<cols>');
      widths.forEach(function (w, i) {
        sheet.push('<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>');
      });
      sheet.push('</cols>');
    }
    sheet.push('<sheetData>');
    rows.forEach(function (row, r) {
      var cells = [];
      (row || []).forEach(function (v, c) {
        var ref = colName(c) + (r + 1);
        if (v === null || v === undefined || v === '') return;
        if (typeof v === 'number' && isFinite(v)) {
          cells.push('<c r="' + ref + '"' + (r === 0 ? ' s="1"' : '') + '><v>' + v + '</v></c>');
        } else {
          cells.push('<c r="' + ref + '"' + (r === 0 ? ' s="1"' : '') + ' t="inlineStr"><is><t xml:space="preserve">' +
            esc(v) + '</t></is></c>');
        }
      });
      sheet.push('<row r="' + (r + 1) + '">' + cells.join('') + '</row>');
    });
    sheet.push('</sheetData></worksheet>');

    var styles = XML_HEAD +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="11"/><name val="等线"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FF1C2B3A"/><name val="等线"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';

    var workbook = XML_HEAD +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="' + esc(sheetName || '藏书') + '" sheetId="1" r:id="rId1"/></sheets></workbook>';

    var wbRels = XML_HEAD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';

    var rootRels = XML_HEAD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    var contentTypes = XML_HEAD +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>';

    var files = [
      { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
      { name: '_rels/.rels', data: enc.encode(rootRels) },
      { name: 'xl/workbook.xml', data: enc.encode(workbook) },
      { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(wbRels) },
      { name: 'xl/styles.xml', data: enc.encode(styles) },
      { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheet.join('')) }
    ];
    return zipStore(files);
  }

  /* ---------------- 读 ZIP ---------------- */
  function findEOCD(view) {
    var len = view.byteLength;
    for (var i = len - 22; i >= Math.max(0, len - 66000); i--) {
      if (view.getUint32(i, true) === 0x06054b50) return i;
    }
    return -1;
  }

  function readZip(buffer) {
    var view = new DataView(buffer);
    var bytes = new Uint8Array(buffer);
    var eocd = findEOCD(view);
    if (eocd < 0) throw new Error('不是有效的 xlsx（缺少 ZIP 结尾）');
    var count = view.getUint16(eocd + 10, true);
    var cdOffset = view.getUint32(eocd + 16, true);

    var entries = {};
    var p = cdOffset;
    for (var i = 0; i < count; i++) {
      if (view.getUint32(p, true) !== 0x02014b50) break;
      var method = view.getUint16(p + 10, true);
      var compSize = view.getUint32(p + 20, true);
      var nameLen = view.getUint16(p + 28, true);
      var extraLen = view.getUint16(p + 30, true);
      var commentLen = view.getUint16(p + 32, true);
      var localOff = view.getUint32(p + 42, true);
      var name = new TextDecoder('utf-8').decode(bytes.subarray(p + 46, p + 46 + nameLen));
      entries[name] = { method: method, compSize: compSize, localOff: localOff };
      p += 46 + nameLen + extraLen + commentLen;
    }

    function getData(name) {
      var e = entries[name];
      if (!e) return null;
      var lp = e.localOff;
      var nameLen = view.getUint16(lp + 26, true);
      var extraLen = view.getUint16(lp + 28, true);
      var start = lp + 30 + nameLen + extraLen;
      var raw = bytes.subarray(start, start + e.compSize);
      if (e.method === 0) return raw;
      return null; // 需要异步解压
    }

    function inflateRaw(raw) {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('当前浏览器不支持解压 xlsx，请改用 CSV 导入，或使用 Chrome / Edge 打开本页');
      }
      var ds = new DecompressionStream('deflate-raw');
      var stream = new Blob([raw]).stream().pipeThrough(ds);
      return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
    }

    return { entries: entries, getData: getData, inflateRaw: inflateRaw, view: view, bytes: bytes };
  }

  function decodeXml(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
  }

  function textOf(el) {
    // 合并所有 <t> 子节点
    var ts = el.getElementsByTagName('t');
    var s = '';
    for (var i = 0; i < ts.length; i++) s += ts[i].textContent;
    return s;
  }

  /* ---------------- 读 XLSX ---------------- */
  function read(buffer) {
    var zip = readZip(buffer);
    var parser = new DOMParser();

    function sheetPath() {
      var wbBytes = zip.getData('xl/workbook.xml');
      if (!wbBytes) return 'xl/worksheets/sheet1.xml';
      var doc = parser.parseFromString(decodeXml(wbBytes), 'application/xml');
      var sheet = doc.getElementsByTagName('sheet')[0];
      if (!sheet) return 'xl/worksheets/sheet1.xml';
      var rid = sheet.getAttribute('r:id') || sheet.getAttribute('id');
      var relsBytes = zip.getData('xl/_rels/workbook.xml.rels');
      if (relsBytes && rid) {
        var rels = parser.parseFromString(decodeXml(relsBytes), 'application/xml');
        var list = rels.getElementsByTagName('Relationship');
        for (var i = 0; i < list.length; i++) {
          if (list[i].getAttribute('Id') === rid) {
            var target = list[i].getAttribute('Target').replace(/^\/?(xl\/)?/, '');
            return 'xl/' + target.replace(/^\.\//, '');
          }
        }
      }
      return 'xl/worksheets/sheet1.xml';
    }

    var path = sheetPath();

    function parseAll(sheetXml, shared) {
      var doc = parser.parseFromString(sheetXml, 'application/xml');
      var rowsEl = doc.getElementsByTagName('row');
      var out = [];
      for (var r = 0; r < rowsEl.length; r++) {
        var cells = rowsEl[r].getElementsByTagName('c');
        var row = [];
        for (var c = 0; c < cells.length; c++) {
          var cell = cells[c];
          var ref = cell.getAttribute('r') || '';
          var colIdx = refToCol(ref);
          var t = cell.getAttribute('t');
          var value = '';
          if (t === 'inlineStr') {
            var is = cell.getElementsByTagName('is')[0];
            value = is ? textOf(is) : '';
          } else if (t === 's') {
            var vEl = cell.getElementsByTagName('v')[0];
            var idx = vEl ? parseInt(vEl.textContent, 10) : -1;
            value = shared && shared[idx] !== undefined ? shared[idx] : '';
          } else if (t === 'str') {
            var v2 = cell.getElementsByTagName('v')[0];
            value = v2 ? v2.textContent : '';
          } else {
            var v3 = cell.getElementsByTagName('v')[0];
            value = v3 ? v3.textContent : '';
          }
          row[colIdx] = value;
        }
        for (var k = 0; k < row.length; k++) if (row[k] === undefined) row[k] = '';
        out.push(row);
      }
      return out;
    }

    function parseShared(bytes) {
      if (!bytes) return [];
      var doc = parser.parseFromString(decodeXml(bytes), 'application/xml');
      var sis = doc.getElementsByTagName('si');
      var arr = [];
      for (var i = 0; i < sis.length; i++) arr.push(textOf(sis[i]));
      return arr;
    }

    function inflate(name) {
      var direct = zip.getData(name);
      if (direct) return Promise.resolve(direct);
      return zip.inflateRaw(zip.getData(name) || new Uint8Array(0));
    }

    var sheetPromise = inflate(path);
    var sharedPromise = zip.entries['xl/sharedStrings.xml']
      ? inflate('xl/sharedStrings.xml').then(parseShared).catch(function () { return []; })
      : Promise.resolve([]);

    return Promise.all([sheetPromise, sharedPromise]).then(function (res) {
      return parseAll(decodeXml(res[0]), res[1]);
    });
  }

  function refToCol(ref) {
    var m = /^([A-Z]+)/.exec(ref || '');
    if (!m) return 0;
    var s = m[1];
    var n = 0;
    for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n - 1;
  }

  global.XLSX = { write: write, read: read, _zipStore: zipStore, _crc32: crc32 };
})(typeof window !== 'undefined' ? window : globalThis);
