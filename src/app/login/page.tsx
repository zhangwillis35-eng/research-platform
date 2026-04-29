"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Mode = "login" | "register";
type RegisterStep = "phone" | "code" | "info";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");

  // Login state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Register state
  const [regStep, setRegStep] = useState<RegisterStep>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regPasswordConfirm, setRegPasswordConfirm] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState(0);
  const codeInputRef = useRef<HTMLInputElement>(null);

  // Countdown timer
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // Auto-focus code input
  useEffect(() => {
    if (regStep === "code") codeInputRef.current?.focus();
  }, [regStep]);

  // Reset state when switching mode
  function switchMode(m: Mode) {
    setMode(m);
    setError("");
    if (m === "register") {
      setRegStep("phone");
      setCode("");
      setDevCode(null);
    }
  }

  // ─── Login ──────────────────────────────────────
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", email: loginEmail, password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        return;
      }
      router.push("/projects");
    } finally {
      setLoading(false);
    }
  }

  // ─── Register Step 1: Send code ─────────────────
  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setError("请输入有效的大陆手机号");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        return;
      }
      if (data.devCode) setDevCode(data.devCode);
      setCountdown(60);
      setRegStep("code");
    } finally {
      setLoading(false);
    }
  }

  // ─── Register Step 2: Verify code → next ───────
  function handleCodeNext(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) {
      setError("请输入 6 位验证码");
      return;
    }
    setError("");
    setRegStep("info");
  }

  // ─── Register Step 3: Submit registration ──────
  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (regPassword.length < 6) {
      setError("密码至少 6 位");
      return;
    }
    if (regPassword !== regPasswordConfirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register",
          phone,
          code,
          name: regName,
          email: regEmail,
          password: regPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        // If code expired, go back to code step
        if (data.error?.includes("验证码")) setRegStep("code");
        return;
      }
      router.push("/projects");
    } finally {
      setLoading(false);
    }
  }

  // ─── Resend code ───────────────────────────────
  async function handleResendCode() {
    if (countdown > 0) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        return;
      }
      if (data.devCode) setDevCode(data.devCode);
      setCountdown(60);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center">
              <span className="text-primary-foreground text-xl font-bold">S</span>
            </div>
          </div>
          <CardTitle className="font-heading text-2xl">
            {mode === "login" && "登录 ScholarFlow"}
            {mode === "register" && regStep === "phone" && "注册 ScholarFlow"}
            {mode === "register" && regStep === "code" && "验证手机号"}
            {mode === "register" && regStep === "info" && "设置账号信息"}
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-2">
            {mode === "login" && "使用邮箱和密码登录"}
            {mode === "register" && regStep === "phone" && "输入手机号验证身份"}
            {mode === "register" && regStep === "code" && `验证码已发送至 ${phone}`}
            {mode === "register" && regStep === "info" && "设置你的登录邮箱和密码"}
          </p>
        </CardHeader>

        <CardContent>
          {error && (
            <div className="mb-4 text-sm text-red-500 bg-red-50 dark:bg-red-950/30 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          {/* ═══ Login Form ═══ */}
          {mode === "login" && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">邮箱</label>
                <Input
                  type="email"
                  placeholder="your@email.com"
                  value={loginEmail}
                  onChange={(e) => { setLoginEmail(e.target.value); setError(""); }}
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">密码</label>
                <Input
                  type="password"
                  placeholder="请输入密码"
                  value={loginPassword}
                  onChange={(e) => { setLoginPassword(e.target.value); setError(""); }}
                  required
                />
              </div>
              <Button
                type="submit"
                disabled={loading || !loginEmail.trim() || !loginPassword}
                className="w-full bg-teal text-teal-foreground hover:bg-teal/90"
              >
                {loading ? "登录中..." : "登录"}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                还没有账号？{" "}
                <button
                  type="button"
                  onClick={() => switchMode("register")}
                  className="text-teal hover:text-teal/80 font-medium"
                >
                  立即注册
                </button>
              </p>
            </form>
          )}

          {/* ═══ Register Step 1: Phone ═══ */}
          {mode === "register" && regStep === "phone" && (
            <form onSubmit={handleSendCode} className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">手机号</label>
                <div className="flex gap-2">
                  <span className="flex items-center px-3 text-sm text-muted-foreground bg-muted rounded-md border">
                    +86
                  </span>
                  <Input
                    type="tel"
                    placeholder="请输入手机号"
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value.replace(/\D/g, "").slice(0, 11));
                      setError("");
                    }}
                    maxLength={11}
                    required
                    autoFocus
                  />
                </div>
              </div>
              <Button
                type="submit"
                disabled={loading || phone.length !== 11}
                className="w-full bg-teal text-teal-foreground hover:bg-teal/90"
              >
                {loading ? "发送中..." : "获取验证码"}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                已有账号？{" "}
                <button
                  type="button"
                  onClick={() => switchMode("login")}
                  className="text-teal hover:text-teal/80 font-medium"
                >
                  去登录
                </button>
              </p>
            </form>
          )}

          {/* ═══ Register Step 2: Code ═══ */}
          {mode === "register" && regStep === "code" && (
            <form onSubmit={handleCodeNext} className="space-y-4">
              {devCode && (
                <div className="text-sm text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 rounded-md px-3 py-2 text-center">
                  [开发模式] 验证码：<span className="font-mono font-bold">{devCode}</span>
                </div>
              )}
              <div>
                <label className="text-sm font-medium mb-1.5 block">验证码</label>
                <Input
                  ref={codeInputRef}
                  type="text"
                  inputMode="numeric"
                  placeholder="请输入 6 位验证码"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                    setError("");
                  }}
                  maxLength={6}
                  className="text-center text-lg tracking-[0.5em]"
                  required
                />
              </div>
              <Button
                type="submit"
                disabled={code.length !== 6}
                className="w-full bg-teal text-teal-foreground hover:bg-teal/90"
              >
                下一步
              </Button>
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={() => { setRegStep("phone"); setCode(""); setError(""); setDevCode(null); }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  更换手机号
                </button>
                <button
                  type="button"
                  onClick={handleResendCode}
                  disabled={countdown > 0 || loading}
                  className={countdown > 0 ? "text-muted-foreground cursor-not-allowed" : "text-teal hover:text-teal/80"}
                >
                  {countdown > 0 ? `${countdown}s 后重新发送` : "重新发送"}
                </button>
              </div>
            </form>
          )}

          {/* ═══ Register Step 3: Profile + Password ═══ */}
          {mode === "register" && regStep === "info" && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">昵称</label>
                <Input
                  placeholder="你的昵称"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  邮箱 <span className="text-muted-foreground font-normal">(用作登录账号)</span>
                </label>
                <Input
                  type="email"
                  placeholder="your@email.com"
                  value={regEmail}
                  onChange={(e) => { setRegEmail(e.target.value); setError(""); }}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">密码</label>
                <Input
                  type="password"
                  placeholder="至少 6 位"
                  value={regPassword}
                  onChange={(e) => { setRegPassword(e.target.value); setError(""); }}
                  minLength={6}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">确认密码</label>
                <Input
                  type="password"
                  placeholder="再次输入密码"
                  value={regPasswordConfirm}
                  onChange={(e) => { setRegPasswordConfirm(e.target.value); setError(""); }}
                  required
                />
              </div>
              <Button
                type="submit"
                disabled={loading || !regName.trim() || !regEmail.trim() || !regPassword || !regPasswordConfirm}
                className="w-full bg-teal text-teal-foreground hover:bg-teal/90"
              >
                {loading ? "注册中..." : "完成注册"}
              </Button>
              <button
                type="button"
                onClick={() => { setRegStep("code"); setError(""); }}
                className="w-full text-sm text-muted-foreground hover:text-foreground"
              >
                返回上一步
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
