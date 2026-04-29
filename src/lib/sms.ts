/**
 * SMS verification code service.
 *
 * Uses Aliyun SMS in production, console log in development.
 *
 * Required env vars for production:
 *   ALIYUN_ACCESS_KEY_ID
 *   ALIYUN_ACCESS_KEY_SECRET
 *   ALIYUN_SMS_SIGN_NAME        — 短信签名 (e.g. "ScholarFlow")
 *   ALIYUN_SMS_TEMPLATE_CODE    — 验证码模板编号 (e.g. "SMS_123456")
 */

import Dysmsapi, * as $Dysmsapi from "@alicloud/dysmsapi20170525";
import * as $OpenApi from "@alicloud/openapi-client";
import * as $Util from "@alicloud/tea-util";

let cachedClient: Dysmsapi | null = null;

function getClient(): Dysmsapi | null {
  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;

  if (!accessKeyId || !accessKeySecret) return null;

  if (!cachedClient) {
    const config = new $OpenApi.Config({
      accessKeyId,
      accessKeySecret,
      endpoint: "dysmsapi.aliyuncs.com",
    });
    cachedClient = new Dysmsapi(config);
  }
  return cachedClient;
}

/** Generate a 6-digit code */
export function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/** Send SMS verification code. Returns true on success. */
export async function sendSmsCode(
  phone: string,
  code: string
): Promise<boolean> {
  const client = getClient();

  // Development mode: log to console
  if (!client) {
    console.log(`\n========================================`);
    console.log(`  [DEV SMS] 手机号: ${phone}`);
    console.log(`  [DEV SMS] 验证码: ${code}`);
    console.log(`========================================\n`);
    return true;
  }

  // Production: send via Aliyun
  const request = new $Dysmsapi.SendSmsRequest({
    phoneNumbers: phone,
    signName: process.env.ALIYUN_SMS_SIGN_NAME!,
    templateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE!,
    templateParam: JSON.stringify({ code }),
  });

  const runtime = new $Util.RuntimeOptions({});

  try {
    const resp = await client.sendSmsWithOptions(request, runtime);
    if (resp.body?.code === "OK") {
      return true;
    }
    console.error("[SMS] Send failed:", resp.body?.message);
    return false;
  } catch (err) {
    console.error("[SMS] Error:", err);
    return false;
  }
}
