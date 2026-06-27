import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./Layout";
import { RequireAuth } from "./RequireAuth";
import { CommandPalette } from "./CommandPalette";
import { LoginPage } from "@/features/auth/LoginPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { EnvSettingsPage } from "@/features/system/EnvSettingsPage";
import { WeChatPage } from "@/features/platforms/WeChatPage";
import { QqPage } from "@/features/platforms/QqPage";
import { OutboundPage } from "@/features/platforms/OutboundPage";
import { PeriodicPage } from "@/features/automation/PeriodicPage";
import { SteamPage } from "@/features/automation/SteamPage";
import { CodePage } from "@/features/code/CodePage";
import { AgentPage } from "@/features/intelligence/AgentPage";
import { NluPage } from "@/features/intelligence/NluPage";
import { AliasPage } from "@/features/intelligence/AliasPage";
import { MemoryPage } from "@/features/intelligence/MemoryPage";
import { WebsearchPage } from "@/features/intelligence/WebsearchPage";
import { UsersPage } from "@/features/users/UsersPage";
import { AboutPage } from "@/features/system/AboutPage";
import { DataPage } from "@/features/system/DataPage";
import { LogsPage } from "@/features/system/LogsPage";

export function App() {
  return (
    <>
      <div className="aurora" />
      <div className="aurora-noise" />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="platforms/wechat" element={<WeChatPage />} />
            <Route path="platforms/qq" element={<QqPage />} />
            <Route path="platforms/outbound" element={<OutboundPage />} />
            <Route path="automation/periodic" element={<PeriodicPage />} />
            <Route path="automation/steam" element={<SteamPage />} />
            <Route path="code" element={<CodePage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="intelligence/agent" element={<AgentPage />} />
            <Route path="intelligence/nlu" element={<NluPage />} />
            <Route path="intelligence/alias" element={<AliasPage />} />
            <Route path="intelligence/memory" element={<MemoryPage />} />
            <Route path="intelligence/websearch" element={<WebsearchPage />} />
            <Route path="system/env" element={<EnvSettingsPage />} />
            <Route path="system/data" element={<DataPage />} />
            <Route path="system/logs" element={<LogsPage />} />
            <Route path="system/about" element={<AboutPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
      <CommandPalette />
    </>
  );
}
