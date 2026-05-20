/** @deprecated 实现已迁至 platforms/wechat/ilinkPolicy.ts（仅微信使用） */
export {
  ILINK_LIMIT_HINT,
  ILINK_WINDOW_HINT,
  loadWechatIlinkPolicyConfig as loadSessionPolicyConfig,
  gateWechatIlinkOutbound as gateOutbound,
  withWechatIlinkHints as withSessionHints,
  type WechatIlinkPolicyConfig as SessionPolicyConfig,
  type WechatIlinkGateResult as GateResult,
} from "../platforms/wechat/ilinkPolicy.js";
