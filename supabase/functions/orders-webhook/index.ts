import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_PAYLOAD_BYTES = 1_000_000;

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
};

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeEqual(received: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const receivedBytes = encoder.encode(received);
  const expectedBytes = encoder.encode(expected);

  if (receivedBytes.length !== expectedBytes.length) return false;

  let difference = 0;
  for (let index = 0; index < receivedBytes.length; index += 1) {
    difference |= receivedBytes[index] ^ expectedBytes[index];
  }

  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Método não permitido." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const webhookSecret = Deno.env.get("WEBHOOK_SECRET");

  if (!supabaseUrl || !serviceRoleKey || !webhookSecret) {
    console.error("Variáveis obrigatórias da função não foram configuradas.");
    return jsonResponse({ error: "Integração indisponível." }, 500);
  }

  const receivedSecret = request.headers.get("x-webhook-secret") ?? "";
  if (!safeEqual(receivedSecret, webhookSecret)) {
    return jsonResponse({ error: "Não autorizado." }, 401);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_PAYLOAD_BYTES) {
    return jsonResponse({ error: "Payload excede o limite de 1 MB." }, 413);
  }

  let payload: unknown;

  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_PAYLOAD_BYTES) {
      return jsonResponse({ error: "Payload excede o limite de 1 MB." }, 413);
    }
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "O corpo da requisição deve conter JSON válido." }, 400);
  }

  if (!isJsonObject(payload)) {
    return jsonResponse({ error: "O payload deve ser um objeto JSON." }, 422);
  }

  const requestId = request.headers.get("x-webhook-id")?.slice(0, 200) || crypto.randomUUID();
  const source = request.headers.get("x-webhook-source")?.slice(0, 100) || "external-platform";

  const queueMessage = {
    request_id: requestId,
    received_at: new Date().toISOString(),
    source,
    payload,
  };

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: messageId, error } = await supabase.rpc("enqueue_order_payload", {
    payload: queueMessage,
  });

  if (error) {
    console.error("Falha ao enfileirar webhook:", error.message);
    return jsonResponse({ error: "Não foi possível armazenar o payload." }, 500);
  }

  console.info(`Webhook ${requestId} armazenado na mensagem ${messageId}.`);

  return jsonResponse(
    {
      accepted: true,
      request_id: requestId,
      message_id: messageId,
    },
    202,
  );
});
