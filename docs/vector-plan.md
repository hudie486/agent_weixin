# 向量落地计划（全开源 · 本地构建）

> 目标：在不引入任何外部 API、不依赖云服务的前提下，为本项目加入**语义向量**能力，支撑两个用途：
> **(A) 用户记忆**（记住"叫什么、说过的重要的话"）与 **(B) 语义意图**（别名/命令的近义召回）。
> 全部用开源模型 + 本地推理，数据不出本机。

## 0. 设计原则

1. **一套底座，两个隔离用途**：同一个 embedder + 同一套向量存储代码；但 `memory` 与 `intent` 两个命名空间**物理分库**，永不混流（避免"记忆投毒"污染意图路由，反之亦然）。
2. **本地优先、开源、可离线**：嵌入模型在本机跑（ONNX/WASM，无需 GPU、无需联网调用），可预下载后完全离线。
3. **零外部依赖、低成本**：embedding 免费（仅 CPU）；唯一可能花 token 的是"记忆自动抽取"，默认关、可开关。
4. **增量、可停**：每个阶段独立可用；总开关 `VECTOR_ENABLE` 关掉则一切退回现状（精确别名 + 现有 NLU）。
5. **复用现有设施**：原子写盘 [src/util/atomicJson.ts](../src/util/atomicJson.ts)、DeepSeek 配置 `loadNluLlmConfig`、提示词注入点 [src/prompts/](../src/prompts/index.ts)、别名存储 [src/commandModule/alias/store.ts](../src/commandModule/alias/store.ts)、确认/向导闭环。

## 1. 技术选型（全开源）

| 组件 | 选型 | 许可证 | 说明 |
|---|---|---|---|
| 嵌入模型 | **`bge-small-zh-v1.5`**（BAAI，512 维） | MIT | 中文检索一线，小（~100MB），CPU 够用 |
| 推理运行时 | **`@huggingface/transformers`**（transformers.js v3） | Apache-2.0 | 纯 JS + onnxruntime（WASM/Node），**无需原生编译**；旧名 `@xenova/transformers` |
| 向量存储 | **自研极简库**（JSONL + 内存余弦） | 本项目 | 个人规模无需 FAISS/pgvector |
| （可选放大）近似最近邻 | `hnswlib-node` 或 `sqlite-vec` | Apache/MIT | 仅当笔记量到数万级再考虑，本期不做 |

**为什么 brute-force 余弦够用**：每用户笔记数量级在百~千，512 维点积每次检索 <1ms；上 ANN 是过早优化。

**bge-zh 检索要点**（务必照做，否则召回质量打折）：
- **文档侧**（存入的笔记/锚点）：原文直接编码。
- **查询侧**（当前用户消息）：**前缀加指令** `为这个句子生成表示以用于检索相关文章：` 再编码。
- 编码统一 **mean pooling + L2 归一化**，之后相似度 = 点积。

**完全离线构建**：首次运行 transformers.js 会从 HuggingFace 拉 ONNX 模型并缓存到 `EMBED_CACHE_DIR`（默认 `data/models`）。要纯离线/可重复构建，可把模型目录预置进机器并设 `env.allowRemoteModels=false` + `env.localModelPath`。

## 2. 目录与模块

```
src/vector/
  cosine.ts        // 归一化 + 余弦/点积
  embedder.ts      // Embedder 接口 + localBgeEmbedder（transformers.js，懒加载）
  store.ts         // VectorIndex：JSONL 持久化 + 内存余弦 top-k（按 namespace/userId 分片）
  index.ts         // 对外导出 + 单例工厂
src/capabilities/memory/
  profile.ts       // 结构化档案（叫什么/偏好/长期事实）——不进向量
  notes.ts         // 情景笔记（文本 + 向量，用 src/vector）
  extractor.ts     // LLM 自动抽取候选事实（复用 loadNluLlmConfig）
  recall.ts        // buildMemoryContext(userId, message) → 注入文本
  command.ts       // /记忆 命令（添加/列表/删除/设名）
  index.ts
src/handler/steps/
  aliasSemanticStep.ts   // 用途 B：意图近义召回（插在精确别名后、NLU 前）
```

## 3. 共享底座规格

### 3.1 `cosine.ts`
```ts
export function l2normalize(v: number[]): number[];     // 存入前归一化
export function dot(a: number[], b: number[]): number;  // 归一化后即余弦
```

### 3.2 `embedder.ts`
```ts
export interface Embedder {
  readonly model: string;
  readonly dim: number;
  /** 文档侧编码（原文） */
  embed(texts: string[]): Promise<number[][]>;
  /** 查询侧编码（自动加 bge 检索指令前缀） */
  embedQuery(text: string): Promise<number[]>;
}
```
- `localBgeEmbedder`：懒加载 `pipeline("feature-extraction", EMBED_MODEL)`；`{ pooling: "mean", normalize: true }`；`embedQuery` 前缀加指令。
- 仅当 `VECTOR_ENABLE=1` 且首次用到才加载模型（不拖慢启动、不打扰 CLI-only 用户）。
- 单例缓存；并发首调用要串行化（一次加载）。

### 3.3 `store.ts`
```ts
export type VectorRecord = {
  id: string; text: string; vector: number[];
  meta?: Record<string, unknown>; createdAt: number; model: string;
};
export interface VectorIndex {
  add(rec: Omit<VectorRecord, "createdAt">): void;
  remove(id: string): void;
  all(): VectorRecord[];
  search(queryVec: number[], topK: number, minScore: number): { record: VectorRecord; score: number }[];
}
export function openVectorIndex(namespace: "memory" | "intent", userId: string): VectorIndex;
```
- 持久化：`data/vectors/<namespace>/<userId>.jsonl`（复用 [atomicJson](../src/util/atomicJson.ts) 的原子写；JSONL 便于追加，整文件重写也可，量小无所谓）。
- 首次访问载入内存缓存；`add/remove` 改内存 + 落盘。
- **模型一致性**：记录带 `model`；加载时若 `record.model !== embedder.model`，标记为"待重嵌"并在后台/下次访问时 `embedQuery` 重算（换模型不至于脏比对）。
- `search`：对内存中所有向量做点积（已归一化），排序取 top-k 且 ≥ `minScore`。

## 4. 用途 A：用户记忆

### 4.1 结构化档案 `profile.ts`（不进向量，每轮全量注入）
`data/user-memory/<userId>/profile.json`：
```ts
type UserProfile = {
  callName?: string;          // 怎么称呼
  preferences: string[];      // 偏好（简短回复、口味…）
  standingFacts: string[];    // 稳定长期事实（禁忌、身份…）
  updatedAt: number;
};
```
API：`getProfile`、`setCallName`、`addPreference`、`addFact`、`removeFact`、`renderProfileForPrompt(userId): string`。

### 4.2 情景笔记 `notes.ts`（向量层）
- `addMemoryNote(userId, text, meta?)`：`embed([text])` → `openVectorIndex("memory", userId).add(...)`。**入库前向量去重**：先 `recall` 查最相近，≥ `MEMORY_DEDUPE_MIN`(0.9) 则跳过或合并。
- `recallMemory(userId, query, topK)`：`embedQuery(query)` → `search` → 返回 top-k 笔记。
- `listNotes/removeNote`。

### 4.3 记忆生成（"用户记忆生成"，三来源，从稳到智能）
1. **显式**（P1）：`/记忆` 命令 + 自然语「记住：…」识别 → 写档案或笔记。零 LLM、可控可删。
2. **自动抽取** `extractor.ts`（P3，核心生成能力）：
   - 每轮对话后，喂用户这句（可加回复）给 DeepSeek，system 提示："抽取 0~N 条值得长期记住的原子事实（偏好/计划/人际/禁忌），无则输出 `{\"facts\":[]}`，禁止臆造"。`response_format: json_object`，temperature 0.2。
   - 每条候选 → 向量去重（4.2）→ 不重复才 `addMemoryNote`。
   - **闸门**：`MEMORY_AUTO_EXTRACT=0` 默认关；开启后仅对长度 ≥ N、且非命令/非寒暄的消息跑，控成本控噪声。
3. **巩固/反思**（P5）：接周期任务（确定性通道，零对话 token），定期对某用户笔记做"合并近义、消解矛盾、删过期"，防膨胀。

### 4.4 召回与注入 `recall.ts`
- `buildMemoryContext(userId, currentMessage): Promise<string>`：
  - `renderProfileForPrompt`（全量）+ `recallMemory(userId, currentMessage, topK=MEMORY_RECALL_TOPK)`（≥ `MEMORY_RECALL_MIN`）。
  - 拼成"关于这位用户你已知道：… "，**做长度上限**（token 预算 ~200–400）。
- 注入点：[modules/agent/module.ts](../src/modules/agent/module.ts) 拼 `sysParts` 处，紧挨现有 `userDisplayNamesForAgent()`：
  ```ts
  const mem = await buildMemoryContext(ctx.userId, text);
  if (mem) sysParts.push(mem);
  ```
- 自动抽取（若开）在该轮回复**之后**异步触发，不阻塞回复。

## 5. 用途 B：语义意图 `aliasSemanticStep.ts`

- **锚点写入**：在 [alias/store.ts](../src/commandModule/alias/store.ts) `addAlias` 与 auto-suggest 回"好"确认处，顺手把 key `embed` 进 `openVectorIndex("intent", userId)`（meta 存目标 slash）。全局别名进 `("intent", "__global__")`。
- **新步骤**：插在 [aliasStep](../src/handler/steps/aliasStep.ts)（精确）之后、`nluDispatchStep`（LLM）之前（改 [steps/index.ts](../src/handler/steps/index.ts)）：
  - `embedQuery(text)` → 搜用户库 + 全局库；
  - 余弦 ≥ `INTENT_SEMANTIC_MIN`(0.84) → `dispatchSlashText(命中 slash)`；
  - `INTENT_SEMANTIC_ASK`(0.75) ≤ score < 0.84 → 复用确认闭环问"你是想 `<slash>` 吗？回复『好』"（接 [aliasSuggestSteps](../src/handler/steps/aliasSuggestSteps.ts) 的 pending 机制）。
- 效果：没精确教过的"测一下/通不通"也能命中，并**省掉一次 DeepSeek 调用**。

## 6. 配置（env）

| 变量 | 默认 | 说明 |
|---|---|---|
| `VECTOR_ENABLE` | `0` | 向量总开关；关则全部退回现状 |
| `EMBED_MODEL` | `Xenova/bge-small-zh-v1.5` | 本地嵌入模型 |
| `EMBED_CACHE_DIR` | `data/models` | 模型缓存目录（可预置实现离线） |
| `EMBED_OFFLINE` | `0` | =1 时 `allowRemoteModels=false`，纯本地 |
| `MEMORY_ENABLE` | `0` | 用户记忆开关 |
| `MEMORY_RECALL_TOPK` | `4` | 召回条数 |
| `MEMORY_RECALL_MIN` | `0.6` | 召回相似度下限 |
| `MEMORY_DEDUPE_MIN` | `0.9` | 入库去重阈值 |
| `MEMORY_AUTO_EXTRACT` | `0` | 自动抽取开关（费 token） |
| `INTENT_SEMANTIC_ENABLE` | `0` | 语义意图开关 |
| `INTENT_SEMANTIC_MIN` | `0.84` | 直接命中阈值 |
| `INTENT_SEMANTIC_ASK` | `0.75` | 反问确认下限 |

## 7. 落地阶段与验收

| 阶段 | 交付 | 验收标准 |
|---|---|---|
| **P1 记忆 Tier1**（零向量） | `profile.ts` + `/记忆` 命令 + 注入 | `/记忆 我叫小明` 后，对话提示词含"用户自称小明"；`/记忆 列表/删除` 可用 |
| **P0 底座** | `vector/{cosine,embedder,store}.ts` + 依赖 | 单测：归一化点积正确；embedder 产出 512 维；store add/search top-k 正确；模型懒加载只一次 |
| **P2 记忆 Tier2** | `notes.ts` + `recall.ts` 接入注入 | "想去日本"存为笔记后，问"规划旅行"能召回该笔记并注入（相似度达阈） |
| **P4 语义意图** | `aliasSemanticStep` + 锚点写入 | 教过"测试→/测试"后，发"测一下"能语义命中并执行；阈值区间触发反问 |
| **P3 记忆生成** | `extractor.ts` + 去重 + 闸门 | 开启后能从陈述句抽出事实入库，重复不重复存；关闭则零调用 |
| **P5 巩固** | 周期合并/反思任务 | 定时对笔记去重合并，无对话 token |

**推荐顺序：P1 → P0 → P2 → P4 → P3 → P5**（先让它记住名字这类立刻有用的；底座随 P2 上；语义意图比自动生成更稳，靠前）。

## 8. 成本与性能

- 嵌入：**本地 CPU，¥0**。模型常驻内存 ~150MB；单条编码 ~10–50ms；检索 <1ms。
- 自动抽取（仅 P3 且开启）：每次 ≈ 一次 NLU（~0.3 分冷 / 近免费热），可关。
- 注入：每轮提示词 +~200–400 token，可忽略。
- 首次：拉模型 ~100MB + 首调加载 ~1–2s（之后常驻）。可预下载消除。

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| 模型下载/首调延迟 | 预置模型目录 + `EMBED_OFFLINE=1`；启动后台预热 |
| 记忆投毒（噪声进库） | 只存显式/高置信 + 向量去重 + P5 巩固 |
| 两库混流 | `memory`/`intent` 分命名空间分文件，接口层强制 namespace |
| 换模型导致脏比对 | 记录带 `model` 标记，不一致即重嵌 |
| 隐私 | 默认本地模型 + 本地存储；数据不出机 |
| 内存随用户增长 | 按 userId 分片，按需加载 + LRU 释放 |

## 10. 测试计划

- `vector/cosine`：归一化、点积、对称性。
- `vector/store`：add/search top-k 排序、minScore 过滤、persist→reload 一致、model 不一致标记。
- `memory/profile`：增删改、渲染注入文本。
- `memory/notes`：去重阈值（≥0.9 跳过）、召回排序。
- `memory/extractor`：mock LLM 返回，解析与去重；`MEMORY_AUTO_EXTRACT=0` 零调用。
- `aliasSemanticStep`：mock embedder，阈值分支（命中/反问/放行）。
- 嵌入器走真实模型的用例标记为可选/慢（CI 可跳过）。

## 11. 依赖

```
npm i @huggingface/transformers
```
- 体积较大（含 onnxruntime）；首次会下载模型权重到 `EMBED_CACHE_DIR`。
- Node ≥ 22（项目现状满足）。
- 许可证：transformers.js Apache-2.0、onnxruntime MIT、bge-small-zh-v1.5 MIT —— 全开源、可商用。
