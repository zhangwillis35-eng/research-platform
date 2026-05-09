/** Lightweight health check — returns 200 if Node.js event loop is responsive */
export async function GET() {
  return new Response("ok", { status: 200 });
}
