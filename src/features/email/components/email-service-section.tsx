import { useState } from "react";
import { useFormContext } from "react-hook-form";
import type { SystemConfig } from "@/features/config/config.schema";
import { EMAIL_PROVIDERS, type EmailProvider } from "@/features/config/config.schema";
import type { Result } from "@/lib/errors";
import { EmailCredentialsPanel } from "./email-credentials-panel";
import { EmailDocPanel } from "./email-doc-panel";
import { EmailNotificationScope } from "./email-notification-scope";
import { EmailTestToolbar } from "./email-test-toolbar";

type ConnectionStatus = "IDLE" | "TESTING" | "SUCCESS" | "ERROR";

const PROVIDER_LABELS: Record<EmailProvider, string> = {
  resend: "Resend",
  postmark: "Postmark",
  mailgun: "Mailgun",
  sendgrid: "SendGrid",
  mandrill: "Mandrill",
};

interface EmailSectionProps {
  testEmailConnection: (options: {
    data: {
      provider: EmailProvider;
      apiKey: string;
      senderAddress: string;
      senderName?: string;
      domain?: string;
      serverId?: number;
    };
  }) => Promise<
    Result<{ success: boolean }, { reason: "SEND_FAILED"; message: string }>
  >;
}

export function EmailServiceSection({
  testEmailConnection,
}: EmailSectionProps) {
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>("IDLE");

  const {
    register,
    setValue,
    watch,
    formState: { errors },
  } = useFormContext<SystemConfig>();

  const emailConfig = watch("email");
  const provider = (emailConfig?.provider as EmailProvider) ?? "resend";
  const adminEmailEnabled = watch("notification.admin.channels.email") ?? true;
  const userEmailEnabled = watch("notification.user.emailEnabled") ?? true;

  // 当前 provider 的 apiKey 和 senderAddress
  const currentApiKey = watch(`email.${provider}.apiKey`) ?? "";
  const currentDomain = watch(`email.${provider}.domain`) ?? "";
  const currentServerId = watch(`email.${provider}.serverId`) ?? undefined;
  const currentSenderAddress = watch("email.senderAddress") ?? "";
  const currentSenderName = watch("email.senderName") ?? "";

  const isConfigured =
    !!currentApiKey.trim() && !!currentSenderAddress.trim();

  const handleProviderChange = (newProvider: EmailProvider) => {
    setValue("email.provider", newProvider, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setStatus("IDLE");
  };

  const handleTest = async () => {
    if (!isConfigured) return;
    setStatus("TESTING");

    try {
      const result = await testEmailConnection({
        data: {
          provider,
          apiKey: currentApiKey,
          senderAddress: currentSenderAddress,
          senderName: currentSenderName,
          domain: provider === "mailgun" ? currentDomain : undefined,
          serverId: provider === "postmark" ? currentServerId : undefined,
        },
      });

      if (!result.error) {
        setStatus("SUCCESS");
      } else {
        setStatus("ERROR");
      }
    } catch {
      setStatus("ERROR");
    }
  };

  return (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-2 duration-700">
      <EmailDocPanel />

      <div className="border border-border/30 bg-background/50 overflow-hidden divide-y divide-border/20">
        <EmailNotificationScope
          adminEmailEnabled={adminEmailEnabled}
          userEmailEnabled={userEmailEnabled}
          onToggleAdmin={(checked) =>
            setValue("notification.admin.channels.email", checked, {
              shouldDirty: true,
              shouldTouch: true,
              shouldValidate: true,
            })
          }
          onToggleUser={(checked) =>
            setValue("notification.user.emailEnabled", checked, {
              shouldDirty: true,
              shouldTouch: true,
              shouldValidate: true,
            })
          }
        />

        {/* Provider 切换 Tab */}
        <div className="flex items-center gap-0 border-b border-border/20">
          {EMAIL_PROVIDERS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => handleProviderChange(p)}
              className={`px-6 py-4 text-xs font-mono uppercase tracking-widest transition-all border-b-2 ${
                provider === p
                  ? "border-foreground text-foreground bg-muted/20"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/10"
              }`}
            >
              {PROVIDER_LABELS[p]}
            </button>
          ))}
        </div>

        <EmailCredentialsPanel<SystemConfig>
          register={register}
          showKey={showKey}
          provider={provider}
          senderNameError={errors.email?.senderName?.message}
          senderAddressError={errors.email?.senderAddress?.message}
          apiKeyError={errors.email?.[provider]?.apiKey?.message}
          domainError={errors.email?.mailgun?.domain?.message}
          serverIdError={errors.email?.postmark?.serverId?.message}
          onToggleKeyVisibility={() => setShowKey((prev) => !prev)}
          onFieldChange={() => setStatus("IDLE")}
        />

        <EmailTestToolbar
          status={status}
          isConfigured={isConfigured}
          onTest={handleTest}
        />
      </div>
    </div>
  );
}
