
## 8. v0.3.0（2026-11-07）

- **多架构镜像**：`ghcr.io/sakuralaaa/duck-image` 现为 `linux/amd64` + `linux/arm64` 清单。构建阶段（node、bun）固定 `$BUILDPLATFORM`，按 `TARGETARCH` 交叉编译 `bun-linux-{x64,arm64}-musl`；只有运行阶段的 `apk add` 走 QEMU。
- **duck.ai 生图实测（网页端）**：生图是 “Create Image” 工具，不是模型选择器里的模型；结果标注 GPT Image 2.5。网页只提供「提示词 + 上传图片/PDF」，没有画幅、张数、风格、质量、seed、负面提示词，一次一张，结果无 remix/variations。
  - 结论：网关协议与真实能力一致——画幅/风格写入提示词（非原生尺寸），`n>1` 为多次顺序调用，参考图走附件上传。
- **管理台杂志风**：配色/字体对齐 Sakuralaaa/blog 的 editorial 令牌（米白纸色 `#faf8f3`、墨色 `#1c1917`、砖红 `#b4232a`、Source Serif 4 + Noto Serif SC 衬线标题、1px 细线、无硬阴影、刊头墨线）。旧类名保留，语义改为杂志风。
- 文档站：已开启 GitHub Pages（Actions 源），https://sakuralaaa.github.io/duck-image/

## 9. v0.5.0（2026-11-07）

- **管理台极简重做**：页头只留一行标题，去掉副标题/说明横幅/状态 chips；错误和成功统一 toast；每页一个实心主按钮。
- **侧栏**：Logo + Duck Image；Duck Image、Duck Chat、图库 | 账号、API Key、设置 | 更多（默认收起）。
- **设置**：单列紧凑行；默认只显示联网搜索、图片生成、保存到图库、代理，其余在「高级设置」。代理并入设置，一个 URL 输入框（`socks5://user:pass@host:port`），旧地址 `#/proxy` 跳到 `#/settings?section=proxy`。
- **账号**：身份池 + 默认身份合并（旧 `#/identities`、`#/identity` 自动跳转），列表只显示名称/状态/最近使用，操作收进 … 菜单。
- **API Key**：简洁列表 + 弹窗创建。**生图页**：收紧留白，下方显示最近作品。**Duck Chat**：布局与生图页一致，历史会话放进右侧抽屉。
- **模型**：`claude-haiku-4-5` → `claude-haiku-5-5`（推定）；移除 `mistral-small-2603`、`tinfoil/gpt-oss-120b`、`tinfoil/gemma4-31b`，旧 id 作为别名回落（haiku-4-5 → haiku-5-5，其余 → gpt-6-luna）。
