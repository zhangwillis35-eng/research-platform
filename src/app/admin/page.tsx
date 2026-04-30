"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Types ──────────────────────────────────────
interface Stats {
  overview: {
    totalUsers: number;
    totalProjects: number;
    totalPapers: number;
    totalChats: number;
    totalSearches: number;
  };
  recent: {
    users: number;
    projects: number;
    papers: number;
    chats: number;
    searches: number;
  };
  users: Array<{
    id: string;
    name: string | null;
    email: string | null;
    createdAt: string;
    projectCount: number;
    totalPapers: number;
    totalSearches: number;
    totalChats: number;
    totalIdeas: number;
    lastActive: string;
    projects: Array<{
      id: string;
      name: string;
      papers: number;
      searches: number;
      chats: number;
      ideas: number;
      updatedAt: string;
    }>;
  }>;
  dailyActivity: {
    searches: Array<{ date: string; count: number }>;
    chats: Array<{ date: string; count: number }>;
    papers: Array<{ date: string; count: number }>;
    users: Array<{ date: string; count: number }>;
  };
  apiLogs: {
    totalThisWeek: number;
    topPaths: Array<{ path: string; count: number; avgDuration: number }>;
  };
  pendingRegistrations: Array<{
    id: string;
    name: string;
    email: string;
    inviteCode: string;
    createdAt: string;
  }>;
  tokenUsage: {
    byProvider: Array<{ provider: string; model: string; totalInput: number; totalOutput: number; calls: number }>;
    byUser: Array<{ userId: string; name: string | null; email: string | null; totalInput: number; totalOutput: number; calls: number }>;
    daily: Array<{ date: string; provider: string; totalInput: number; totalOutput: number; calls: number }>;
    userProvider: Array<{ userId: string; name: string | null; email: string | null; provider: string; model: string; totalInput: number; totalOutput: number; calls: number }>;
  };
}

// ─── Login Form ─────────────────────────────────
function LoginForm({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", username, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "登录失败");
        return;
      }
      onLogin();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-emerald-600 flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-xl font-bold">S</span>
          </div>
          <h1 className="text-xl font-bold text-white">ScholarFlow Admin</h1>
          <p className="text-sm text-zinc-500 mt-1">Developer Dashboard</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-sm text-red-400 bg-red-950/50 border border-red-900 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-zinc-400 mb-1.5 block">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-zinc-900 border border-zinc-800 text-white text-sm focus:outline-none focus:border-emerald-600 transition-colors"
              autoFocus
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-400 mb-1.5 block">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-zinc-900 border border-zinc-800 text-white text-sm focus:outline-none focus:border-emerald-600 transition-colors"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full h-10 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Stat Card ──────────────────────────────────
function StatCard({
  label,
  value,
  delta,
}: {
  label: string;
  value: number;
  delta?: number;
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <p className="text-xs text-zinc-500 font-medium">{label}</p>
      <p className="text-2xl font-bold text-white mt-1 tabular-nums">{value.toLocaleString()}</p>
      {delta !== undefined && delta > 0 && (
        <p className="text-xs text-emerald-400 mt-1">+{delta} this week</p>
      )}
    </div>
  );
}

// ─── Mini Bar Chart ─────────────────────────────
function MiniChart({
  data,
  label,
  color = "bg-emerald-500",
}: {
  data: Array<{ date: string; count: number }>;
  label: string;
  color?: string;
}) {
  if (!data.length) return null;
  const max = Math.max(...data.map((d) => d.count), 1);
  const last14 = data.slice(-14);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <p className="text-xs text-zinc-500 font-medium mb-3">{label} (Last 14 days)</p>
      <div className="flex items-end gap-1 h-16">
        {last14.map((d, i) => (
          <div
            key={i}
            className="flex-1 flex flex-col items-center gap-1"
            title={`${new Date(d.date).toLocaleDateString("zh-CN")}: ${d.count}`}
          >
            <div
              className={`w-full rounded-sm ${color} transition-all`}
              style={{ height: `${Math.max((d.count / max) * 100, 4)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-zinc-600">
          {last14[0] && new Date(last14[0].date).toLocaleDateString("zh-CN", { month: "short", day: "numeric" })}
        </span>
        <span className="text-[10px] text-zinc-600">Today</span>
      </div>
    </div>
  );
}

// ─── Dashboard ──────────────────────────────────
function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/stats");
      if (!res.ok) {
        if (res.status === 401) {
          window.location.reload();
          return;
        }
        return;
      }
      const data = await res.json();
      setStats(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, [fetchStats]);

  async function handleLogout() {
    await fetch("/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    window.location.reload();
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!stats) return null;

  const { overview, recent, users, dailyActivity, apiLogs, pendingRegistrations, tokenUsage } = stats;

  async function handleApprove(id: string) {
    const res = await fetch("/api/admin/stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", id }),
    });
    const data = await res.json();
    if (data.success) {
      if (data.emailSent) {
        alert(`邀请码已发送至 ${data.email}`);
      } else {
        alert(`SMTP 未配置，请手动将邀请码发给用户：\n\n邮箱: ${data.email}\n邀请码: ${data.inviteCode}`);
      }
      fetchStats();
    }
  }

  async function handleReject(id: string) {
    if (!confirm("确认拒绝该注册申请？")) return;
    await fetch("/api/admin/stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", id }),
    });
    fetchStats();
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex h-14 items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-emerald-600 flex items-center justify-center">
              <span className="text-white text-xs font-bold">S</span>
            </div>
            <span className="font-bold text-sm">ScholarFlow Admin</span>
            <span className="text-xs text-zinc-600 bg-zinc-900 px-2 py-0.5 rounded">Developer</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={fetchStats}
              className="text-xs text-zinc-500 hover:text-white transition-colors"
            >
              Refresh
            </button>
            <button
              onClick={handleLogout}
              className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Overview Cards */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-400 mb-4">Overview</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard label="Total Users" value={overview.totalUsers} delta={recent.users} />
            <StatCard label="Total Projects" value={overview.totalProjects} delta={recent.projects} />
            <StatCard label="Total Papers" value={overview.totalPapers} delta={recent.papers} />
            <StatCard label="Total Searches" value={overview.totalSearches} delta={recent.searches} />
            <StatCard label="Total Chats" value={overview.totalChats} delta={recent.chats} />
          </div>
        </section>

        {/* Pending Registrations */}
        {pendingRegistrations.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-amber-400 mb-4">
              Pending Registrations ({pendingRegistrations.length})
            </h2>
            <div className="space-y-2">
              {pendingRegistrations.map((r) => (
                <div key={r.id} className="bg-zinc-900 border border-amber-900/50 rounded-xl px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-8 h-8 rounded-full bg-amber-950 flex items-center justify-center text-sm font-medium text-amber-400">
                      {r.name[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{r.name}</p>
                      <p className="text-xs text-zinc-500">{r.email}</p>
                    </div>
                    <span className="text-xs text-zinc-600">
                      {new Date(r.createdAt).toLocaleString("zh-CN")}
                    </span>
                    <span className="text-xs font-mono text-zinc-600 bg-zinc-800 px-2 py-0.5 rounded">
                      {r.inviteCode}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleApprove(r.id)}
                      className="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
                    >
                      Approve & Send
                    </button>
                    <button
                      onClick={() => handleReject(r.id)}
                      className="px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-red-900 text-zinc-400 hover:text-red-400 rounded-lg transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Activity Charts */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-400 mb-4">Daily Activity</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
            <MiniChart data={dailyActivity.searches} label="Searches" color="bg-emerald-500" />
            <MiniChart data={dailyActivity.chats} label="Chats" color="bg-blue-500" />
            <MiniChart data={dailyActivity.papers} label="Papers Added" color="bg-amber-500" />
            <MiniChart data={dailyActivity.users} label="New Users" color="bg-purple-500" />
          </div>
        </section>

        {/* Token Usage — By Provider */}
        {tokenUsage.byProvider.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-zinc-400 mb-4">LLM Token Usage — By Model</h2>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left px-4 py-2 text-xs text-zinc-500 font-medium">Provider</th>
                    <th className="text-left px-4 py-2 text-xs text-zinc-500 font-medium">Model</th>
                    <th className="text-right px-4 py-2 text-xs text-zinc-500 font-medium">Calls</th>
                    <th className="text-right px-4 py-2 text-xs text-zinc-500 font-medium">Input Tokens</th>
                    <th className="text-right px-4 py-2 text-xs text-zinc-500 font-medium">Output Tokens</th>
                    <th className="text-right px-4 py-2 text-xs text-zinc-500 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {tokenUsage.byProvider.map((p, i) => (
                    <tr key={i} className="border-b border-zinc-800/50 last:border-0">
                      <td className="px-4 py-2 text-zinc-300 font-medium">{p.provider}</td>
                      <td className="px-4 py-2 font-mono text-xs text-zinc-400">{p.model}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-zinc-400">{p.calls.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-zinc-400">{p.totalInput.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-zinc-400">{p.totalOutput.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-white font-medium">{(p.totalInput + p.totalOutput).toLocaleString()}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-zinc-700 bg-zinc-950/50">
                    <td colSpan={2} className="px-4 py-2 text-zinc-300 font-medium">Total</td>
                    <td className="px-4 py-2 text-right tabular-nums text-zinc-300 font-medium">
                      {tokenUsage.byProvider.reduce((s, p) => s + p.calls, 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-zinc-300 font-medium">
                      {tokenUsage.byProvider.reduce((s, p) => s + p.totalInput, 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-zinc-300 font-medium">
                      {tokenUsage.byProvider.reduce((s, p) => s + p.totalOutput, 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-emerald-400 font-bold">
                      {tokenUsage.byProvider.reduce((s, p) => s + p.totalInput + p.totalOutput, 0).toLocaleString()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Token Usage — By User */}
        {tokenUsage.byUser.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-zinc-400 mb-4">LLM Token Usage — By User</h2>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left px-4 py-2 text-xs text-zinc-500 font-medium">User</th>
                    <th className="text-right px-4 py-2 text-xs text-zinc-500 font-medium">Calls</th>
                    <th className="text-right px-4 py-2 text-xs text-zinc-500 font-medium">Input</th>
                    <th className="text-right px-4 py-2 text-xs text-zinc-500 font-medium">Output</th>
                    <th className="text-right px-4 py-2 text-xs text-zinc-500 font-medium">Total Tokens</th>
                    <th className="text-left px-4 py-2 text-xs text-zinc-500 font-medium">Breakdown</th>
                  </tr>
                </thead>
                <tbody>
                  {tokenUsage.byUser.map((u) => {
                    const userBreakdown = tokenUsage.userProvider.filter((up) => up.userId === u.userId);
                    return (
                      <tr key={u.userId} className="border-b border-zinc-800/50 last:border-0">
                        <td className="px-4 py-2">
                          <p className="text-zinc-300 font-medium">{u.name ?? "Unnamed"}</p>
                          <p className="text-xs text-zinc-600">{u.email}</p>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-zinc-400">{u.calls.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-zinc-400">{u.totalInput.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-zinc-400">{u.totalOutput.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-white font-medium">{(u.totalInput + u.totalOutput).toLocaleString()}</td>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap gap-1">
                            {userBreakdown.map((b, i) => (
                              <span key={i} className="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded" title={`${b.model}: ${(b.totalInput + b.totalOutput).toLocaleString()} tokens`}>
                                {b.provider} {(b.totalInput + b.totalOutput).toLocaleString()}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* API Logs */}
        {apiLogs.topPaths.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-zinc-400 mb-4">
              API Calls <span className="text-zinc-600">({apiLogs.totalThisWeek.toLocaleString()} this week)</span>
            </h2>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left px-4 py-2 text-xs text-zinc-500 font-medium">Endpoint</th>
                    <th className="text-right px-4 py-2 text-xs text-zinc-500 font-medium">Calls</th>
                    <th className="text-right px-4 py-2 text-xs text-zinc-500 font-medium">Avg Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {apiLogs.topPaths.map((p) => (
                    <tr key={p.path} className="border-b border-zinc-800/50 last:border-0">
                      <td className="px-4 py-2 font-mono text-xs text-zinc-300">{p.path}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-zinc-400">{p.count}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-zinc-400">{p.avgDuration}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* User Details */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-400 mb-4">
            Users <span className="text-zinc-600">({users.length})</span>
          </h2>
          <div className="space-y-2">
            {users.map((u) => (
              <div key={u.id} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                <div
                  className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-zinc-800/50 transition-colors"
                  onClick={() => setExpandedUser(expandedUser === u.id ? null : u.id)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-sm font-medium text-zinc-400">
                      {(u.name ?? "?")[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{u.name ?? "Unnamed"}</p>
                      <p className="text-xs text-zinc-500">{u.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 text-xs text-zinc-500">
                    <span>{u.projectCount} projects</span>
                    <span>{u.totalPapers} papers</span>
                    <span>{u.totalSearches} searches</span>
                    <span>{u.totalChats} chats</span>
                    <span className="text-zinc-600">
                      Joined {new Date(u.createdAt).toLocaleDateString("zh-CN")}
                    </span>
                    <svg
                      className={`w-4 h-4 transition-transform ${expandedUser === u.id ? "rotate-180" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {expandedUser === u.id && u.projects.length > 0 && (
                  <div className="border-t border-zinc-800 px-4 py-3 bg-zinc-950/50">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-zinc-600">
                          <th className="text-left py-1">Project</th>
                          <th className="text-right py-1">Papers</th>
                          <th className="text-right py-1">Searches</th>
                          <th className="text-right py-1">Chats</th>
                          <th className="text-right py-1">Ideas</th>
                          <th className="text-right py-1">Last Active</th>
                        </tr>
                      </thead>
                      <tbody>
                        {u.projects.map((p) => (
                          <tr key={p.id} className="text-zinc-400">
                            <td className="py-1.5">{p.name}</td>
                            <td className="text-right tabular-nums">{p.papers}</td>
                            <td className="text-right tabular-nums">{p.searches}</td>
                            <td className="text-right tabular-nums">{p.chats}</td>
                            <td className="text-right tabular-nums">{p.ideas}</td>
                            <td className="text-right text-zinc-600">
                              {new Date(p.updatedAt).toLocaleDateString("zh-CN")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────
export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "verify" }),
    })
      .then((r) => r.json())
      .then((data) => setAuthenticated(data.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  if (authenticated === null) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!authenticated) {
    return <LoginForm onLogin={() => setAuthenticated(true)} />;
  }

  return <Dashboard />;
}
