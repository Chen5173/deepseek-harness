# 修复：保存/刷新模型余额偶发 500（含「credentials 服务不可用」）

> 提交给作者的修复说明。完整补丁见同目录 `fix-intermittent-500.patch`（`git diff` 输出）。

## 一、问题现象

1. 安装本插件后，在 设置 → 模型余额 填入火山 AK/SK 并点「保存并刷新」：
   - 有时正常显示额度；
   - 有时整段红色 `500`；
   - 偶发伴随文案「**credentials 服务不可用，请手动编辑 ~/.dsh/.credentials.yaml**」。
2. 刷新 DeepSeek 余额时，偶发被上游 `HTTP 500` 清空成错误（正确余额被顶掉）。
3. 出错时页面只显示裸 `500`，看不到真实原因（「保存失败: …」被吞掉）。

## 二、根因分析

### 根因 1（主因）：插件未声明对 credentials/settings/fs 服务的 inject 依赖 → 激活顺序竞态

- `index.js` 声明 `export const inject = ['webServer']`，`host.js` 声明 `inject: ['timer']`，
  但 `apply()` 里直接 `ctx.get('credentials')`。
- DSH 的 Cordis 调度是「服务可用才激活插件」：**只有把依赖写进 `inject`，框架才保证激活时服务已就绪**。
- 未声明时存在竞态：插件可能在 `@deepseek-ai/dsh-credentials-local` 注册 `credentials` 服务**之前**被激活，
  于是本次进程里 `credSvc === undefined`，`/api/billing-balance/volc-keys` 直接返回
  `500 { error: 'credentials 服务不可用，请手动编辑 ~/.dsh/.credentials.yaml' }`。
- 命中与否取决于激活时机，因此表现为「时而正确、时而 500」。

### 根因 2：写凭据失败无重试（Windows 下偶发）

- `credSvc.set/unset` 写 `~/.dsh/.credentials.yaml`：跨进程文件锁（竞争最长等 30s）+ 临时文件改名替换。
- Windows 下文件被占用/杀软扫描会快速抛 `EPERM/EBUSY`，原代码直接 `500 保存失败`。

### 根因 3：上游偶发失败会清空上次正确数据

- `refresh()` 无条件把失败结果写入 `state.deepseek/state.volc`。
- DeepSeek `/user/balance`、火山 OpenAPI 偶发 `HTTP 500` 时，页面上次正确的余额/额度被错误顶掉，
  出现“正确 → 500 → 正确”的闪烁。

### 根因 4：错误信息被吞成裸 500

- 客户端 `apiGet/apiPost` 对任何非 2xx 只 `throw new Error(String(r.status))`，
  服务端返回的 `{ error: '保存失败: …' }` 等真实原因没有透出。

### 根因 5：刷新风暴

- 三个 UI（设置页/读数条/悬浮按钮）挂载时各触发一次刷新，短时间多次 POST。

## 三、修复内容（本补丁）

| 文件 | 改动 |
|---|---|
| `index.js` | `inject` 补全为 `['webServer','credentials','settings','fs']`；写凭据加 `withRetry`（3 次、仅重试快速失败，避免把 30s 锁等待放大）；`refresh()` 改用 `lastGood + mergeState`，失败保留上次成功数据并标记 `stale`；保存失败写 `ctx.logger.warn` |
| `host.js` | 同上（动态版同步）：`inject: ['timer','credentials','settings','fs']` + withRetry + mergeState + 日志 |
| `lib/client.js` | `apiGet/apiPost` 解析错误响应体、透出真实原因；三个 UI 刷新在客户端合并为一次；卡片显示「⚠ 刷新失败：…（显示上次数据）」；保存成功但额度查询暂失败时提示“将自动重试” |
| `client.js` | 动态版同步：刷新合并 + stale 提示 + 保存结果优化 |
| `package.json` | `0.2.0 → 0.2.1` |
| `README.md` | 追加 v0.2.1 更新记录 |

### 关键代码示意

```js
// index.js
export const inject = ['webServer', 'credentials', 'settings', 'fs']
```

```js
// index.js — 失败保留上次成功数据，不再被上游 500 清空
function mergeState(key, fresh) {
  if (fresh && fresh.ok) { lastGood[key] = fresh; state[key] = fresh; return true }
  const keep = lastGood[key]
  if (keep) { state[key] = { ...keep, stale: true, error: fresh && fresh.error ? fresh.error : '' } }
  else { state[key] = fresh }
  return false
}
```

```js
// index.js — 写凭据有限重试（仅快速失败）
async function withRetry(fn, tries, baseDelayMs) {
  let lastErr
  for (let i = 0; i < tries; i += 1) {
    const started = Date.now()
    try { return await fn() }
    catch (e) {
      lastErr = e
      const slow = Date.now() - started > 5000
      if (i < tries - 1 && !slow) await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)))
    }
  }
  throw lastErr
}
```

## 四、验证

- 语法校验：`node --check index.js`、`node --check lib/client.js` 通过；
  `host.js`/`client.js` 为 cordis_define 函数体，包一层函数后 `node --check` 通过。
- 建议手动验证：
  1. 重新安装插件并重启 dsh web 后，连续多次「保存并刷新」——不再出现 `credentials 服务不可用` / 裸 500；
  2. 断开网络或停掉上游后刷新——页面保留上次数据并显示「⚠ 刷新失败：…（显示上次数据）」；
  3. 观察 DSH 终端 `billing-balance: 保存火山密钥失败: …` 日志（仅失败时出现）。

## 五、改动文件清单

- README.md
- client.js
- host.js
- index.js
- lib/client.js
- package.json
