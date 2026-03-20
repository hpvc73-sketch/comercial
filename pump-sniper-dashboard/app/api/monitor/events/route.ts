import { getMonitorEngine } from "../../../../lib/monitorEngine";

export const dynamic = "force-dynamic";

export async function GET() {
  const engine = getMonitorEngine();
  const encoder = new TextEncoder();
  let keepAlive: NodeJS.Timeout | undefined;
  let listener: (() => void) | undefined;

  const cleanup = () => {
    if (keepAlive) clearInterval(keepAlive);
    keepAlive = undefined;
    if (listener) engine.off("update", listener);
    listener = undefined;
  };

  const stream = new ReadableStream({
    start(controller) {
      const sendState = () => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(engine.getState())}\n\n`));
        } catch {
          cleanup();
        }
      };

      sendState();
      listener = () => sendState();
      engine.on("update", listener);

      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`event: ping\ndata: ${Date.now()}\n\n`));
        } catch {
          cleanup();
        }
      }, 15000);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
