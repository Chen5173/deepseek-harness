// Oh-My-Dsh fork：浏览器标签页品牌修正脚本。
// 由 dsh-oh-my-dsh-config 在宿主侧读成文本，经 webserver 的 {kind:script} 注入行内联进 <head>。
// 运行时机早于 React 挂载，因此必须持续跟踪：DocumentTitle 会在选中会话时写
// 「会话标题 — 产品标题」，本产品标题后缀同样需要被换成 fork 品牌。

(function () {
  var B = globalThis.__DSH_OHMY_BRAND__;
  if (!B || !B.title) return;

  // sources 是「需要被换掉的产品标题」候选集：官方占位名 + fork 构建期已注入的同串（幂等空操作）。
  var sources = [];
  var list = B.replaces || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i] && sources.indexOf(list[i]) < 0) sources.push(list[i]);
  }

  var DASH = " \u2014 "; // 「 — 」，与 DocumentTitle 的分隔符一致
  var busy = false;      // 自身写入触发的回调直接跳过，避免自激

  /*
  - 函数功能：把当前 document.title 里属于产品标题的部分换成 fork 品牌标题。
  - 匹配规则：整串等于某个 source，或以「 — <source>」结尾（后者保留前面的会话标题）。
  - 不匹配时不做任何事，因此未知/自定义产品标题不会被冲掉。
  - 幂等保护：算出的 next 与当前 title 相同就什么都不写。这既避免无谓写入，
    也防止「改写标题 → 本脚本装在 <title> 上的 MutationObserver 被触发 → 再改写」
    的自激死循环（busy 只覆盖同步写入期间，异步回调到达时已失效，挡不住该循环）。
  */
  function fix() {
    if (busy) return;
    var t = document.title;
    for (var j = 0; j < sources.length; j++) {
      var old = sources[j];
      var next;
      if (t === old) {
        next = B.title;
      } else {
        var suffix = DASH + old;
        if (t.length > suffix.length && t.slice(-suffix.length) === suffix) {
          next = t.slice(0, t.length - suffix.length) + DASH + B.title;
        } else {
          continue;
        }
      }
      if (next === t) return;
      busy = true;
      try { document.title = next; } finally { busy = false; }
      return;
    }
  }

  var mo = new MutationObserver(function () { fix(); watchTitle(); });

  /* 观察 <title> 节点本身的文本变化（React 写 document.title 即改它的文本）。 */
  function watchTitle() {
    var el = document.querySelector("title");
    if (el) mo.observe(el, { childList: true, characterData: true, subtree: true });
  }

  /* 首次执行：先改一次，再挂两类观察（title 文本 + head 子节点，防标题节点被整体替换）。 */
  function start() {
    fix();
    watchTitle();
    mo.observe(document.head, { childList: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
