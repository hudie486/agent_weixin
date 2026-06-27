import { embedModel, embedCacheDir, embedOffline } from "./config.js";
import { l2normalize } from "./cosine.js";
import { createLogger } from "../logger.js";

const log = createLogger("embedder");

export interface Embedder {
  readonly model: string;
  /** 文档侧编码（原文，存入用） */
  embed(texts: string[]): Promise<number[][]>;
  /** 查询侧编码（自动加 bge 检索指令前缀） */
  embedQuery(text: string): Promise<number[]>;
}

/** bge-zh 检索：查询侧需加此指令前缀，文档侧不加（官方建议） */
const BGE_ZH_QUERY_PREFIX = "为这个句子生成表示以用于检索相关文章：";

type FeatureExtractor = (texts: string[], opts: unknown) => Promise<{ tolist(): number[][] }>;

class LocalBgeEmbedder implements Embedder {
  readonly model: string;
  private extractorPromise: Promise<FeatureExtractor> | null = null;

  constructor(model: string) {
    this.model = model;
  }

  private getExtractor(): Promise<FeatureExtractor> {
    if (!this.extractorPromise) {
      this.extractorPromise = (async () => {
        // 动态载入，避免无向量需求时把 onnxruntime 拉进进程
        const t = (await import("@huggingface/transformers")) as unknown as {
          env?: Record<string, unknown>;
          pipeline: (task: string, model: string) => Promise<FeatureExtractor>;
        };
        if (t.env) {
          try {
            t.env.cacheDir = embedCacheDir();
          } catch {
            /* ignore */
          }
          // 网络访问不到 huggingface.co 时，可用镜像（如 https://hf-mirror.com）
          const host = process.env.HF_ENDPOINT?.trim() || process.env.EMBED_REMOTE_HOST?.trim();
          if (host) {
            try {
              t.env.remoteHost = host;
            } catch {
              /* ignore */
            }
          }
          if (embedOffline()) {
            try {
              t.env.allowRemoteModels = false;
            } catch {
              /* ignore */
            }
          }
        }
        log.info(`加载本地嵌入模型 ${this.model}（首次会下载到 ${embedCacheDir()}，请稍候）`);
        const pipe = await t.pipeline("feature-extraction", this.model);
        log.info(`嵌入模型就绪 ${this.model}`);
        return pipe;
      })();
    }
    return this.extractorPromise;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await this.getExtractor();
    const out = await extractor(texts, { pooling: "mean", normalize: true });
    return out.tolist().map((r) => l2normalize(r));
  }

  async embedQuery(text: string): Promise<number[]> {
    const [v] = await this.embed([`${BGE_ZH_QUERY_PREFIX}${text}`]);
    return v ?? [];
  }
}

let singleton: Embedder | null = null;
let override: Embedder | null = null;

export function getEmbedder(): Embedder {
  if (override) return override;
  if (!singleton) singleton = new LocalBgeEmbedder(embedModel());
  return singleton;
}

/** 测试用：注入确定性假 embedder，避免下载真实模型 */
export function setEmbedderForTest(e: Embedder | null): void {
  override = e;
}
