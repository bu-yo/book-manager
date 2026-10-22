/* 藏书管家 · 数据层
 * 负责：本地持久化、书目录入与查询、分类词典、统计、导入导出。
 * 无任何外部依赖，可在浏览器（window.Store）与 Node（module.exports）中使用。
 */
(function (global) {
  'use strict';

  var KEY = 'bookkeeper.mobile.v2';
  var MAX_UNDO = 5;

  var CATEGORY_COLORS = {
    '文学作品': '#2F4A63',
    '人文社科': '#B85C38',
    '科学技术': '#5E8C7B',
    '艺术生活': '#8B6F8E',
    '工具参考': '#C99A5B'
  };

  var FALLBACK_COLORS = ['#2F4A63', '#B85C38', '#5E8C7B', '#8B6F8E', '#C99A5B', '#6C7C8C', '#A9654B'];

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function uid() {
    return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function now() { return new Date().toISOString(); }

  function store() {
    try { return global.localStorage; } catch (e) { return null; }
  }

  function emptyData() {
    return {
      version: 1,
      books: [],
      dict: { categories: [], publishers: [], authors: [], channels: [], languages: ['中文', '英文'] }
    };
  }

  var Store = {
    data: emptyData(),
    undoStack: [],
    listeners: [],
    lastError: '',

    /* ---------- 生命周期 ---------- */
    init: function () {
      var raw = null;
      try { raw = store() && store().getItem(KEY); } catch (e) { raw = null; }
      if (raw) {
        try {
          var parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.books)) {
            Store.data = parsed;
          }
        } catch (e) {
          console.warn('本地数据损坏，已回退到初始数据', e);
        }
      }
      if (!Store.data.books.length && global.SEED) {
        Store.data = clone(global.SEED);
      }
      Store.normalize();
      Store.save();
      Store.storageAvailable = (function () {
        try {
          var s = store();
          if (!s) return false;
          s.setItem('__probe__', '1');
          s.removeItem('__probe__');
          return true;
        } catch (e) { return false; }
      })();
      return Store;
    },

    hasLocal: function () {
      try { return !!(store() && store().getItem(KEY)); } catch (e) { return false; }
    },

    normalize: function () {
      var d = Store.data;
      d.dict = d.dict || { categories: [], publishers: [], authors: [], channels: [], languages: [] };
      ['publishers', 'authors', 'channels'].forEach(function (k) {
        if (!Array.isArray(d.dict[k])) d.dict[k] = [];
      });
      if (!Array.isArray(d.dict.languages) || !d.dict.languages.length) d.dict.languages = ['中文', '英文'];
      if (!Array.isArray(d.dict.categories)) d.dict.categories = [];

      var maxSeq = 0;
      d.books.forEach(function (b) {
        if (!b.id) b.id = uid();
        if (b.cover !== undefined && b.cover !== null) b.cover = String(b.cover);
        else b.cover = '';
        b.copies = Math.max(1, parseInt(b.copies, 10) || 1);
        b.seq = parseInt(b.seq, 10) || 0;
        if (b.seq > maxSeq) maxSeq = b.seq;
      });
      // 补齐缺失的序号
      d.books.forEach(function (b) {
        if (!b.seq) b.seq = ++maxSeq;
      });
      // 让词典覆盖数据中出现的取值
      d.books.forEach(function (b) {
        if (b.category) {
          var c = Store.categoryObj(b.category);
          if (c && b.tag && c.tags.indexOf(b.tag) === -1) c.tags.push(b.tag);
        }
        if (b.publisher && d.dict.publishers.indexOf(b.publisher) === -1) d.dict.publishers.push(b.publisher);
        if (b.author && d.dict.authors.indexOf(b.author) === -1) d.dict.authors.push(b.author);
        if (b.channel && d.dict.channels.indexOf(b.channel) === -1) d.dict.channels.push(b.channel);
      });
    },

    save: function () {
      try {
        var s = store();
        if (s) s.setItem(KEY, JSON.stringify(Store.data));
        Store.lastError = '';
      } catch (e) {
        Store.lastError = '本地存储写入失败（可能空间不足）：' + e.message;
        console.warn(Store.lastError);
      }
      Store.emit();
    },

    subscribe: function (fn) {
      Store.listeners.push(fn);
      return function () {
        var i = Store.listeners.indexOf(fn);
        if (i >= 0) Store.listeners.splice(i, 1);
      };
    },

    emit: function () {
      Store.listeners.forEach(function (fn) {
        try { fn(Store.data); } catch (e) { console.error(e); }
      });
    },

    reset: function () {
      Store.pushUndo();
      Store.data = global.SEED ? clone(global.SEED) : emptyData();
      Store.normalize();
      Store.save();
    },

    clear: function () {
      Store.pushUndo();
      Store.data = emptyData();
      Store.save();
    },

    /* ---------- 类别与颜色 ---------- */
    categories: function () {
      return Store.data.dict.categories.map(function (c) { return c.name; });
    },

    categoryObj: function (name) {
      for (var i = 0; i < Store.data.dict.categories.length; i++) {
        if (Store.data.dict.categories[i].name === name) return Store.data.dict.categories[i];
      }
      return null;
    },

    color: function (name) {
      if (CATEGORY_COLORS[name]) return CATEGORY_COLORS[name];
      var idx = Store.categories().indexOf(name);
      return FALLBACK_COLORS[(idx < 0 ? 0 : idx) % FALLBACK_COLORS.length];
    },

    tagsOf: function (category) {
      var c = Store.categoryObj(category);
      return c ? c.tags.slice() : [];
    },

    /* ---------- 查询 ---------- */
    all: function () {
      return Store.data.books.slice().sort(function (a, b) { return a.seq - b.seq; });
    },

    get: function (id) {
      for (var i = 0; i < Store.data.books.length; i++) {
        if (Store.data.books[i].id === id) return Store.data.books[i];
      }
      return null;
    },

    nextSeq: function () {
      var max = 0;
      Store.data.books.forEach(function (b) { if (b.seq > max) max = b.seq; });
      return max + 1;
    },

    /** 组合筛选：关键词 + 类别 + 标签 + 语言 + 渠道 + 年代 + 排序 */
    query: function (opts) {
      opts = opts || {};
      var q = (opts.q || '').trim().toLowerCase();
      var list = Store.data.books.filter(function (b) {
        if (opts.category && b.category !== opts.category) return false;
        if (opts.tag && b.tag !== opts.tag) return false;
        if (opts.language && b.language !== opts.language) return false;
        if (opts.channel && b.channel !== opts.channel) return false;
        if (opts.decade && Store.decadeOf(b) !== opts.decade) return false;
        if (q) {
          var hay = [b.title, b.author, b.publisher, b.tag, b.category, b.note, b.translator, b.channel]
            .join(' ').toLowerCase();
          if (hay.indexOf(q) === -1) return false;
        }
        return true;
      });

      var dir = opts.sortDir === 'desc' ? -1 : 1;
      var by = opts.sortBy || 'seq';
      list.sort(function (a, b) {
        var va = a[by], vb = b[by];
        if (by === 'title' || by === 'author' || by === 'publisher') {
          va = va || ''; vb = vb || '';
          return va.localeCompare(vb, 'zh-Hans-CN') * dir;
        }
        if (by === 'copies' || by === 'seq') {
          return ((va || 0) - (vb || 0)) * dir;
        }
        return String(va || '').localeCompare(String(vb || '')) * dir;
      });
      return list;
    },

    decadeOf: function (b) {
      var m = /^(\d{4})/.exec(b.pubdate || '');
      if (!m) return '未知';
      return (Math.floor(parseInt(m[1], 10) / 10) * 10) + 's';
    },

    duplicates: function (fields, excludeId) {
      var title = (fields.title || '').trim();
      if (!title) return [];
      return Store.data.books.filter(function (b) {
        return b.id !== excludeId && b.title.trim() === title;
      });
    },

    /* ---------- 增删改 ---------- */
    add: function (fields) {
      var b = Store.sanitize(fields);
      b.id = uid();
      b.seq = b.seq || Store.nextSeq();
      b.createdAt = now();
      b.updatedAt = b.createdAt;
      Store.data.books.push(b);
      Store.save();
      return b;
    },

    update: function (id, fields) {
      var b = Store.get(id);
      if (!b) return null;
      var clean = Store.sanitize(fields, b);
      Object.keys(clean).forEach(function (k) { b[k] = clean[k]; });
      b.updatedAt = now();
      Store.data.books.sort(function (x, y) { return x.seq - y.seq; });
      Store.save();
      return b;
    },

    remove: function (id) {
      var idx = -1;
      for (var i = 0; i < Store.data.books.length; i++) {
        if (Store.data.books[i].id === id) { idx = i; break; }
      }
      if (idx < 0) return null;
      Store.pushUndo();
      var removed = Store.data.books.splice(idx, 1)[0];
      Store.save();
      return removed;
    },

    removeMany: function (ids) {
      if (!Array.isArray(ids) || !ids.length) return 0;
      var wanted = {};
      ids.forEach(function (id) { wanted[id] = true; });
      var before = Store.data.books.length;
      if (!before) return 0;
      Store.pushUndo();
      Store.data.books = Store.data.books.filter(function (b) { return !wanted[b.id]; });
      var removed = before - Store.data.books.length;
      if (!removed) { Store.undoStack.pop(); return 0; }
      Store.save();
      return removed;
    },

    sanitize: function (fields, base) {
      var b = base ? clone(base) : {};
      var text = ['title', 'author', 'publisher', 'pubdate', 'category', 'tag',
        'language', 'translator', 'channel', 'acquired', 'note', 'cover'];
      text.forEach(function (k) {
        if (fields[k] !== undefined) b[k] = String(fields[k] === null ? '' : fields[k]).trim();
      });
      if (fields.copies !== undefined) b.copies = Math.max(1, parseInt(fields.copies, 10) || 1);
      if (fields.seq !== undefined) b.seq = parseInt(fields.seq, 10) || 0;
      if (!b.language) b.language = '中文';
      if (!b.copies) b.copies = 1;
      return b;
    },

    validate: function (fields) {
      var errors = [];
      if (!String(fields.title || '').trim()) errors.push('书名不能为空');
      if (fields.pubdate && !/^\d{4}(-\d{1,2})?$/.test(String(fields.pubdate).trim())) {
        errors.push('出版时间格式应为 2019 或 2019-05');
      }
      if (fields.category && Store.categories().indexOf(fields.category) === -1) {
        errors.push('类别不在词典中');
      }
      if (fields.copies !== undefined && (parseInt(fields.copies, 10) || 0) < 1) {
        errors.push('册数至少为 1');
      }
      return errors;
    },

    /* ---------- 统计 ---------- */
    stats: function (list) {
      var books = list || Store.data.books;
      var titles = books.length;
      var copies = 0;
      var byCat = {}, byTag = {}, byChan = {}, byLang = {}, byDecade = {};
      var authors = {}, publishers = {};

      books.forEach(function (b) {
        copies += b.copies || 1;
        var c = b.category || '未分类';
        byCat[c] = (byCat[c] || 0) + 1;
        if (b.tag) byTag[b.tag] = (byTag[b.tag] || 0) + 1;
        var ch = b.channel || '未记录';
        byChan[ch] = (byChan[ch] || 0) + 1;
        var lg = b.language || '未记录';
        byLang[lg] = (byLang[lg] || 0) + 1;
        var dec = Store.decadeOf(b);
        byDecade[dec] = (byDecade[dec] || 0) + 1;
        if (b.author) authors[b.author] = (authors[b.author] || 0) + 1;
        if (b.publisher) publishers[b.publisher] = (publishers[b.publisher] || 0) + 1;
      });

      function entries(obj, order) {
        var arr = Object.keys(obj).map(function (k) { return { name: k, count: obj[k] }; });
        if (order) {
          arr.sort(function (a, b) {
            var ia = order.indexOf(a.name), ib = order.indexOf(b.name);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
          });
        } else {
          arr.sort(function (a, b) { return b.count - a.count; });
        }
        arr.forEach(function (d) { d.share = titles ? d.count / titles : 0; });
        return arr;
      }

      var catOrder = Store.categories();

      // 有效类别数 1 / Σp²
      var hhi = 0;
      Object.keys(byCat).forEach(function (k) {
        var p = byCat[k] / (titles || 1);
        hhi += p * p;
      });

      var decades = entries(byDecade).sort(function (a, b) {
        if (a.name === '未知') return 1;
        if (b.name === '未知') return -1;
        return a.name.localeCompare(b.name);
      });

      return {
        titles: titles,
        copies: copies,
        avgCopies: titles ? copies / titles : 0,
        authorCount: Object.keys(authors).length,
        publisherCount: Object.keys(publishers).length,
        byCategory: entries(byCat, catOrder),
        byTag: entries(byTag),
        byChannel: entries(byChan),
        byLanguage: entries(byLang),
        byDecade: decades,
        effectiveCategories: hhi ? 1 / hhi : 0,
        singleCopy: books.filter(function (b) { return (b.copies || 1) === 1; }).length,
        multiCopy: books.filter(function (b) { return (b.copies || 1) > 1; }).length,
        topAuthors: entries(authors).slice(0, 10),
        topPublishers: entries(publishers).slice(0, 10)
      };
    },

    /* ---------- 词典维护 ---------- */
    usage: function (field, value) {
      return Store.data.books.filter(function (b) { return b[field] === value; }).length;
    },

    addCategory: function (name) {
      name = String(name || '').trim();
      if (!name || Store.categoryObj(name)) return false;
      Store.data.dict.categories.push({ name: name, tags: [] });
      Store.save();
      return true;
    },

    removeCategory: function (name) {
      var c = Store.categoryObj(name);
      if (!c) return false;
      Store.data.dict.categories = Store.data.dict.categories.filter(function (x) { return x.name !== name; });
      Store.save();
      return true;
    },

    renameCategory: function (oldName, newName) {
      newName = String(newName || '').trim();
      var c = Store.categoryObj(oldName);
      if (!c || !newName || Store.categoryObj(newName)) return false;
      c.name = newName;
      Store.data.books.forEach(function (b) { if (b.category === oldName) b.category = newName; });
      Store.save();
      return true;
    },

    addTag: function (category, tag) {
      tag = String(tag || '').trim();
      var c = Store.categoryObj(category);
      if (!c || !tag || c.tags.indexOf(tag) >= 0) return false;
      c.tags.push(tag);
      Store.save();
      return true;
    },

    removeTag: function (category, tag) {
      var c = Store.categoryObj(category);
      if (!c) return false;
      c.tags = c.tags.filter(function (t) { return t !== tag; });
      Store.save();
      return true;
    },

    renameTag: function (category, oldTag, newTag) {
      var c = Store.categoryObj(category);
      newTag = String(newTag || '').trim();
      if (!c || !newTag) return false;
      var i = c.tags.indexOf(oldTag);
      if (i < 0) return false;
      c.tags[i] = newTag;
      Store.data.books.forEach(function (b) {
        if (b.category === category && b.tag === oldTag) b.tag = newTag;
      });
      Store.save();
      return true;
    },

    addListValue: function (listName, value) {
      value = String(value || '').trim();
      var arr = Store.data.dict[listName];
      if (!arr || !value || arr.indexOf(value) >= 0) return false;
      arr.push(value);
      Store.save();
      return true;
    },

    removeListValue: function (listName, value) {
      var arr = Store.data.dict[listName];
      if (!arr) return false;
      Store.data.dict[listName] = arr.filter(function (v) { return v !== value; });
      Store.save();
      return true;
    },

    renameListValue: function (listName, oldValue, newValue) {
      newValue = String(newValue || '').trim();
      var arr = Store.data.dict[listName];
      if (!arr || !newValue) return false;
      var i = arr.indexOf(oldValue);
      if (i < 0) return false;
      arr[i] = newValue;
      var field = listName === 'publishers' ? 'publisher' : listName === 'authors' ? 'author' : 'channel';
      Store.data.books.forEach(function (b) { if (b[field] === oldValue) b[field] = newValue; });
      Store.save();
      return true;
    },

    /* ---------- 撤销 ---------- */
    pushUndo: function () {
      Store.undoStack.push(JSON.stringify(Store.data));
      if (Store.undoStack.length > MAX_UNDO) Store.undoStack.shift();
    },

    undo: function () {
      var snap = Store.undoStack.pop();
      if (!snap) return false;
      Store.data = JSON.parse(snap);
      Store.save();
      return true;
    },

    canUndo: function () { return Store.undoStack.length > 0; },

    /* ---------- 导入导出 ---------- */
    exportObject: function () {
      return { version: 1, exportedAt: now(), dict: clone(Store.data.dict), books: clone(Store.data.books) };
    },

    importObject: function (obj, mode) {
      mode = mode || 'replace';
      if (!obj || !Array.isArray(obj.books)) throw new Error('文件格式不正确：缺少 books 数组');
      if (mode === 'replace') {
        Store.pushUndo();
        Store.data.books = obj.books;
        if (obj.dict) Store.data.dict = obj.dict;
      } else {
        var existing = {};
        Store.data.books.forEach(function (b) { existing[b.title + '|' + (b.author || '')] = true; });
        obj.books.forEach(function (b) {
          if (!existing[b.title + '|' + (b.author || '')]) {
            b.id = b.id || uid();
            Store.data.books.push(b);
          }
        });
      }
      Store.normalize();
      Store.save();
      return Store.data.books.length;
    },

    HEADERS: ['序号', '书名', '作者', '出版社', '出版时间', '类别', '标签', '语言', '译者', '册数', '获得渠道', '获取时间', '备注'],

    toRows: function () {
      var rows = [Store.HEADERS.slice()];
      Store.all().forEach(function (b) {
        rows.push([b.seq, b.title, b.author, b.publisher, b.pubdate, b.category, b.tag,
          b.language, b.translator, b.copies, b.channel, b.acquired, b.note].map(function (v) {
            return v === undefined || v === null ? '' : v;
          }));
      });
      return rows;
    },

    /** 把表头 → 字段的二维数组转成书目对象 */
    fromRows: function (rows) {
      if (!rows || !rows.length) return [];
      var header = rows[0].map(function (h) { return String(h || '').trim(); });
      var map = {
        '序号': 'seq', '书名': 'title', '作者': 'author', '出版社': 'publisher',
        '出版时间': 'pubdate', '类别': 'category', '标签': 'tag', '语言': 'language',
        '译者': 'translator', '册数': 'copies', '获得渠道': 'channel', '获取时间': 'acquired', '备注': 'note'
      };
      var out = [];
      for (var i = 1; i < rows.length; i++) {
        var row = rows[i];
        if (!row || !row.length) continue;
        var obj = {};
        var hasValue = false;
        header.forEach(function (h, idx) {
          var field = map[h];
          if (!field) return;
          var v = row[idx];
          v = v === undefined || v === null ? '' : String(v).trim();
          if (v) hasValue = true;
          if (field === 'copies') obj.copies = Math.max(1, parseInt(v, 10) || 1);
          else if (field === 'seq') obj.seq = parseInt(v, 10) || 0;
          else obj[field] = v;
        });
        if (hasValue && obj.title) out.push(obj);
      }
      return out;
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
  global.Store = Store;
})(typeof window !== 'undefined' ? window : globalThis);
