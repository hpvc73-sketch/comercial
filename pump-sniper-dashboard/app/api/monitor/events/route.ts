import { getMonitorEngine } from "../../../../lib/monitorEngine";

export const dynamic = "force-dynamic";

export async function GET() {
  const engine = getMonitorEngine();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const sendState = () => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(engine.getState())}\n\n`));
      };

      sendState();
      const listener = () => sendState();
      engine.on("update", listener);

      const keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(`event: ping\ndata: ${Date.now()}\n\n`));
      }, 15000);

      return () => {
        clearInterval(keepAlive);
        engine.off("update", listener);
      };
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
