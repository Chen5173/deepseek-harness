// dsh-oh-my-dsh-config 的浏览器半边（客户端 bundle，__ModuleLoader__ 工厂格式）。
//
// 分工：宿主半边（src/index.js）在每次页面请求时把品牌事实写进
// globalThis.__DSH_OHMY_BRAND__（webserver/index-inject 的 global 行），本半边在
// 侧栏品牌名槽（sidebar.brand.name，官方 single 槽）注册一个多行品牌组件：
//   品牌名 / 版本行（release + cv.build）/ commit 行。
//
// 几何放宽为什么用 inline style 而不是 CSS 选择器：外壳的 .logoRow/.brandIdentity/
// .brandName 是 CSS Modules 哈希类名（rebase 上游会变），且老浏览器（尤其手机
// Safari/Chrome）不支持 :has()。所以组件挂载后通过 ref 拿到自己的根元素，直接给
// 祖先盒子设 inline style（height/align-items）——inline style 优先级最高、零选择器
// 依赖、随组件卸载自动消失。宿主半边注入的 <style> 只负责本组件自己元素的样式
// （[data-ohmy-brand] 与 .omd-brand-*，简单属性/类选择器，全浏览器支持）。
//
// 构建说明：这是手写维护的工厂包，零构建步骤——react / @deepseek-ai/cordis /
// @deepseek-ai/dsh-client-ui-slots 都走浏览器模块表的 require（PLATFORM_MODULES 种子，
// 见 packages/client/web/src/platform.ts），本文件只把插件描述符交给
// window.__ModuleLoader__.load。改组件逻辑时请同步更新这里并跑 scripts/verify.mjs。
//
// 非 fork 检出安全：__DSH_OHMY_BRAND__ 缺失时宿主半边不注入、本半边也不注册槽，
// 外壳回退显示官方占位名——与宿主半边「按基线标记文件自检」的语义一致。

window.__ModuleLoader__.load({
  id: "dsh-oh-my-dsh-config",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require("react");
    const name = "dsh-oh-my-dsh-config/client";
    // 只需要 slots 服务（ctx.slots.register）；文案硬编码，不依赖 locale。
    const inject = ["slots"];
    /** 外壳品牌盒的几何放宽：.brandName/.brandIdentity/.logoRow 是哈希类名，且
     * 老浏览器不支持 :has()，所以直接给祖先设 inline style。幂等，可重复执行。 */
    function relaxAncestors(el) {
      if (el === null || el === undefined) return;
      const nameBox = el.parentElement;
      if (nameBox !== null) {
        nameBox.style.height = "auto";
        nameBox.style.alignItems = "flex-start";
      }
      const identity = nameBox === null ? null : nameBox.parentElement;
      if (identity !== null) identity.style.height = "auto";
      const row = identity === null || identity.parentElement === null
        ? null
        : identity.parentElement.parentElement;
      if (row !== null) row.style.height = "66px";
    }
    /** 多行品牌块：读宿主注入的全局事实；缺失返回 null（外壳 fallback 接管）。 */
    function BrandNameBlock() {
      const anchorRef = React.useRef(null);
      React.useEffect(() => { relaxAncestors(anchorRef.current); }, []);
      const facts = globalThis.__DSH_OHMY_BRAND__;
      if (facts === undefined || facts === null) return null;
      const children = [
        React.createElement("span", { className: "omd-brand-line", key: "line" }, facts.brand),
        React.createElement("span", { className: "omd-brand-meta", key: "meta" },
          "版本：" + facts.release + " / " + facts.build),
      ];
      if (typeof facts.commit === "string" && facts.commit !== "") {
        children.push(React.createElement("span", { className: "omd-brand-meta", key: "commit" },
          "commit: " + facts.commit));
      }
      return React.createElement("span", { "data-ohmy-brand": true, ref: anchorRef }, children);
    }
    /** 注册品牌名槽；全局缺失（非 fork 检出）时整体跳过。 */
    function apply(ctx) {
      if (globalThis.__DSH_OHMY_BRAND__ === undefined) return;
      ctx.slots.register({
        name: "sidebar.brand.name",
        id: "dsh-oh-my-dsh-config-brand",
        priority: -1
      }, BrandNameBlock);
    }
    module.exports = { name, inject, apply, relaxAncestors };
    return module.exports;
  }
});
