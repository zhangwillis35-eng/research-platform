"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eye, EyeOff } from "lucide-react";

type Mode = "intro" | "login" | "register";

function PasswordInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        tabIndex={-1}
      >
        {visible ? (
          <EyeOff className="w-4 h-4" />
        ) : (
          <Eye className="w-4 h-4" />
        )}
      </button>
    </div>
  );
}

export default function ContributeLanding() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("intro");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const action = mode === "login" ? "login" : "register";
      const body: Record<string, string> = { action, email, password };
      if (mode === "register") body.nickname = nickname;

      const res = await fetch("/api/contributors/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "操作失败");
        return;
      }
      router.push("/contribute/dashboard");
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  if (mode === "intro") {
    return (
      <div className="space-y-8 pt-8">
        <div className="text-center space-y-4">
          <h1 className="text-3xl font-bold tracking-tight">
            分享你的职场洞察
          </h1>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto leading-relaxed">
            请描述一个你在组织、团队、课堂、社群或工作场景中观察到的真实互动事件。
            它可以是一次沉默、附和、劝说、冲突、服从、态度改变、不公平感，
            或任何让你觉得&ldquo;人在群体中为什么会这样做&rdquo;的瞬间。
          </p>
        </div>

        <Card className="max-w-md mx-auto">
          <CardContent className="pt-6 space-y-3">
            <Button
              className="w-full bg-teal text-teal-foreground hover:bg-teal/90"
              onClick={() => setMode("register")}
            >
              注册投稿账号
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setMode("login")}
            >
              已有账号，直接登录
            </Button>
          </CardContent>
        </Card>

        <div className="text-center text-sm text-muted-foreground space-y-1">
          <p>你的故事将经过 AI 匿名化处理，隐去所有真实姓名和组织信息。</p>
          <p>研究者只能看到匿名化后的学术摘要和理论标签。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-8 max-w-md mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>{mode === "login" ? "登录" : "注册"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "register" && (
              <Input
                placeholder="昵称（其他人看不到）"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                required
              />
            )}
            <Input
              type="email"
              placeholder="邮箱"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="submit"
              className="w-full bg-teal text-teal-foreground hover:bg-teal/90"
              disabled={loading}
            >
              {loading ? "处理中..." : mode === "login" ? "登录" : "注册"}
            </Button>
            <button
              type="button"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError("");
              }}
              className="w-full text-sm text-muted-foreground hover:text-foreground"
            >
              {mode === "login" ? "没有账号？去注册" : "已有账号？去登录"}
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
