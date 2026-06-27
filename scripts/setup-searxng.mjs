// 一次性安装 SearXNG 到本工程 searxng/ 下（venv + pip + settings.yml）。
// 用法：npm run searxng:setup
// 网络受限时可用镜像：
//   PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
//   SEARXNG_PIP_TARGET=git+https://gitclone.com/github.com/searxng/searxng.git   # github 不可达时的镜像
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const dir = path.join(root, "searxng");
const venv = path.join(dir, "venv");
const isWin = process.platform === "win32";
const venvPy = path.join(venv, isWin ? "Scripts/python.exe" : "bin/python");
const settings = path.join(dir, "settings.yml");

fs.mkdirSync(dir, { recursive: true });

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: dir });
  if (r.status !== 0) {
    console.error(`\n失败：${cmd} ${args.join(" ")}（exit ${r.status}）`);
    process.exit(r.status ?? 1);
  }
}

// 1) venv
if (!fs.existsSync(venvPy)) {
  console.log("创建 Python venv…");
  const pyCmd = isWin ? "py" : "python3";
  run(pyCmd, ["-m", "venv", venv]);
} else {
  console.log("venv 已存在，跳过");
}

// 2) 取 SearXNG 源码：仓库含非法冒号文件名（utils/.../searxng.conf:socket），
//    Windows 无法 checkout，故用 sparse-checkout 排除 utils/（仅部署模板，运行用不到）。
const mirror = process.env.PIP_INDEX_URL || "https://pypi.tuna.tsinghua.edu.cn/simple";
const src = path.join(dir, "src");
const repo = process.env.SEARXNG_GIT_URL || "https://github.com/searxng/searxng.git";
// 仓库 utils/ 下有非法冒号文件名，Windows 连 index 都加载不了。用 pathspec 排除 utils/ 全量检出其余。
console.log("克隆 SearXNG 源码（pathspec 排除 utils/）…");
fs.rmSync(src, { recursive: true, force: true });
run("git", ["clone", "--depth", "1", "--no-checkout", repo, src]);
run("git", ["-C", src, "checkout", "HEAD", "--", ".", ":(exclude)utils"]);
run(venvPy, ["-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel", "-i", mirror]);
// SearXNG 的构建后端会 import 自身包取版本（依赖 msgspec 等），故先装运行依赖，再 --no-build-isolation 安装本体
const reqs = path.join(src, "requirements.txt");
if (fs.existsSync(reqs)) {
  console.log("安装 SearXNG 运行依赖（较多，请耐心）…");
  run(venvPy, ["-m", "pip", "install", "-r", reqs, "-i", mirror]);
}
console.log("安装 SearXNG 本体…");
run(venvPy, ["-m", "pip", "install", "--no-build-isolation", src, "-i", mirror]);

// 3) settings.yml（含随机 secret，开启 json 输出，绑定本地）
if (!fs.existsSync(settings)) {
  const secret = crypto.randomBytes(32).toString("hex");
  const yaml = `# 由 scripts/setup-searxng.mjs 生成；随本工程启动
# 警告：YAML 的 true/false 是布尔值，切勿被浏览器/编辑器的「自动翻译」插件改成「正确/假」，
#       否则 SearXNG 启动会报 ValueError: Invalid value for use_default_settings。
use_default_settings: true
general:
  instance_name: "local-assistant"
server:
  bind_address: "127.0.0.1"
  port: 8888
  secret_key: "${secret}"
  limiter: false
  public_instance: false
search:
  formats:
    - html
    - json
outgoing:
  request_timeout: 10.0
  # 访问不到 google/duckduckgo 等上游引擎时，让 SearXNG 出站走你的代理后再试：
  # proxies:
  #   all://:
  #     - http://127.0.0.1:10808
  #     # 若 10808 是 SOCKS 端口，改用：socks5h://127.0.0.1:10808（需 pip install "httpx[socks]"）
ui:
  static_use_hash: true
`;
  fs.writeFileSync(settings, yaml, "utf8");
  console.log(`已写入 ${settings}`);
} else {
  console.log("settings.yml 已存在，跳过");
}

// 4) Windows pwd 垫片：SearXNG valkeydb 顶层 import pwd（Unix-only），仅 valkey 启用时调用，空实现即可
const shimDir = path.join(dir, "shims");
fs.mkdirSync(shimDir, { recursive: true });
fs.writeFileSync(
  path.join(shimDir, "pwd.py"),
  [
    "import collections",
    'struct_passwd = collections.namedtuple("struct_passwd", "pw_name pw_passwd pw_uid pw_gid pw_gecos pw_dir pw_shell")',
    "def getpwuid(uid):",
    '    return struct_passwd("searxng", "x", uid if isinstance(uid, int) else 0, 0, "", "/", "")',
    "def getpwnam(name):",
    '    return struct_passwd(name, "x", 0, 0, "", "/", "")',
    "def getpwall():",
    "    return []",
    "",
  ].join("\n"),
  "utf8",
);
console.log("已写入 Windows pwd 垫片 searxng/shims/pwd.py");

console.log(`
✅ SearXNG 安装完成。接下来在 .env 设置：
   WEBSEARCH_ENABLE=1
   SEARXNG_AUTOSTART=1
   SEARXNG_URL=http://127.0.0.1:8888
   NO_PROXY=localhost,127.0.0.1
然后重启工程即可随之启动。手动单测：
   ${venvPy} -m searx.webapp   (设 SEARXNG_SETTINGS_PATH=${settings})
`);
