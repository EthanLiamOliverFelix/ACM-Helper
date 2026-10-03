// Shared by the submission poller and the record detail reader.
(function () {
  var names = {0:'WJ',1:'Judging',2:'CE',3:'OLE',4:'MLE',5:'TLE',6:'WA',7:'RE',11:'UKE',12:'AC',14:'WA',21:'AC',22:'WA',23:'WA'};
  function decode(value) {
    for (var depth = 0; depth < 4 && typeof value === 'string'; depth++) {
      try { value = JSON.parse(value); } catch (_) { return null; }
    }
    return value;
  }
  function status(value) {
    if (value === null || value === undefined || value === '') return undefined;
    var number = Number(value);
    return Number.isInteger(number) && names[number] ? number : undefined;
  }
  function findRecord(root, rid) {
    var seen = new Set();
    function visit(value, depth, explicit) {
      value = decode(value);
      if (!value || typeof value !== 'object' || depth > 6 || seen.has(value)) return null;
      seen.add(value);
      var id = Number(value.id || value.rid || value.recordId);
      if ((explicit || value.detail || value.problem || id) && status(value.status) !== undefined
          && (!id || id === Number(rid))) return value;
      // currentData carries the actual content; data can be an outer envelope.
      for (var key of ['currentData', 'record', 'data']) {
        var found = visit(value[key], depth + 1, key === 'record');
        if (found) return found;
      }
      return null;
    }
    return visit(root, 0, false);
  }
  function detail(record) { return decode(record.detail) || {}; }
  function values(value) { value = decode(value); return Array.isArray(value) ? value : Object.values(value || {}); }
  function verdict(record) {
    var result = status(record.status);
    var extra = detail(record);
    var compile = decode(extra.compileResult || extra.compile);
    if (compile && compile.success === false) return 'CE';
    var judge = decode(extra.judgeResult || extra.judge || record.judgeResult) || {};
    var judgeStatus = status(judge.status);
    if ((result === 0 || result === 1) && judgeStatus !== undefined && judgeStatus > 1) result = judgeStatus;
    if (result === undefined) return undefined;
    if ([14,22,23].indexOf(result) >= 0) {
      for (var subtask of values(judge.subtasks)) {
        for (var testcase of values(subtask.testCases || subtask.cases)) {
          var failed = status(testcase.status);
          if ([2,3,4,5,6,7,11].indexOf(failed) >= 0) return names[failed];
        }
      }
    }
    return names[result];
  }
  function effectiveStatus(record) {
    var result = verdict(record);
    var original = status(record.status);
    if (names[original] === result) return original;
    return Object.keys(names).map(Number).find(function (key) { return names[key] === result; });
  }
  function parseResponse(text, rid) {
    var root = decode(text);
    if (!root && typeof DOMParser !== 'undefined') {
      var document = new DOMParser().parseFromString(text, 'text/html');
      var context = document.querySelector('script#lentille-context');
      if (context) root = decode(context.textContent);
    }
    return findRecord(root, rid);
  }
  async function request(rid, html) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 9000);
    try {
      var response = await fetch('/record/' + rid + '?' + (html ? '' : '_contentOnly=1&') + '_t=' + Date.now(), {
        credentials: 'include', cache: 'no-store', signal: controller.signal,
        headers: html ? {} : {'X-Requested-With':'XMLHttpRequest','x-lentille-request':'content-only'}
      });
      if (response.status === 401 || response.status === 403 || (response.redirected && /\/auth\//.test(response.url))) {
        throw new Error('洛谷会话未登录或已过期，请重新登录');
      }
      if (!response.ok) throw new Error('洛谷记录接口 HTTP ' + response.status);
      return parseResponse(await response.text(), rid);
    } finally { clearTimeout(timer); }
  }
  window.__acmLuoguRecord = {findRecord:findRecord,detail:detail,values:values,status:status,effectiveStatus:effectiveStatus,verdict:verdict,request:request};
})();
