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
import { Eye, EyeOff, ArrowLeft, Mail } from "lucide-react";

type Mode = "login" | "register" | "pending" | "invite";

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

  // Login
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Register
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regPasswordConfirm, setRegPasswordConfirm] = useState("");

  // Invite code
  const [inviteCode, setInviteCode] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "me" }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.user) router.replace("/projects");
        else setCheckingSession(false);
      })
      .catch(() => setCheckingSession(false));
  }, [router]);

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
      if (!res.ok) { setError(data.error); return; }
      router.push("/projects");
    } finally {
      setLoading(false);
    }
  }

  // ─── Register ─────────────────────────────────
  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (regPassword.length < 6) { setError("密码至少 6 位"); return; }
    if (regPassword !== regPasswordConfirm) { setError("两次输入的密码不一致"); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "register", name: regName, email: regEmail, password: regPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setMode("pending");
    } finally {
      setLoading(false);
    }
  }

  // ─── Verify Invite Code ───────────────────────
  async function handleVerifyInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteCode.trim()) { setError("请输入邀请码"); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify-invite", email: regEmail, inviteCode }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
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

  const titles: Record<Mode, string> = {
    login: "登录 ScholarFlow",
    register: "注册 ScholarFlow",
    pending: "注册申请已提交",
    invite: "输入邀请码",
  };
  const subtitles: Record<Mode, string> = {
    login: "使用邮箱和密码登录",
    register: "填写注册信息，提交后等待管理员审批",
    pending: "管理员审批通过后，邀请码将发送至你的邮箱",
    invite: "输入收到的邀请码完成注册",
  };

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
          <CardTitle className="font-heading text-2xl">{titles[mode]}</CardTitle>
          <p className="text-sm text-muted-foreground mt-2">{subtitles[mode]}</p>
        </CardHeader>

        <CardContent>
          {error && (
            <div className="mb-4 text-sm text-red-500 bg-red-50 dark:bg-red-950/30 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          {/* ═══ Login ═══ */}
          {mode === "login" && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">邮箱</label>
                <Input type="email" placeholder="your@email.com" value={loginEmail}
                  onChange={(e) => { setLoginEmail(e.target.value); setError(""); }} required autoFocus />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">密码</label>
                <PasswordInput value={loginPassword}
                  onChange={(e) => { setLoginPassword(e.target.value); setError(""); }}
                  placeholder="请输入密码" required />
              </div>
              <Button type="submit" disabled={loading || !loginEmail.trim() || !loginPassword}
                className="w-full bg-teal text-teal-foreground hover:bg-teal/90">
                {loading ? "登录中..." : "登录"}
              </Button>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <button type="button" onClick={() => { setMode("register"); setError(""); }}
                  className="text-teal hover:text-teal/80 font-medium">注册账号</button>
                <button type="button" onClick={() => { setMode("invite"); setError(""); }}
                  className="text-teal hover:text-teal/80 font-medium">已有邀请码</button>
              </div>
            </form>
          )}

          {/* ═══ Register ═══ */}
          {mode === "register" && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">昵称</label>
                <Input placeholder="你的昵称" value={regName}
                  onChange={(e) => setRegName(e.target.value)} required autoFocus />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">邮箱</label>
                <Input type="email" placeholder="your@email.com" value={regEmail}
                  onChange={(e) => { setRegEmail(e.target.value); setError(""); }} required />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">密码</label>
                <PasswordInput value={regPassword}
                  onChange={(e) => { setRegPassword(e.target.value); setError(""); }}
                  placeholder="至少 6 位" minLength={6} required />
                <PasswordStrength password={regPassword} />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">确认密码</label>
                <PasswordInput value={regPasswordConfirm}
                  onChange={(e) => { setRegPasswordConfirm(e.target.value); setError(""); }}
                  placeholder="再次输入密码" required />
                {regPasswordConfirm && regPassword !== regPasswordConfirm && (
                  <p className="mt-1 text-[11px] text-red-500">两次输入的密码不一致</p>
                )}
              </div>
              <Button type="submit"
                disabled={loading || !regName.trim() || !regEmail.trim() || !regPassword || !regPasswordConfirm}
                className="w-full bg-teal text-teal-foreground hover:bg-teal/90">
                {loading ? "提交中..." : "提交注册申请"}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                已有账号？{" "}
                <button type="button" onClick={() => { setMode("login"); setError(""); }}
                  className="text-teal hover:text-teal/80 font-medium">去登录</button>
              </p>
            </form>
          )}

          {/* ═══ Pending ═══ */}
          {mode === "pending" && (
            <div className="space-y-6 text-center">
              <div className="flex justify-center">
                <div className="w-16 h-16 rounded-full bg-teal/10 flex items-center justify-center">
                  <Mail className="w-8 h-8 text-teal" />
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm">你的注册申请已提交</p>
                <p className="text-sm text-muted-foreground">
                  管理员审批通过后，邀请码将发送至<br />
                  <span className="font-medium text-teal">{regEmail}</span>
                </p>
              </div>
              <Button onClick={() => { setMode("invite"); setError(""); }}
                className="w-full bg-teal text-teal-foreground hover:bg-teal/90">
                我已收到邀请码
              </Button>
              <button type="button" onClick={() => { setMode("login"); setError(""); }}
                className="w-full text-sm text-muted-foreground hover:text-foreground">
                返回登录
              </button>
            </div>
          )}

          {/* ═══ Invite Code ═══ */}
          {mode === "invite" && (
            <form onSubmit={handleVerifyInvite} className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">注册邮箱</label>
                <Input type="email" placeholder="注册时填写的邮箱" value={regEmail}
                  onChange={(e) => { setRegEmail(e.target.value); setError(""); }}
                  required autoFocus={!regEmail} />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">邀请码</label>
                <Input type="text" placeholder="请输入 8 位邀请码" value={inviteCode}
                  onChange={(e) => {
                    setInviteCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8));
                    setError("");
                  }}
                  maxLength={8} className="text-center text-lg tracking-[0.3em] font-mono"
                  required autoFocus={!!regEmail} />
              </div>
              <Button type="submit" disabled={loading || !regEmail.trim() || inviteCode.length !== 8}
                className="w-full bg-teal text-teal-foreground hover:bg-teal/90">
                {loading ? "验证中..." : "完成注册"}
              </Button>
              <div className="flex items-center justify-between text-sm">
                <button type="button" onClick={() => { setMode("register"); setError(""); }}
                  className="text-muted-foreground hover:text-foreground">注册新账号</button>
                <button type="button" onClick={() => { setMode("login"); setError(""); }}
                  className="text-muted-foreground hover:text-foreground">返回登录</button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
