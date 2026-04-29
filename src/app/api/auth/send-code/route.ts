import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateCode, sendSmsCode } from "@/lib/sms";

// POST /api/auth/send-code — send verification code to phone
export async function POST(request: Request) {
  try {
    const { phone } = (await request.json()) as { phone?: string };

    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
      return NextResponse.json(
        { error: "请输入有效的大陆手机号" },
        { status: 400 }
      );
    }

    // Rate limit: max 1 code per 60 seconds per phone
    const recentCode = await prisma.verificationCode.findFirst({
      where: {
        phone,
        createdAt: { gt: new Date(Date.now() - 60_000) },
      },
    });

    if (recentCode) {
      return NextResponse.json(
        { error: "发送过于频繁，请 60 秒后重试" },
        { status: 429 }
      );
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 5 * 60_000); // 5 minutes

    // Store code
    await prisma.verificationCode.create({
      data: { phone, code, expiresAt },
    });

    // Send SMS
    const sent = await sendSmsCode(phone, code);
    if (!sent) {
      return NextResponse.json(
        { error: "短信发送失败，请稍后重试" },
        { status: 500 }
      );
    }

    // Check if user already exists (to inform frontend whether to show register fields)
    const existingUser = await prisma.user.findUnique({ where: { phone } });

    const isDev = process.env.NODE_ENV !== "production";

    return NextResponse.json({
      success: true,
      isNewUser: !existingUser,
      // Dev mode: return code directly so it can be shown on page
      ...(isDev ? { devCode: code } : {}),
    });
  } catch (error) {
    console.error("[send-code]", error);
    return NextResponse.json(
      { error: "发送验证码失败", details: String(error) },
      { status: 500 }
    );
  }
}
