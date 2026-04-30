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
import { Eye, EyeOff, ArrowLeft } from "lucide-react";

type Mode = "login" | "register";

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

  // Login state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Register state
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regPasswordConfirm, setRegPasswordConfirm] = useState("");

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

  // ─── Register ─────────────────────────────────
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
      // Registration auto-logs in — go to projects
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
            {mode === "login" ? "登录 ScholarFlow" : "注册 ScholarFlow"}
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-2">
            {mode === "login"
              ? "使用邮箱和密码登录"
              : "创建账号，开始你的学术研究之旅"}
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
                  注册
                </button>
              </p>
            </form>
          )}

          {/* ═══ Register Form ═══ */}
          {mode === "register" && (
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
                {loading ? "注册中..." : "注册"}
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
        </CardContent>
      </Card>
    </div>
  );
}
