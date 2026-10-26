'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const avsc = require('avsc');

const ROOT = path.resolve(__dirname, '..');

/** Lee y parsea un JSON del repo a partir de una ruta relativa a ROOT. */
function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
}

const COMPONENT = 'sources/components/mod002_refund_results_consumer.json';
const REFUND_COMPLETED_DEF = 'sources/events/refund_completed.json';
const REFUND_FAILED_DEF = 'sources/events/refund_failed.json';
const REFUND_COMPLETED_AVSC = 'sources/schemas/refund_completed.avsc';
const REFUND_FAILED_AVSC = 'sources/schemas/refund_failed.avsc';

/**
 * Devuelve la suscripción que ARC-031 declara para un código de evento.
 * Falla el test si no existe: sin ella no hay contrato de consumo que
 * verificar (AC-DEV-08).
 *
 * @param {string} eventCode código del evento (EVT-012 / EVT-013).
 * @returns {object} suscripción declarada en el componente.
 */
function subscriptionFor(eventCode) {
  const component = readJson(COMPONENT);
  const sub = (component.events || []).find((e) => e.event_code === eventCode);
  assert.ok(
    sub,
    `${COMPONENT} debe declarar la suscripción al evento ${eventCode} — AC-DEV-08`,
  );
  return sub;
}

/**
 * Payload RefundCompleted (EVT-012) válido contra el esquema Avro.
 * Devuelve un objeto NUEVO en cada llamada para que una entrega no mute la
 * siguiente.
 *
 * @param {object} [overrides] campos a sobrescribir (p. ej. refund_request_id distinto).
 * @returns {object} payload de prueba.
 */
function validRefundCompleted(overrides = {}) {
  return {
    event_id: '11111111-1111-4111-8111-111111111111',
    event_type: 'refund.completed',
    timestamp: '2026-10-26T10:35:00.000Z',
    correlation_id: '22222222-2222-4222-8222-222222222222',
    refund_request_id: '33333333-3333-4333-8333-333333333333',
    cancellation_id: '44444444-4444-4444-8444-444444444444',
    original_transaction_id: '55555555-5555-4555-8555-555555555555',
    user_id: '66666666-6666-4666-8666-666666666666',
    payment_method: 'BANK_TRANSFER',
    refund_amount_cents: 4500,
    currency: 'EUR',
    refund_ledger_id: '77777777-7777-4777-8777-777777777777',
    completed_at: '2026-10-26T10:34:59.000Z',
    ...overrides,
  };
}

test('AC-DEV-08: ARC-031 declara EVT-012 y EVT-013 con idempotencia por cancellation_id, match por refund_request_id y estado final inmutable', () => {
  const component = readJson(COMPONENT);

  assert.equal(
    component.component,
    'ARC-031',
    `${COMPONENT}: el consumidor de resultados de reembolso de MOD-002 es ARC-031 — AC-DEV-08`,
  );
  assert.equal(
    component.role,
    'consumer',
    `${COMPONENT}: ARC-031 participa como consumer de los resultados de reembolso — AC-DEV-08`,
  );

  const completedType = avsc.Type.forSchema(readJson(REFUND_COMPLETED_AVSC));
  assert.equal(
    completedType.isValid(validRefundCompleted()),
    true,
    `${REFUND_COMPLETED_AVSC}: el payload de control debe ser válido; si falla aquí, las entregas simuladas no probarían nada — AC-DEV-08`,
  );

  for (const eventCode of ['EVT-012', 'EVT-013']) {
    const sub = subscriptionFor(eventCode);

    assert.equal(
      sub.operation,
      'subscribe',
      `${COMPONENT}: la operación de ARC-031 sobre ${eventCode} es subscribe — AC-DEV-08`,
    );
    assert.deepEqual(
      sub.idempotency_key,
      ['cancellation_id'],
      `${COMPONENT}: la entrega de ${eventCode} a ARC-031 es idempotente por cancellation_id — AC-DEV-08`,
    );
    assert.equal(
      sub.match_field,
      'refund_request_id',
      `${COMPONENT}: ${eventCode} se casa con la orden registrada por refund_request_id — AC-DEV-08`,
    );
    assert.equal(
      sub.final_state_immutable,
      true,
      `${COMPONENT}: el estado final que fija ${eventCode} es inmutable — AC-DEV-08`,
    );
    assert.equal(
      sub.on_duplicate,
      'discard_and_record',
      `${COMPONENT}: un duplicado de ${eventCode} se descarta Y queda registrado — AC-DEV-08`,
    );
    assert.equal(
      sub.on_mismatch,
      'discard_and_record',
      `${COMPONENT}: un ${eventCode} con refund_request_id distinto se descarta Y queda registrado — AC-DEV-08`,
    );
  }

  assert.equal(
    subscriptionFor('EVT-012').final_state,
    'REEMBOLSADO',
    `${COMPONENT}: RefundCompleted cierra la baja en REEMBOLSADO — AC-DEV-08`,
  );
  assert.equal(
    subscriptionFor('EVT-013').final_state,
    'REEMBOLSO_FALLIDO',
    `${COMPONENT}: RefundFailed cierra la baja en REEMBOLSO_FALLIDO — AC-DEV-08`,
  );
  assert.equal(
    subscriptionFor('EVT-013').failure_code_field,
    'failure_code',
    `${COMPONENT}: RefundFailed guarda el código canónico del campo failure_code — AC-DEV-08`,
  );
});

/**
 * Payload RefundFailed (EVT-013) válido contra el esquema Avro. Devuelve un
 * objeto NUEVO en cada llamada.
 *
 * @param {object} [overrides] campos a sobrescribir.
 * @returns {object} payload de prueba.
 */
function validRefundFailed(overrides = {}) {
  return {
    event_id: '88888888-8888-4888-8888-888888888888',
    event_type: 'refund.failed',
    timestamp: '2026-10-26T10:40:00.000Z',
    correlation_id: '22222222-2222-4222-8222-222222222222',
    refund_request_id: '33333333-3333-4333-8333-333333333333',
    cancellation_id: '44444444-4444-4444-8444-444444444444',
    failure_code: 'refund_method_mismatch',
    failure_message: 'El método de reembolso no coincide con el del cobro original.',
    ...overrides,
  };
}

/**
 * Construye un consumidor de resultados de reembolso EN MEMORIA gobernado por
 * el contrato declarado en `sources/components/mod002_refund_results_consumer.json`.
 *
 * No hardcodea la semántica: deriva la clave de idempotencia de
 * `idempotency_key`, casa el evento con la orden por `match_field`, fija el
 * `final_state` declarado y, cuando el estado ya es final y
 * `final_state_immutable` es true, aplica la acción declarada en `on_duplicate`
 * / `on_mismatch`. Si alguien cambia el contrato, el oráculo de AC-DEV-08
 * cambia de comportamiento en vez de seguir verde contra constantes propias.
 *
 * Modela la fila de `subscription_cancellations` (cancellation_id,
 * refund_request_id, refund_status, refund_failure_code) partiendo de
 * REEMBOLSO_SOLICITADO.
 *
 * @param {{cancellation_id: string, refund_request_id: string}} order orden inicial.
 * @returns {{deliver: (event: object, subscription: object) => {outcome: string, order: object},
 *            order: () => object,
 *            records: () => object[]}} consumidor en memoria.
 */
function makeRefundResultsConsumer(order) {
  /** Estado de partida de la baja: la orden de reembolso está solicitada. */
  const INITIAL_STATUS = 'REEMBOLSO_SOLICITADO';

  /** @type {Map<string, object>} órdenes indexadas por clave de idempotencia. */
  const ordersByKey = new Map();
  /** @type {object[]} registro de entregas descartadas (AC-DEV-08). */
  const records = [];

  const row = {
    cancellation_id: order.cancellation_id,
    refund_request_id: order.refund_request_id,
    refund_status: INITIAL_STATUS,
    refund_failure_code: null,
  };
  ordersByKey.set(String(row.cancellation_id), row);

  /**
   * Deriva la clave de idempotencia del evento según la suscripción declarada.
   *
   * @param {object} subscription suscripción declarada por ARC-031.
   * @param {object} event evento recibido.
   * @returns {string} clave de idempotencia.
   */
  function keyOf(subscription, event) {
    const fields = subscription.idempotency_key;
    assert.ok(
      Array.isArray(fields) && fields.length > 0,
      `${COMPONENT}: la suscripción debe declarar idempotency_key como lista no vacía — AC-DEV-08`,
    );
    return fields.map((f) => String(event[f])).join('|');
  }

  /**
   * Aplica la acción declarada para una entrega que no puede tocar el estado
   * final: la descarta SIN cambiar el estado y la anexa al registro.
   *
   * @param {string} action valor declarado en on_duplicate / on_mismatch.
   * @param {string} reason motivo del descarte (`duplicate` / `mismatch`).
   * @param {object} event evento descartado.
   * @param {object} current fila de subscription_cancellations afectada.
   * @returns {{outcome: string, order: object}} resultado de la entrega.
   */
  function discard(action, reason, event, current) {
    if (action !== 'discard_and_record') {
      throw new Error(
        `acción declarada "${action}" no soportada por el simulador: el contrato de `
          + 'ARC-031 cambió y AC-DEV-08 debe revisarse',
      );
    }
    records.push({
      reason,
      event_id: event.event_id,
      event_type: event.event_type,
      cancellation_id: event.cancellation_id,
      refund_request_id: event.refund_request_id,
      kept_status: current.refund_status,
    });
    return { outcome: `discarded_${reason}`, order: current };
  }

  return {
    order: () => ordersByKey.get(String(row.cancellation_id)),
    records: () => [...records],

    /**
     * Entrega un resultado de reembolso aplicando la semántica declarada.
     *
     * @param {object} event payload refund_completed o refund_failed.
     * @param {object} subscription suscripción declarada para ese evento.
     * @returns {{outcome: string, order: object}} resultado de la entrega.
     */
    deliver(event, subscription) {
      const current = ordersByKey.get(keyOf(subscription, event));
      assert.ok(
        current,
        `la entrega debe casar con una orden existente por ${JSON.stringify(subscription.idempotency_key)} — AC-DEV-08`,
      );

      const matches = event[subscription.match_field] === current[subscription.match_field];
      const isFinal = current.refund_status !== INITIAL_STATUS;

      if (isFinal && subscription.final_state_immutable === true) {
        const reason = matches ? 'duplicate' : 'mismatch';
        const action = matches ? subscription.on_duplicate : subscription.on_mismatch;
        return discard(action, reason, event, current);
      }

      if (!matches) {
        return discard(subscription.on_mismatch, 'mismatch', event, current);
      }

      current.refund_status = subscription.final_state;
      if (subscription.failure_code_field) {
        current.refund_failure_code = event[subscription.failure_code_field];
      }
      return { outcome: 'applied', order: current };
    },
  };
}

test('AC-DEV-08: dos entregas del MISMO refund_completed y una con refund_request_id distinto no reabren REEMBOLSADO y quedan registradas', () => {
  const sub = subscriptionFor('EVT-012');
  const type = avsc.Type.forSchema(readJson(REFUND_COMPLETED_AVSC));
  const event = validRefundCompleted();

  const consumer = makeRefundResultsConsumer({
    cancellation_id: event.cancellation_id,
    refund_request_id: event.refund_request_id,
  });
  assert.equal(
    consumer.order().refund_status,
    'REEMBOLSO_SOLICITADO',
    'la baja parte de REEMBOLSO_SOLICITADO antes de recibir el resultado — AC-DEV-08',
  );

  // 1.ª entrega: cierra la baja en el estado final declarado.
  assert.equal(type.isValid(event), true, `${REFUND_COMPLETED_AVSC}: la 1.ª entrega debe ser un payload válido — AC-DEV-08`);
  const first = consumer.deliver(event, sub);
  assert.equal(first.outcome, 'applied', 'la primera entrega de RefundCompleted se aplica — AC-DEV-08');
  assert.equal(
    consumer.order().refund_status,
    'REEMBOLSADO',
    `la primera entrega de RefundCompleted lleva la baja a ${sub.final_state} — AC-DEV-08`,
  );

  // 2.ª entrega: MISMO evento duplicado por el bus (misma clave, mismo match_field).
  const duplicate = validRefundCompleted();
  assert.equal(type.isValid(duplicate), true, `${REFUND_COMPLETED_AVSC}: el duplicado debe ser un payload válido — AC-DEV-08`);
  const second = consumer.deliver(duplicate, sub);
  assert.equal(
    second.outcome,
    'discarded_duplicate',
    `un RefundCompleted duplicado debe descartarse (on_duplicate=${sub.on_duplicate}) — AC-DEV-08`,
  );
  assert.equal(
    consumer.order().refund_status,
    'REEMBOLSADO',
    'el duplicado NO reabre ni modifica el estado final REEMBOLSADO — AC-DEV-08',
  );

  // 3.ª entrega: refund_request_id distinto al registrado, resto idéntico.
  const mismatched = validRefundCompleted({
    refund_request_id: '99999999-9999-4999-8999-999999999999',
  });
  assert.equal(type.isValid(mismatched), true, `${REFUND_COMPLETED_AVSC}: la entrega con otro refund_request_id debe ser un payload válido — AC-DEV-08`);
  const third = consumer.deliver(mismatched, sub);
  assert.equal(
    third.outcome,
    'discarded_mismatch',
    `un RefundCompleted con ${sub.match_field} distinto al registrado debe descartarse (on_mismatch=${sub.on_mismatch}) — AC-DEV-08`,
  );
  assert.equal(
    consumer.order().refund_status,
    'REEMBOLSADO',
    'el mensaje con refund_request_id distinto NO reabre el estado final REEMBOLSADO — AC-DEV-08',
  );
  assert.equal(
    consumer.order().refund_request_id,
    event.refund_request_id,
    'la orden conserva el refund_request_id originalmente registrado — AC-DEV-08',
  );

  // El descarte no basta: AC-DEV-08 exige que AMBAS entregas queden registradas.
  const records = consumer.records();
  assert.equal(
    records.length,
    2,
    `las dos entregas descartadas (duplicada y con ${sub.match_field} distinto) deben quedar registradas, no solo ignoradas — AC-DEV-08`,
  );
  assert.deepEqual(
    records.map((r) => r.reason),
    ['duplicate', 'mismatch'],
    'el registro guarda el motivo de cada descarte: primero el duplicado, luego el mismatch — AC-DEV-08',
  );
  assert.equal(
    records[0].event_id,
    duplicate.event_id,
    'el registro del descarte identifica el evento duplicado — AC-DEV-08',
  );
  assert.equal(
    records[1].refund_request_id,
    mismatched.refund_request_id,
    'el registro del descarte guarda el refund_request_id que no casaba — AC-DEV-08',
  );
  for (const record of records) {
    assert.equal(
      record.kept_status,
      'REEMBOLSADO',
      'cada entrada del registro deja constancia de que el estado final se mantuvo — AC-DEV-08',
    );
  }
});

test('AC-DEV-08: RefundFailed cierra la baja en REEMBOLSO_FALLIDO con su failure_code y un refund_completed tardío no reabre ese estado final', () => {
  const failedSub = subscriptionFor('EVT-013');
  const completedSub = subscriptionFor('EVT-012');
  const failedType = avsc.Type.forSchema(readJson(REFUND_FAILED_AVSC));
  const failedEvent = validRefundFailed();

  assert.equal(
    failedType.isValid(failedEvent),
    true,
    `${REFUND_FAILED_AVSC}: el payload RefundFailed de control debe ser válido — AC-DEV-08`,
  );

  const consumer = makeRefundResultsConsumer({
    cancellation_id: failedEvent.cancellation_id,
    refund_request_id: failedEvent.refund_request_id,
  });

  const first = consumer.deliver(failedEvent, failedSub);
  assert.equal(first.outcome, 'applied', 'la primera entrega de RefundFailed se aplica — AC-DEV-08');
  assert.equal(
    consumer.order().refund_status,
    'REEMBOLSO_FALLIDO',
    `RefundFailed lleva la baja a ${failedSub.final_state} — AC-DEV-08`,
  );
  assert.equal(
    consumer.order().refund_failure_code,
    failedEvent[failedSub.failure_code_field],
    `la baja guarda el código canónico del campo declarado en failure_code_field (${failedSub.failure_code_field}) — AC-DEV-08`,
  );

  // Mensaje TARDÍO: el RefundCompleted de la misma baja llega después del fallo.
  const lateCompleted = validRefundCompleted({
    cancellation_id: failedEvent.cancellation_id,
    refund_request_id: failedEvent.refund_request_id,
  });
  const late = consumer.deliver(lateCompleted, completedSub);

  assert.equal(
    late.outcome,
    'discarded_duplicate',
    `un RefundCompleted tardío sobre una baja ya en estado final se descarta (on_duplicate=${completedSub.on_duplicate}) — AC-DEV-08`,
  );
  assert.equal(
    consumer.order().refund_status,
    'REEMBOLSO_FALLIDO',
    'el mensaje tardío NO reabre el estado final REEMBOLSO_FALLIDO ni lo cambia a REEMBOLSADO — AC-DEV-08',
  );
  assert.equal(
    consumer.order().refund_failure_code,
    failedEvent.failure_code,
    'el mensaje tardío no borra el failure_code registrado — AC-DEV-08',
  );

  const records = consumer.records();
  assert.equal(
    records.length,
    1,
    'el mensaje tardío descartado queda registrado, no simplemente ignorado — AC-DEV-08',
  );
  assert.equal(
    records[0].event_id,
    lateCompleted.event_id,
    'el registro identifica el evento tardío descartado — AC-DEV-08',
  );
  assert.equal(
    records[0].kept_status,
    'REEMBOLSO_FALLIDO',
    'el registro deja constancia del estado final que se mantuvo — AC-DEV-08',
  );
});

test('AC-DEV-09: ARC-031 declara la política de reintentos 1/5/15/60 minutos y escalado a ADMIN', () => {
  const delivery = readJson(COMPONENT).delivery;

  assert.ok(delivery, `${COMPONENT}: ARC-031 debe declarar su política de entrega — AC-DEV-09`);
  assert.deepEqual(
    delivery.backoff.intervals_seconds,
    [60, 300, 900, 3600],
    `${COMPONENT}: los reintentos se espacian 1, 5, 15 y 60 minutos — AC-DEV-09`,
  );
  assert.equal(
    delivery.retries,
    delivery.backoff.intervals_seconds.length,
    `${COMPONENT}: retries (${delivery.retries}) debe coincidir con el número de intervalos declarados (${delivery.backoff.intervals_seconds.length}) — AC-DEV-09`,
  );
  assert.equal(
    delivery.escalation_target,
    'ADMIN',
    `${COMPONENT}: agotados los reintentos, la incidencia escala a ADMIN — AC-DEV-09`,
  );
});

test('AC-DEV-08: ARC-031 está cableado como consumidor de RefundCompleted y RefundFailed', () => {
  const component = readJson(COMPONENT);

  for (const [defPath, eventCode] of [
    [REFUND_COMPLETED_DEF, 'EVT-012'],
    [REFUND_FAILED_DEF, 'EVT-013'],
  ]) {
    const def = readJson(defPath);
    assert.ok(
      (def.consumers || []).includes('ARC-031'),
      `${defPath}: ARC-031 debe figurar en consumers; sin el cableado, MOD-002 no recibiría el resultado del reembolso — AC-DEV-08`,
    );
    assert.equal(
      subscriptionFor(eventCode).topic,
      def.topic,
      `${COMPONENT}: el topic de la suscripción ${eventCode} debe ser el declarado en ${defPath} (${def.topic}) — AC-DEV-08`,
    );
    assert.equal(
      subscriptionFor(eventCode).name,
      def.name,
      `${COMPONENT}: la suscripción ${eventCode} debe nombrar el evento declarado en ${defPath} (${def.name}) — AC-DEV-08`,
    );
  }

  assert.equal(
    component.channel,
    readJson(REFUND_COMPLETED_DEF).topic,
    `${COMPONENT}: el canal principal de ARC-031 es el de RefundCompleted — AC-DEV-08`,
  );
});
