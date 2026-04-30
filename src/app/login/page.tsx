"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Eye, EyeOff, ArrowLeft, Check, Mail } from "lucide-react";

type Mode = "login" | "register";
type RegisterStep = "info" | "pending" | "invite";

// ─── Password visibility toggle ─────────────────
function PasswordInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="pr-10"
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        tabIndex={-1}
      >
        {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

// ─── Step indicator ──────────────────────────────
function StepIndicator({ current }: { current: number }) {
  const steps = ["填写信息", "等待审批", "输入邀请码"];
  return (
    <div className="flex items-center justify-center gap-1 mb-6">
      {steps.map((label, i) => {
        const step = i + 1;
        const isActive = step === current;
        const isDone = step < current;
        return (
          <div key={label} className="flex items-center gap-1">
            {i > 0 && (
              <div
                className={`w-8 h-px transition-colors duration-300 ${
                  isDone ? "bg-teal" : "bg-border"
                }`}
              />
            )}
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-all duration-300 ${
                  isDone
                    ? "bg-teal text-teal-foreground"
                    : isActive
                    ? "bg-teal/15 text-teal border-2 border-teal"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {isDone ? <Check className="w-3.5 h-3.5" /> : step}
              </div>
              <span
                className={`text-[10px] transition-colors duration-300 ${
                  isActive ? "text-teal font-medium" : "text-muted-foreground"
                }`}
              >
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Password strength indicator ─────────────────
function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;

  let score = 0;
  if (password.length >= 6) score++;
  if (password.length >= 10) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  const levels = [
    { label: "弱", color: "bg-red-400", width: "w-1/5" },
    { label: "弱", color: "bg-red-400", width: "w-1/5" },
    { label: "中", color: "bg-amber-400", width: "w-2/5" },
    { label: "较强", color: "bg-teal/70", width: "w-3/5" },
    { label: "强", color: "bg-teal", width: "w-4/5" },
    { label: "很强", color: "bg-teal", width: "w-full" },
  ];

  const level = levels[score];

  return (
    <div className="mt-1.5 space-y-1">
      <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${level.color} ${level.width}`}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        密码强度：{level.label}
      </p>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [checkingSession, setCheckingSession] = useState(true);

  // Login state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Register state
  const [regStep, setRegStep] = useState<RegisterStep>("info");
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regPasswordConfirm, setRegPasswordConfirm] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [devInviteCode, setDevInviteCode] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ─── Check if already logged in ────────────────
  useEffect(() => {
    fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "me" }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.user) {
          router.replace("/projects");
        } else {
          setCheckingSession(false);
        }
      })
      .catch(() => setCheckingSession(false));
  }, [router]);

  function switchMode(m: Mode) {
    setMode(m);
    setError("");
    if (m === "register") {
      setRegStep("info");
      setDevInviteCode(null);
      setInviteCode("");
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

  // ─── Register Step 1: Submit info ──────────────
  async function handleRequestRegister(e: React.FormEvent) {
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
          action: "request-register",
          name: regName,
          email: regEmail,
          password: regPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        return;
      }
      if (data.devInviteCode) setDevInviteCode(data.devInviteCode);
      setRegStep("pending");
    } finally {
      setLoading(false);
    }
  }

  // ─── Register Step 3: Verify invite code ───────
  async function handleVerifyInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteCode.trim()) {
      setError("请输入邀请码");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify-invite",
          email: regEmail,
          inviteCode,
        }),
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

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-6 h-6 border-2 border-teal border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const stepNumber = regStep === "info" ? 1 : regStep === "pending" ? 2 : 3;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <Link
        href="/"
        className="fixed top-6 left-6 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>返回首页</span>
      </Link>

      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center">
              <span className="text-primary-foreground text-xl font-bold">S</span>
            </div>
          </div>
          <CardTitle className="font-heading text-2xl">
            {mode === "login" && "登录 ScholarFlow"}
            {mode === "register" && regStep === "info" && "注册 ScholarFlow"}
            {mode === "register" && regStep === "pending" && "申请已提交"}
            {mode === "register" && regStep === "invite" && "输入邀请码"}
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-2">
            {mode === "login" && "使用邮箱和密码登录"}
            {mode === "register" && regStep === "info" && "填写注册信息，提交后等待管理员审批"}
            {mode === "register" && regStep === "pending" && "管理员审批后会将邀请码发送到你的邮箱"}
            {mode === "register" && regStep === "invite" && "输入管理员发送的邀请码完成注册"}
          </p>
        </CardHeader>

        <CardContent>
          {mode === "register" && <StepIndicator current={stepNumber} />}

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
                <PasswordInput
                  value={loginPassword}
                  onChange={(e) => { setLoginPassword(e.target.value); setError(""); }}
                  placeholder="请输入密码"
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
                  申请注册
                </button>
              </p>
              <p className="text-center text-sm text-muted-foreground">
                已有邀请码？{" "}
                <button
                  type="button"
                  onClick={() => { switchMode("register"); setRegStep("invite"); }}
                  className="text-teal hover:text-teal/80 font-medium"
                >
                  输入邀请码
                </button>
              </p>
            </form>
          )}

          {/* ═══ Register Step 1: Fill Info ═══ */}
          {mode === "register" && regStep === "info" && (
            <form onSubmit={handleRequestRegister} className="space-y-4">
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
                <PasswordInput
                  value={regPassword}
                  onChange={(e) => { setRegPassword(e.target.value); setError(""); }}
                  placeholder="至少 6 位"
                  minLength={6}
                  required
                />
                <PasswordStrength password={regPassword} />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">确认密码</label>
                <PasswordInput
                  value={regPasswordConfirm}
                  onChange={(e) => { setRegPasswordConfirm(e.target.value); setError(""); }}
                  placeholder="再次输入密码"
                  required
                />
                {regPasswordConfirm && regPassword !== regPasswordConfirm && (
                  <p className="mt-1 text-[11px] text-red-500">两次输入的密码不一致</p>
                )}
              </div>
              <Button
                type="submit"
                disabled={loading || !regName.trim() || !regEmail.trim() || !regPassword || !regPasswordConfirm}
                className="w-full bg-teal text-teal-foreground hover:bg-teal/90"
              >
                {loading ? "提交中..." : "提交注册申请"}
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

          {/* ═══ Register Step 2: Pending ═══ */}
          {mode === "register" && regStep === "pending" && (
            <div className="space-y-6 text-center">
              {devInviteCode && (
                <div className="text-sm text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 rounded-md px-3 py-2">
                  [开发模式] 邀请码：<span className="font-mono font-bold">{devInviteCode}</span>
                </div>
              )}

              <div className="flex justify-center">
                <div className="w-16 h-16 rounded-full bg-teal/10 flex items-center justify-center">
                  <Mail className="w-8 h-8 text-teal" />
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm text-foreground">
                  你的注册申请已提交，管理员将在审批后
                </p>
                <p className="text-sm text-foreground">
                  将邀请码发送至 <span className="font-medium text-teal">{regEmail}</span>
                </p>
              </div>

              <Button
                onClick={() => setRegStep("invite")}
                className="w-full bg-teal text-teal-foreground hover:bg-teal/90"
              >
                我已收到邀请码
              </Button>
              <button
                type="button"
                onClick={() => switchMode("login")}
                className="w-full text-sm text-muted-foreground hover:text-foreground"
              >
                返回登录
              </button>
            </div>
          )}

          {/* ═══ Register Step 3: Enter Invite Code ═══ */}
          {mode === "register" && regStep === "invite" && (
            <form onSubmit={handleVerifyInvite} className="space-y-4">
              {devInviteCode && (
                <div className="text-sm text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 rounded-md px-3 py-2 text-center">
                  [开发模式] 邀请码：<span className="font-mono font-bold">{devInviteCode}</span>
                </div>
              )}
              <div>
                <label className="text-sm font-medium mb-1.5 block">注册邮箱</label>
                <Input
                  type="email"
                  placeholder="注册时填写的邮箱"
                  value={regEmail}
                  onChange={(e) => { setRegEmail(e.target.value); setError(""); }}
                  required
                  autoFocus={!regEmail}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">邀请码</label>
                <Input
                  type="text"
                  placeholder="请输入 8 位邀请码"
                  value={inviteCode}
                  onChange={(e) => {
                    setInviteCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8));
                    setError("");
                  }}
                  maxLength={8}
                  className="text-center text-lg tracking-[0.3em] font-mono"
                  required
                  autoFocus={!!regEmail}
                />
              </div>
              <Button
                type="submit"
                disabled={loading || !regEmail.trim() || inviteCode.length !== 8}
                className="w-full bg-teal text-teal-foreground hover:bg-teal/90"
              >
                {loading ? "验证中..." : "完成注册"}
              </Button>
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={() => { setRegStep("info"); setError(""); }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  重新申请
                </button>
                <button
                  type="button"
                  onClick={() => switchMode("login")}
                  className="text-muted-foreground hover:text-foreground"
                >
                  返回登录
                </button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
