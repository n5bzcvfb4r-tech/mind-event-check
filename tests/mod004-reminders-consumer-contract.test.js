'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/** Lee y parsea un JSON del repo a partir de una ruta relativa a ROOT. */
function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
}

const COMPONENT = 'sources/components/mod004_reminders_consumer.json';
const EVENT = 'sources/events/invoice_unpaid.json';
const SCHEMA = 'sources/schemas/invoice_unpaid.avsc';

/**
 * Nombres de campo que constituyen un dato de pago. AC-EST-04 prohíbe que
 * InvoiceUnpaid (y por tanto el consumidor ARC-036) reciba cualquiera de ellos.
 */
const PAYMENT_DATA_FIELDS = [
  'payment_transaction_id',
  'payment_method',
  'payment_method_type',
  'payment_method_id',
  'last_four_digits',
  'card_last4',
  'card_token',
  'pan',
  'card_number',
  'cvv',
  'cvc',
  'token',
  'iban',
  'iban_last4',
  'bank_account_number',
  'gateway_name',
];

/**
 * Devuelve la suscripción a EVT-010 (InvoiceUnpaid) declarada por ARC-036.
 * Falla el test si el componente no la declara: sin ella no hay contrato de
 * consumo que verificar (AC-IMP-04).
 */
function unpaidSubscription() {
  const component = readJson(COMPONENT);
  const sub = (component.events || []).find((e) => e.event_code === 'EVT-010');
  assert.ok(
    sub,
    `${COMPONENT} debe declarar la suscripción al evento EVT-010 (InvoiceUnpaid) — AC-IMP-04`,
  );
  return sub;
}

/**
 * Offsets en días de los hitos de aviso (semilla de cat_payment_reminder_schedule).
 */
const SCHEDULE_OFFSET_DAYS = [3, 7, 14];

/** Versión de configuración que el simulador congela en cada caso abierto (T.5). */
const SIMULATED_CONFIG_VERSION = 1;

/**
 * Suma días a una fecha ISO `YYYY-MM-DD` y devuelve el resultado en el mismo formato.
 *
 * @param {string} isoDate fecha base en formato `YYYY-MM-DD`.
 * @param {number} days número de días a sumar.
 * @returns {string} fecha resultante en formato `YYYY-MM-DD`.
 */
function addDays(isoDate, days) {
  const base = new Date(`${isoDate}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/**
 * Construye un consumidor de InvoiceUnpaid en memoria GOBERNADO POR EL CONTRATO
 * declarado en `sources/components/mod004_reminders_consumer.json`.
 *
 * El simulador no hardcodea la semántica: deriva la clave de idempotencia de
 * `subscription.idempotency_key` y decide qué hacer en cada entrega leyendo
 * `subscription.on_first_delivery` y `subscription.on_duplicate`. Si alguien
 * cambia el contrato, el oráculo de AC-IMP-04 cambia de comportamiento y los
 * tests se ponen rojos en lugar de seguir verdes contra constantes propias.
 *
 * Modela la tabla `payment_reminder_cases` (T.5: case_id, invoice_id,
 * trigger_source, case_status, config_version) y sus hitos
 * `payment_reminder_steps` (offset_days, scheduled_for, step_status).
 *
 * @param {object} subscription suscripción EVT-010 declarada por ARC-036.
 * @returns {{deliver: (event: object) => {outcome: string, case: object},
 *            cases: () => object[],
 *            keyOf: (event: object) => string}} consumidor en memoria.
 */
function makeReminderConsumer(subscription) {
  /** @type {Map<string, object>} casos abiertos indexados por clave de idempotencia. */
  const casesByKey = new Map();
  let caseSeq = 0;

  /**
   * Deriva la clave de idempotencia del evento concatenando los valores de los
   * campos declarados en `subscription.idempotency_key`.
   *
   * @param {object} event evento invoice_unpaid recibido.
   * @returns {string} clave de idempotencia.
   */
  function keyOf(event) {
    const fields = subscription.idempotency_key;
    assert.ok(
      Array.isArray(fields) && fields.length > 0,
      'la suscripción EVT-010 debe declarar idempotency_key como lista no vacía — AC-IMP-04',
    );
    return fields.map((f) => String(event[f])).join('|');
  }

  /**
   * Planifica los hitos del caso a partir de la fecha de vencimiento del evento.
   *
   * @param {string} dueDate fecha de vencimiento `YYYY-MM-DD`.
   * @returns {{offset_days: number, scheduled_for: string, step_status: string}[]} hitos.
   */
  function planSteps(dueDate) {
    return SCHEDULE_OFFSET_DAYS.map((offset) => ({
      offset_days: offset,
      scheduled_for: addDays(dueDate, offset),
      step_status: 'SCHEDULED',
    }));
  }

  return {
    keyOf,
    cases: () => [...casesByKey.values()],

    /**
     * Entrega un evento invoice_unpaid al consumidor aplicando la semántica
     * declarada en el contrato.
     *
     * @param {object} event evento invoice_unpaid.
     * @returns {{outcome: string, case: object}} resultado de la entrega.
     */
    deliver(event) {
      const key = keyOf(event);
      const existing = casesByKey.get(key);

      if (!existing) {
        const action = subscription.on_first_delivery;
        if (action !== 'open_case') {
          throw new Error(
            `on_first_delivery declarado "${action}" no está soportado por el simulador: `
              + 'el contrato de ARC-036 cambió y AC-IMP-04 debe revisarse',
          );
        }
        caseSeq += 1;
        const newCase = {
          case_id: `case-${caseSeq}`,
          invoice_id: event.invoice_id,
          trigger_source: subscription.trigger_source,
          case_status: 'OPEN',
          config_version: SIMULATED_CONFIG_VERSION,
          steps: planSteps(event.due_date),
          annotations: [],
        };
        casesByKey.set(key, newCase);
        return { outcome: 'case_opened', case: newCase };
      }

      const action = subscription.on_duplicate;
      if (action !== 'annotate_only') {
        throw new Error(
          `on_duplicate declarado "${action}" no está soportado por el simulador: `
            + 'el contrato de ARC-036 cambió y AC-IMP-04 debe revisarse',
        );
      }
      existing.annotations.push({ event_id: event.event_id });
      return { outcome: 'annotated', case: existing };
    },
  };
}

/**
 * Evento invoice_unpaid de ejemplo con los campos declarados en
 * `sources/events/invoice_unpaid.json`.
 *
 * @param {object} [overrides] campos a sobrescribir (p. ej. event_id en una reentrega).
 * @returns {object} evento de prueba.
 */
function sampleInvoiceUnpaid(overrides = {}) {
  return {
    event_id: '6f1b0a4e-3c2d-4f58-9a71-2b8d5c0e7f11',
    event_type: 'invoice.unpaid',
    timestamp: '2026-03-11T02:15:00Z',
    correlation_id: 'd41f8a60-91c7-4a2e-8b33-0c5e9f27a104',
    invoice_id: 'a8c3e512-7d94-4f0b-bb26-15e7c9d38a42',
    invoice_number: 'GU-2026-000123',
    user_id: '2c7e4f91-55ab-4d10-9e83-6f0b1d4c8e57',
    amount_cents: 4500,
    due_date: '2026-03-10',
    modality_code: 'MENSUAL',
    ...overrides,
  };
}

test('ARC-036 se suscribe a InvoiceUnpaid con la semántica de apertura y anotación de AC-IMP-04', () => {
  const component = readJson(COMPONENT);
  const evt = readJson(EVENT);
  const sub = unpaidSubscription();

  assert.equal(
    component.component,
    'ARC-036',
    'el componente consumidor de avisos de impago (MOD-004) es ARC-036 — AC-IMP-04',
  );
  assert.equal(
    component.role,
    'consumer',
    'ARC-036 participa como consumer de InvoiceUnpaid, no como productor — AC-IMP-04',
  );

  assert.equal(
    component.channel,
    evt.topic,
    `ARC-036 debe consumir del mismo canal que declara ${EVENT} (${evt.topic}) — AC-IMP-04`,
  );
  assert.equal(
    sub.topic,
    evt.topic,
    `el topic de la suscripción EVT-010 debe coincidir con el declarado en ${EVENT} (${evt.topic}) — AC-IMP-04`,
  );

  assert.equal(
    sub.operation,
    'subscribe',
    'la operación de ARC-036 sobre EVT-010 es subscribe — AC-IMP-04',
  );

  assert.deepEqual(
    sub.idempotency_key,
    ['invoice_id'],
    'la entrega de InvoiceUnpaid a ARC-036 es idempotente por invoice_id — AC-IMP-04',
  );

  assert.equal(
    sub.trigger_source,
    'INVOICE_UNPAID',
    'el caso de aviso se abre con trigger_source INVOICE_UNPAID — AC-IMP-04',
  );

  assert.equal(
    sub.on_first_delivery,
    'open_case',
    'una primera entrega sobre una factura sin caso abre el caso de aviso — AC-IMP-04',
  );

  assert.equal(
    sub.on_duplicate,
    'annotate_only',
    'una entrega sobre una factura con caso OPEN solo se anota y NO replanifica los hitos — AC-IMP-04',
  );
});

test('ARC-036 declara que no recibe datos de pago y el esquema de InvoiceUnpaid no los tiene (AC-EST-04)', () => {
  const sub = unpaidSubscription();

  assert.equal(
    sub.receives_payment_data,
    false,
    'ARC-036 declara explícitamente que NO recibe datos de pago — AC-EST-04',
  );

  const schemaFields = readJson(SCHEMA).fields.map((f) => f.name);
  for (const name of schemaFields) {
    assert.ok(
      !PAYMENT_DATA_FIELDS.includes(name),
      `${SCHEMA} contiene el dato de pago prohibido "${name}": la declaración receives_payment_data=false de ARC-036 sería falsa — AC-EST-04`,
    );
  }

  const evt = readJson(EVENT);
  const declared = [...evt.payload.required_fields, ...(evt.payload.optional_fields || [])];
  for (const name of declared) {
    assert.ok(
      !PAYMENT_DATA_FIELDS.includes(name),
      `${EVENT} declara el dato de pago prohibido "${name}" en el payload: ARC-036 lo recibiría pese a declarar receives_payment_data=false — AC-EST-04`,
    );
  }
});

test('dos entregas del mismo invoice_unpaid abren UN solo caso y no replanifican hitos (AC-IMP-04)', () => {
  const sub = unpaidSubscription();
  const evt = readJson(EVENT);
  const event = sampleInvoiceUnpaid();

  // El evento de prueba debe cubrir exactamente los campos requeridos declarados,
  // para que el oráculo no se desincronice del contrato del evento.
  for (const field of evt.payload.required_fields) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(event, field),
      `el evento de prueba no trae el campo requerido "${field}" declarado en ${EVENT} — AC-IMP-04`,
    );
  }
  assert.deepEqual(
    Object.keys(event).sort(),
    [...evt.payload.required_fields].sort(),
    `el evento de prueba debe tener exactamente los campos declarados en ${EVENT} — AC-IMP-04`,
  );

  const consumer = makeReminderConsumer(sub);

  const first = consumer.deliver(event);
  assert.equal(
    first.outcome,
    'case_opened',
    'una factura sin caso abierto debe abrir caso al recibir InvoiceUnpaid — AC-IMP-04',
  );
  assert.equal(
    first.case.case_status,
    'OPEN',
    'el caso abierto por InvoiceUnpaid queda en estado OPEN — AC-IMP-04',
  );
  assert.equal(
    first.case.trigger_source,
    'INVOICE_UNPAID',
    'el caso se abre con trigger_source = INVOICE_UNPAID — AC-IMP-04',
  );
  assert.equal(
    first.case.invoice_id,
    event.invoice_id,
    'el caso abierto referencia la factura del evento — AC-IMP-04',
  );
  assert.equal(
    first.case.config_version,
    SIMULATED_CONFIG_VERSION,
    'el caso congela la config_version vigente en la apertura (T.5) — AC-IMP-04',
  );

  assert.deepEqual(
    first.case.steps,
    [
      { offset_days: 3, scheduled_for: '2026-03-13', step_status: 'SCHEDULED' },
      { offset_days: 7, scheduled_for: '2026-03-17', step_status: 'SCHEDULED' },
      { offset_days: 14, scheduled_for: '2026-03-24', step_status: 'SCHEDULED' },
    ],
    'la apertura planifica 3 hitos SCHEDULED a due_date +3/+7/+14 (2026-03-13, 2026-03-17, 2026-03-24) — AC-IMP-04',
  );

  const stepsAfterFirst = structuredClone(first.case.steps);

  // Reentrega real del bus: mismo invoice_id (la clave de idempotencia declarada),
  // distinto event_id.
  const redelivery = sampleInvoiceUnpaid({
    event_id: 'b2d9c7a1-40e6-4f33-8c15-7a9e31d6b084',
  });
  const second = consumer.deliver(redelivery);

  assert.equal(
    second.outcome,
    'annotated',
    `la segunda entrega sobre una factura con caso OPEN solo se anota (clave de idempotencia ${JSON.stringify(sub.idempotency_key)}) — AC-IMP-04`,
  );
  assert.equal(
    consumer.cases().length,
    1,
    `dos entregas del mismo invoice_unpaid deben producir UNA sola apertura de caso: la clave de idempotencia declarada ${JSON.stringify(sub.idempotency_key)} no está deduplicando — AC-IMP-04`,
  );
  assert.equal(
    second.case.case_id,
    first.case.case_id,
    'la reentrega se anota sobre el MISMO caso, no sobre uno nuevo — AC-IMP-04',
  );
  assert.deepEqual(
    second.case.steps,
    stepsAfterFirst,
    'los hitos NO se replanifican en una reentrega de InvoiceUnpaid sobre un caso OPEN — AC-IMP-04',
  );
  assert.equal(
    second.case.annotations.length,
    1,
    'la reentrega deja anotado el evento duplicado en el caso abierto — AC-IMP-04',
  );
  assert.equal(
    second.case.annotations[0].event_id,
    redelivery.event_id,
    'la anotación registra el event_id de la reentrega — AC-IMP-04',
  );
});

test('la unicidad del caso la da la clave de idempotencia declarada, no el simulador (AC-IMP-04)', () => {
  // Mordiente del oráculo: con una suscripción alterada SOLO EN MEMORIA cuya
  // idempotency_key es ["event_id"] en vez de ["invoice_id"], dos entregas de la
  // misma factura con distinto event_id dejan de deduplicarse y abren DOS casos.
  // Por eso idempotency_key = ["invoice_id"] en el fichero real es lo que
  // garantiza la apertura única: si alguien lo cambiara, el test anterior
  // (dos entregas -> un caso) se pondría rojo en vez de seguir verde.
  const alteredSub = { ...unpaidSubscription(), idempotency_key: ['event_id'] };
  const consumer = makeReminderConsumer(alteredSub);

  const first = consumer.deliver(sampleInvoiceUnpaid());
  const second = consumer.deliver(
    sampleInvoiceUnpaid({ event_id: 'b2d9c7a1-40e6-4f33-8c15-7a9e31d6b084' }),
  );

  assert.equal(first.outcome, 'case_opened', 'la primera entrega abre caso — AC-IMP-04');
  assert.equal(
    second.outcome,
    'case_opened',
    'con idempotency_key = ["event_id"] la reentrega NO se deduplica y abre un segundo caso: el simulador obedece al contrato declarado — AC-IMP-04',
  );
  assert.notEqual(
    second.case.case_id,
    first.case.case_id,
    'los dos casos abiertos son distintos — AC-IMP-04',
  );
  assert.equal(
    consumer.cases().length,
    2,
    'el simulador no impone unicidad por su cuenta: la deduplicación depende exclusivamente de idempotency_key declarada — AC-IMP-04',
  );
});
