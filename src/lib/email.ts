/**
 * Email service for sending registration notifications to admin.
 *
 * Uses QQ Mail SMTP. Required env vars:
 *   SMTP_USER      — QQ邮箱地址 (e.g. 291950574@qq.com)
 *   SMTP_PASS      — QQ邮箱授权码 (非登录密码，在 设置→账户→POP3/SMTP 中获取)
 *   ADMIN_EMAIL    — 接收注册通知的管理员邮箱 (默认 291950574@qq.com)
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

/** Send registration notification to admin */
export async function notifyAdminNewRegistration(params: {
  name: string;
  email: string;
  inviteCode: string;
}): Promise<boolean> {
  const transport = getTransport();
  const adminEmail = process.env.ADMIN_EMAIL || "291950574@qq.com";
  const senderEmail = process.env.SMTP_USER;

  if (!transport || !senderEmail) {
    // Dev fallback: log to console
    console.log(`\n========================================`);
    console.log(`  [DEV] 新注册申请`);
    console.log(`  姓名: ${params.name}`);
    console.log(`  邮箱: ${params.email}`);
    console.log(`  邀请码: ${params.inviteCode}`);
    console.log(`========================================\n`);
    return true;
  }

  try {
    await transport.sendMail({
      from: `"ScholarFlow" <${senderEmail}>`,
      to: adminEmail,
      subject: `[ScholarFlow] 新用户注册申请 — ${params.name}`,
      html: `
        <div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #1a1a2e; margin-bottom: 24px;">新用户注册申请</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 12px; color: #666; width: 80px;">昵称</td>
              <td style="padding: 8px 12px; font-weight: 500;">${params.name}</td>
            </tr>
            <tr>
              <td style="padding: 8px 12px; color: #666;">邮箱</td>
              <td style="padding: 8px 12px; font-weight: 500;">${params.email}</td>
            </tr>
            <tr>
              <td style="padding: 8px 12px; color: #666;">邀请码</td>
              <td style="padding: 8px 12px; font-family: monospace; font-size: 18px; font-weight: bold; color: #0d9488; letter-spacing: 2px;">${params.inviteCode}</td>
            </tr>
          </table>
          <p style="margin-top: 24px; color: #666; font-size: 14px;">
            审批通过后，请将上述邀请码发送到用户邮箱 <strong>${params.email}</strong>。
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
          <p style="color: #999; font-size: 12px;">ScholarFlow · AI Research Platform</p>
        </div>
      `,
    });
    return true;
  } catch (err) {
    console.error("[Email] Send failed:", err);
    return false;
  }
}
