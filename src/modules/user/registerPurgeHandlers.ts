import { clearInjectedEnvForUser } from "../../config/injectedEnv.js";
import { clearSession } from "../../commandModule/interactionSession.js";
import { loadCodeProjectsState, saveCodeProjectsState } from "../../plugins/codeProjects/store.js";
import { listJobsState, removeJob } from "../../plugins/periodic/index.js";
import { clearUser, loadSessionStore, saveSessionStore } from "../../session/store.js";
import { registerUserPurgeHandler } from "./purgeRegistry.js";

let registered = false;

/** 装配各业务域的用户数据清理钩子（进程内仅注册一次） */
export function registerUserPurgeHandlers(): void {
  if (registered) return;
  registered = true;

  registerUserPurgeHandler(async (uid) => {
    clearInjectedEnvForUser(uid);
  });

  registerUserPurgeHandler(async (uid) => {
    const codeState = loadCodeProjectsState();
    const before = codeState.projects.length;
    codeState.projects = codeState.projects.filter((p) => p.userId !== uid);
    delete codeState.defaultAliasByUserId[uid];
    if (codeState.projects.length !== before) {
      saveCodeProjectsState(codeState);
    }
  });

  registerUserPurgeHandler(async (uid) => {
    const jobs = (await listJobsState()).jobs.filter((j) => j.notifyUserId === uid);
    for (const j of jobs) {
      await removeJob(j.id);
    }
  });

  registerUserPurgeHandler(async (uid) => {
    const session = loadSessionStore();
    clearUser(session, uid);
    saveSessionStore(session);
  });

  registerUserPurgeHandler(async (uid) => {
    clearSession(uid);
  });
}

/** @internal 测试隔离 */
export function resetUserPurgeHandlersRegistrationForTests(): void {
  registered = false;
}
