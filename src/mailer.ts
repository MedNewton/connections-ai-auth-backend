import { Resend } from "resend";
import { env } from "./env.js";

const resend = new Resend(env.resendApiKey);

export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const result = await resend.emails.send({
    from: env.emailFrom,
    to: args.to,
    subject: args.subject,
    html: args.html,
  });

  console.log("[RESEND RESULT]", result);

  const r = result as any;
  if (r?.error) throw new Error(JSON.stringify(r.error));
  if (!r?.data?.id) throw new Error("Resend returned no message id");
}
