import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type JsonObject = Record<string, unknown>;

interface QueueMessage {
  msg_id: number;
  read_ct: number;
  enqueued_at: string;
  vt: string;
  message: JsonObject;
}

interface OrderRecord {
  id: string;
  atendente: string | null;
  data: string | null;
  nome_cliente: string | null;
  contato_cliente: string | null;
  valor: number | null;
  observacao: string | null;
  tratamento: string | null;
  documento: string | null;
  plataforma: string | null;
  data_pagamento: string | null;
  codigo_rastreio: string | null;
  status_rastreio: string | null;
}

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
};

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
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

function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function getPath(source: JsonObject, path: string[]): unknown {
  let current: unknown = source;

  for (const segment of path) {
    const currentObject = asObject(current);
    if (!currentObject) return undefined;
    current = currentObject[segment];
  }

  return current;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized && normalized !== "-" ? normalized : null;
}

function dateOnly(value: unknown): string | null {
  const normalized = cleanString(value);
  if (!normalized) return null;

  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

function centsToMoney(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const cents = Number(value);
  return Number.isFinite(cents) ? cents / 100 : null;
}

function mapOrder(payload: JsonObject): { event: string | null; order: OrderRecord | null } {
  const id = cleanString(getPath(payload, ["skaletracking", "id_venda"]));
  if (!id) return { event: null, order: null };

  const event = cleanString(payload.status) || cleanString(getPath(payload, ["skaletracking", "event"]));
  const phone = cleanString(getPath(payload, ["customer", "phone"]));
  const email = cleanString(getPath(payload, ["customer", "email"]));

  return {
    event,
    order: {
      id,
      atendente: cleanString(getPath(payload, ["skaletracking", "usuario_responsavel"])),
      data: dateOnly(payload.started_at_data) || dateOnly(payload.started_at),
      nome_cliente: cleanString(getPath(payload, ["customer", "name"])),
      contato_cliente: phone || email,
      valor: centsToMoney(getPath(payload, ["product", "price"])),
      observacao: cleanString(getPath(payload, ["skaletracking", "observacao"])),
      tratamento: cleanString(getPath(payload, ["product", "name"])),
      documento: cleanString(getPath(payload, ["customer", "doc"])),
      plataforma: cleanString(getPath(payload, ["skaletracking", "plataforma"])),
      data_pagamento:
        dateOnly(getPath(payload, ["transaction", "paid_at_data"])) ||
        dateOnly(getPath(payload, ["transaction", "paid_at"])),
      codigo_rastreio: cleanString(getPath(payload, ["shipping", "tracking_code"])),
      status_rastreio: cleanString(getPath(payload, ["skaletracking", "status_entrega"])),
    },
  };
}

function compactUpdate(order: OrderRecord): Partial<OrderRecord> {
  return Object.fromEntries(
    Object.entries(order).filter(([key, value]) => key !== "id" && value !== null),
  ) as Partial<OrderRecord>;
}

async function archiveMessage(supabase: SupabaseClient, messageId: number): Promise<void> {
  const { data, error } = await supabase.rpc("archive_orders_ingest_payload", {
    message_id: messageId,
  });

  if (error || data !== true) {
    throw new Error(error?.message || `Não foi possível arquivar a mensagem ${messageId}.`);
  }
}

async function moveToDeadLetter(
  supabase: SupabaseClient,
  queueMessage: QueueMessage,
  reason: string,
): Promise<void> {
  const deadLetterPayload = {
    failed_at: new Date().toISOString(),
    source_queue: "orders_ingest",
    source_message_id: queueMessage.msg_id,
    read_count: queueMessage.read_ct,
    reason,
    original_message: queueMessage.message,
  };

  const { error } = await supabase.rpc("enqueue_orders_ingest_dead_letter", {
    payload: deadLetterPayload,
  });

  if (error) throw new Error(`Falha ao enviar para DLQ: ${error.message}`);
  await archiveMessage(supabase, queueMessage.msg_id);
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Método não permitido." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const workerSecret = Deno.env.get("ORDERS_WORKER_SECRET");

  if (!supabaseUrl || !serviceRoleKey || !workerSecret) {
    console.error("Variáveis obrigatórias do worker não foram configuradas.");
    return jsonResponse({ error: "Worker indisponível." }, 500);
  }

  const receivedSecret = request.headers.get("x-worker-secret") ?? "";
  if (!safeEqual(receivedSecret, workerSecret)) {
    return jsonResponse({ error: "Não autorizado." }, 401);
  }

  let batchSize = 100;
  let configureSchedule = false;
  try {
    const body = await request.json();
    if (typeof body?.batch_size === "number") batchSize = body.batch_size;
    configureSchedule = body?.configure_schedule === true;
  } catch {
    // O corpo é opcional; o lote padrão processa até 100 mensagens.
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (configureSchedule) {
    const { data: configured, error: configurationError } = await supabase.rpc(
      "configure_orders_worker_schedule",
      { secret_value: workerSecret },
    );

    if (configurationError || configured !== true) {
      console.error("Falha ao configurar agendamento:", configurationError?.message);
      return jsonResponse({ error: "Não foi possível configurar o agendamento." }, 500);
    }

    return jsonResponse({ configured: true, schedule: "* * * * *" }, 200);
  }

  const runId = crypto.randomUUID();
  const { data: claimed, error: claimError } = await supabase.rpc("claim_orders_worker", {
    requested_owner: runId,
    lease_seconds: 300,
  });

  if (claimError) {
    console.error("Falha ao adquirir o lock do worker:", claimError.message);
    return jsonResponse({ error: "Não foi possível iniciar o worker." }, 500);
  }

  if (claimed !== true) {
    return jsonResponse({ skipped: true, reason: "worker_already_running" }, 200);
  }

  const { data, error } = await supabase.rpc("read_orders_ingest_payloads", {
    batch_size: Math.min(Math.max(Math.trunc(batchSize), 1), 100),
    visibility_timeout_seconds: 120,
  });

  if (error) {
    console.error("Falha ao ler a fila:", error.message);
    await supabase.rpc("release_orders_worker", { requested_owner: runId });
    return jsonResponse({ error: "Não foi possível ler a fila." }, 500);
  }

  const messages = (data ?? []) as QueueMessage[];
  const result = {
    read: messages.length,
    created: 0,
    updated: 0,
    duplicates: 0,
    archived_tests: 0,
    dead_lettered: 0,
    failed: 0,
  };
  const failures: Array<{ message_id: number; reason: string }> = [];

  for (const queueMessage of messages) {
    try {
      const envelope = asObject(queueMessage.message);
      const payload = asObject(envelope?.payload);

      if (!payload) {
        await moveToDeadLetter(supabase, queueMessage, "Payload ausente ou inválido.");
        result.dead_lettered += 1;
        continue;
      }

      if (payload._test === true) {
        await archiveMessage(supabase, queueMessage.msg_id);
        result.archived_tests += 1;
        continue;
      }

      if (cleanString(payload.type) !== "order") {
        await moveToDeadLetter(supabase, queueMessage, "Tipo de payload não suportado.");
        result.dead_lettered += 1;
        continue;
      }

      const { event, order } = mapOrder(payload);
      if (!order) {
        await moveToDeadLetter(supabase, queueMessage, "skaletracking.id_venda ausente.");
        result.dead_lettered += 1;
        continue;
      }

      if (event === "order_created") {
        const { error: insertError } = await supabase.from("orders").insert(order);

        if (insertError?.code === "23505") {
          result.duplicates += 1;
        } else if (insertError) {
          throw new Error(`Falha ao criar pedido: ${insertError.message}`);
        } else {
          result.created += 1;
        }
      } else {
        const updates = compactUpdate(order);
        const { data: updatedRows, error: updateError } = await supabase
          .from("orders")
          .update(updates)
          .eq("id", order.id)
          .select("id");

        if (updateError) throw new Error(`Falha ao atualizar pedido: ${updateError.message}`);

        if (!updatedRows || updatedRows.length === 0) {
          await moveToDeadLetter(
            supabase,
            queueMessage,
            `Evento ${event || "desconhecido"} recebido antes de order_created.`,
          );
          result.dead_lettered += 1;
          continue;
        }

        result.updated += 1;
      }

      await archiveMessage(supabase, queueMessage.msg_id);
    } catch (processingError) {
      const reason = processingError instanceof Error
        ? processingError.message
        : "Erro desconhecido no processamento.";

      console.error(`Falha na mensagem ${queueMessage.msg_id}:`, reason);
      failures.push({ message_id: queueMessage.msg_id, reason });
      result.failed += 1;
    }
  }

  const { error: releaseError } = await supabase.rpc("release_orders_worker", {
    requested_owner: runId,
  });

  if (releaseError) {
    console.error("Falha ao liberar o lock do worker:", releaseError.message);
  }

  return jsonResponse(
    {
      processed_at: new Date().toISOString(),
      run_id: runId,
      result,
      failures,
    },
    result.failed > 0 ? 207 : 200,
  );
});
