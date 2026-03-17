import { monitorEngine } from "../../../../lib/monitorEngine";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = () => {
        const payload = JSON.stringify(monitorEngine.getState());
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      };

      send();
      const listener = () => send();
      monitorEngine.on("update", listener);

      const keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(`event: ping\ndata: ${Date.now()}\n\n`));
      }, 15000);

      return () => {
        clearInterval(keepAlive);
        monitorEngine.off("update", listener);
      };
    },
    cancel() {
      // handled in start teardown
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
