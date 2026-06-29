import {
  LayoutDashboard,
  MessageCircle,
  Bot,
  Send,
  Sparkles,
  Brain,
  Tag,
  Database,
  Search,
  Clock,
  Gamepad2,
  Code2,
  Users,
  SlidersHorizontal,
  HardDrive,
  ScrollText,
  Info,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  path: string;
  label: string;
  icon: LucideIcon;
  ready?: boolean;
};

export type NavGroup = {
  group: string;
  items: NavItem[];
};

export const NAV: NavGroup[] = [
  {
    group: "",
    items: [{ path: "/", label: "总览", icon: LayoutDashboard, ready: true }],
  },
  {
    group: "平台",
    items: [
      { path: "/platforms/wechat", label: "微信", icon: MessageCircle, ready: true },
      { path: "/platforms/qq", label: "QQ 机器人", icon: Bot, ready: true },
      { path: "/platforms/outbound", label: "出站与重试", icon: Send, ready: true },
    ],
  },
  {
    group: "智能",
    items: [
      { path: "/intelligence/agent", label: "Agent 后端", icon: Sparkles, ready: true },
      { path: "/intelligence/nlu", label: "NLU 抽槽", icon: Brain, ready: true },
      { path: "/intelligence/alias", label: "别名", icon: Tag, ready: true },
      { path: "/intelligence/memory", label: "记忆与向量", icon: Database, ready: true },
      { path: "/intelligence/websearch", label: "联网检索", icon: Search, ready: true },
    ],
  },
  {
    group: "自动化",
    items: [
      { path: "/automation/periodic", label: "周期任务", icon: Clock, ready: true },
      { path: "/automation/steam", label: "Steam 监控", icon: Gamepad2, ready: true },
    ],
  },
  {
    group: "代码与用户",
    items: [
      { path: "/code", label: "代码项目", icon: Code2, ready: true },
      { path: "/users", label: "用户", icon: Users, ready: true },
    ],
  },
  {
    group: "系统",
    items: [
      { path: "/system/env", label: "环境变量", icon: SlidersHorizontal, ready: true },
      { path: "/system/data", label: "数据与备份", icon: HardDrive, ready: true },
      { path: "/system/logs", label: "日志", icon: ScrollText, ready: true },
      { path: "/system/about", label: "关于 / 重启", icon: Info, ready: true },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV.flatMap((g) => g.items);
