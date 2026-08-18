import type { PluginContext, PluginHealthDiagnostics } from "@paperclipai/plugin-sdk";
import { toSecretRefPayload } from "./secret-ref-validation.js";

export type TelegramRuntimeHealth = PluginHealthDiagnostics & {
  message?: string;
  details?: Record<string, unknown>;
};

export const SECRET_RESOLUTION_DISABLED_MESSAGE = "Plugin secret references are disabled until company-scoped plugin config lands";
export const SECRET_RESOLUTION_ISSUE_URL = "https://github.com/mvanhorn/paperclip-plugin-telegram/issues/63";

// LOCAL PATCH (Marveen): `secrets.resolve` is governed the same way `config.get`
// is -- without an explicit companyId the host gate rejects the call with
// "company context is required" (host-client-factory.ts resolveRequiredCompanyId),
// and setup() carries no invocation scope. Upstream still calls it unscoped, so
// the bot token never resolves on paperclipai >= 2026.722 and the plugin reports
// the unrelated "secret refs disabled" diagnosis from issue #63. Pass the company
// that owns the stored config.
export async function resolveStartupTelegramBotToken(
  ctx: PluginContext,
  tokenRef: string,
  setHealth: (health: TelegramRuntimeHealth) => void,
  companyId?: string | null,
): Promise<string | undefined> {
  try {
    const token = await ctx.secrets.resolve(
      toSecretRefPayload(tokenRef) ?? tokenRef,
      companyId ? { companyId, configPath: "telegramBotTokenRef" } : {},
    );
    setHealth({ status: "ok" });
    return token;
  } catch (err) {
    const error = String(err);
    setHealth({
      status: "degraded",
      message: SECRET_RESOLUTION_DISABLED_MESSAGE,
      details: {
        issue: "paperclip-plugin-secret-resolution-disabled",
        reference: SECRET_RESOLUTION_ISSUE_URL,
      },
    });
    ctx.logger.error("Telegram plugin cannot resolve bot token secret; runtime features are disabled", {
      error,
      reference: SECRET_RESOLUTION_ISSUE_URL,
    });
    return undefined;
  }
}
