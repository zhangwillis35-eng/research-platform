/**
 * Email service — QQ Mail SMTP.
 *
 * Required env vars:
 *   SMTP_USER   — QQ邮箱地址
 *   SMTP_PASS   — QQ邮箱授权码 (非登录密码)
 */

import nodemailer from "nodemailer";

let cachedTransport: nodemailer.Transporter | null = null;

function getTransport() {
  if (cachedTransport) return cachedTransport;

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) return null;

  cachedTransport = nodemailer.createTransport({
    host: "smtp.qq.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });

  return cachedTransport;
}

/** Send invite code to user after admin approval */
export async function sendInviteCode(params: {
  name: string;
  email: string;
  inviteCode: string;
}): Promise<boolean> {
  const transport = getTransport();
  const senderEmail = process.env.SMTP_USER;

  if (!transport || !senderEmail) {
    console.warn("[Email] SMTP not configured, cannot send invite code");
    return false;
  }

  try {
    await transport.sendMail({
      from: `"ScholarFlow" <${senderEmail}>`,
      to: params.email,
      subject: `你的 ScholarFlow 邀请码`,
      html: `
        <div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <div style="display: inline-block; width: 48px; height: 48px; border-radius: 12px; background: #0d9488; line-height: 48px; text-align: center; color: white; font-weight: bold; font-size: 20px;">S</div>
          </div>
          <h2 style="color: #1a1a2e; text-align: center; margin-bottom: 8px;">欢迎加入 ScholarFlow</h2>
          <p style="color: #666; text-align: center; margin-bottom: 32px;">Hi ${params.name}，你的注册申请已通过审批</p>
          <div style="background: #f0fdfa; border: 2px solid #0d948833; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
            <p style="color: #666; font-size: 14px; margin: 0 0 8px 0;">你的邀请码</p>
            <p style="font-family: monospace; font-size: 32px; font-weight: bold; color: #0d9488; letter-spacing: 4px; margin: 0;">${params.inviteCode}</p>
          </div>
          <div style="text-align: center; margin-bottom: 24px;">
            <a href="https://scholarflow-willis.cn/login" style="display: inline-block; background: #0d9488; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 500;">前往登录</a>
          </div>
          <p style="color: #999; font-size: 12px; text-align: center;">
            在登录页点击「已有邀请码」，输入上方邀请码即可完成注册。
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
          <p style="color: #bbb; font-size: 11px; text-align: center;">ScholarFlow · AI-Powered Research Platform</p>
        </div>
      `,
    });
    return true;
  } catch (err) {
    console.error("[Email] Send invite code failed:", err);
    return false;
  }
}
