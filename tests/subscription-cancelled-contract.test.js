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

/** Esquema Avro del contrato de SubscriptionCancelled (EVT-011, REQ-101). */
const SCHEMA = 'sources/schemas/subscription_cancelled.avsc';

/** Fixture inválido: misma baja pero con subscription_status ACTIVE. */
const INVALID_FIXTURE = 'tests/fixtures/invalid/subscription_cancelled_active_status.json';

/**
 * Compila el .avsc con avsc. A propósito SIN try/catch: si el esquema es
 * inválido el test positivo debe petar en lugar de pasar en silencio.
 * `require()` de un .avsc NO funciona: hay que leerlo y parsearlo.
 */
function subscriptionCancelledType() {
  return avsc.Type.forSchema(readJson(SCHEMA));
}

/**
 * Valida un payload contra el tipo Avro recogiendo los campos que no validan.
 *
 * @param {object} payload payload de SubscriptionCancelled
 * @returns {{ valid: boolean, paths: string[] }} resultado y rutas en error
 */
function validateWithPaths(payload) {
  const type = subscriptionCancelledType();
  const paths = [];
  const valid = type.isValid(payload, {
    errorHook(errPath, value) {
      paths.push(`${errPath.join('.')}=${JSON.stringify(value)}`);
    },
  });
  return { valid, paths };
}

/**
 * Payload de ejemplo de una baja confirmada: IDÉNTICO al fixture inválido
 * salvo en subscription_status (CANCELLED aquí, ACTIVE en el fixture).
 */
const VALID_PAYLOAD = {
  event_id: '7f1c2a60-3b4d-4e2f-9a11-5c6d7e8f9a01',
  event_type: 'subscription.cancelled',
  timestamp: '2026-03-15T10:12:00.000Z',
  correlation_id: '2b9d4e71-6c5a-4f38-8d20-1e3f5a7b9c02',
  subscription_id: 'c3a81f52-9d47-4b6e-a1f0-8e2d4c6b0a03',
  user_id: '5d7e9b13-4a62-4c85-b0d9-7f1a3e5c2b04',
  subscription_status: 'CANCELLED',
  cancelled_at: '2026-03-15T10:12:00.000Z',
  cancellation_id: '9e0f1a24-8b73-4d56-9c2e-6a4b8d0f1e05',
  close_reason: 'USER_CANCELLED',
  billing_period_start: '2026-03-01',
};

test('POSITIVO: el payload de ejemplo de una baja confirmada, con cancelled_at informado, valida contra sources/schemas/subscription_cancelled.avsc', () => {
  const { valid, paths } = validateWithPaths(VALID_PAYLOAD);

  assert.equal(
    valid,
    true,
    `el payload de ejemplo de una baja confirmada DEBE validar contra ${SCHEMA}, campos que no validan: ${paths.join(' | ')}`,
  );

  // REQ-101 / AC-BAJ-02: el contrato tiene que transportar la fecha de baja,
  // no basta con que el payload valide estructuralmente.
  const type = subscriptionCancelledType();
  assert.ok(
    type.fields.some((f) => f.name === 'cancelled_at'),
    `${SCHEMA} debe declarar el campo cancelled_at (REQ-101 / AC-BAJ-02), tiene: ${type.fields.map((f) => f.name).join(', ')}`,
  );

  assert.equal(
    typeof VALID_PAYLOAD.cancelled_at,
    'string',
    'cancelled_at debe venir informado como string ISO-8601',
  );
  assert.ok(
    VALID_PAYLOAD.cancelled_at.length > 0,
    'cancelled_at no puede venir vacío: la baja confirmada siempre lleva fecha (REQ-101 / AC-BAJ-02)',
  );
  assert.match(
    VALID_PAYLOAD.cancelled_at,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/,
    `cancelled_at debe ir en ISO-8601 UTC con sufijo Z, recibido: ${VALID_PAYLOAD.cancelled_at}`,
  );
});

test('NEGATIVO: un payload con subscription_status distinto de CANCELLED DEBE ser rechazado por el contrato', () => {
  const doc = readJson(INVALID_FIXTURE);

  assert.notEqual(
    doc.subscription_status,
    'CANCELLED',
    `${INVALID_FIXTURE} debe llevar un subscription_status distinto de CANCELLED para que el negativo tenga sentido`,
  );

  const { valid, paths } = validateWithPaths(doc);

  assert.equal(
    valid,
    false,
    'el evento solo se emite ante una baja confirmada: un subscription_status distinto de CANCELLED NO puede validar contra el contrato',
  );

  assert.ok(
    paths.some((p) => p.includes('subscription_status')),
    `el contrato debe señalar subscription_status como el campo que no valida, campos en error: ${paths.join(' | ')}`,
  );
});

test('El payload de ejemplo que valida y el fixture rechazado solo difieren en subscription_status', () => {
  const doc = readJson(INVALID_FIXTURE);

  assert.deepEqual(
    Object.keys(doc).sort(),
    Object.keys(VALID_PAYLOAD).sort(),
    'el fixture inválido debe declarar exactamente los mismos campos que el payload válido',
  );

  const strip = (o) => {
    const copy = { ...o };
    delete copy.subscription_status;
    return copy;
  };

  // Si algo más difiriera, el negativo estaría probando otro fallo y no el
  // estado de la suscripción.
  assert.deepEqual(
    strip(doc),
    strip(VALID_PAYLOAD),
    'la ÚNICA diferencia entre el payload válido y el fixture rechazado debe ser subscription_status',
  );

  assert.notEqual(
    doc.subscription_status,
    VALID_PAYLOAD.subscription_status,
    'el fixture debe diferir del payload válido precisamente en subscription_status',
  );
});

/** Mapa pub/sub del canal de bajas (productor ARC-031 / consumidor ARC-033). */
const PUBSUB = 'sources/components/subscription_cancelled_pubsub.json';

/** Definición del evento EVT-011. */
const EVENT_DEF = 'sources/events/subscription_cancelled.json';

/** Canal único del evento SubscriptionCancelled. */
const CHANNEL = 'suscripciones.bajas.confirmada.v1';

/** Devuelve la entrada de `events` del pub/sub para una operación dada. */
function pubsubEntry(operation) {
  const doc = readJson(PUBSUB);
  assert.ok(
    Array.isArray(doc.events),
    `${PUBSUB} debe declarar un array events`,
  );
  return doc.events.find((e) => e.operation === operation);
}

test('El consumidor ARC-033 del canal de bajas declara close_reason = USER_CANCELLED (AC-BAJ-06, REQ-126)', () => {
  const sub = pubsubEntry('subscribe');

  assert.ok(
    sub,
    `${PUBSUB} debe declarar una entrada con operation=subscribe: sin consumidor, la baja no cierra el ciclo de impago (AC-BAJ-06)`,
  );

  assert.equal(
    sub.component,
    'ARC-033',
    'el consumidor del canal de bajas debe ser ARC-033 (Cobros y recobro), que es quien cierra el ciclo de impago (AC-BAJ-06)',
  );
  assert.equal(sub.event_code, 'EVT-011', 'el evento consumido debe ser EVT-011');
  assert.equal(
    sub.name,
    'SubscriptionCancelled',
    'el evento consumido debe ser SubscriptionCancelled',
  );
  assert.equal(
    sub.topic,
    CHANNEL,
    `el consumidor debe escuchar el canal ${CHANNEL}`,
  );

  // REQ-126: USER_CANCELLED es el motivo de cierre que impide abrir caso de
  // aviso; cualquier otro valor (p.ej. EXHAUSTED) sí lo abriría.
  assert.equal(
    sub.close_reason,
    'USER_CANCELLED',
    `el consumidor ARC-033 debe cerrar el ciclo de impago con close_reason=USER_CANCELLED (REQ-126: es el motivo que impide abrir caso de aviso), declarado: ${JSON.stringify(sub.close_reason)}`,
  );

  const eventDef = readJson(EVENT_DEF);
  assert.ok(
    Array.isArray(eventDef.consumers) && eventDef.consumers.includes('ARC-033'),
    `${EVENT_DEF} debe listar ARC-033 en consumers (AC-BAJ-06), tiene: ${JSON.stringify(eventDef.consumers)}`,
  );
});

test('El productor ARC-031 publica desde el outbox transaccional y un fallo de publicación NO revierte la baja (AC-BAJ-06)', () => {
  const pub = pubsubEntry('publish');

  assert.ok(pub, `${PUBSUB} debe declarar una entrada con operation=publish`);

  assert.equal(
    pub.component,
    'ARC-031',
    'el productor del evento de baja debe ser ARC-031 (MOD-002)',
  );
  assert.equal(
    pub.publish_after_commit,
    true,
    'el evento debe publicarse DESPUÉS del commit de la baja (publish_after_commit=true)',
  );

  assert.ok(pub.outbox, `${PUBSUB} debe declarar el bloque outbox del productor`);
  assert.equal(
    pub.outbox.table,
    'event_outbox',
    'la publicación debe salir del outbox transaccional event_outbox',
  );
  assert.equal(
    pub.outbox.retry_from_outbox,
    true,
    'si falla la publicación debe reintentarse desde event_outbox (AC-BAJ-06)',
  );
  // assert.equal estricto contra false: si la propiedad faltara (undefined)
  // el test DEBE ponerse rojo, no pasar por ser falsy.
  assert.equal(
    pub.outbox.rollback_on_publish_failure,
    false,
    `AC-BAJ-06: si falla la publicación la baja NO se revierte, luego rollback_on_publish_failure debe declararse explícitamente false, declarado: ${JSON.stringify(pub.outbox.rollback_on_publish_failure)}`,
  );

  const eventDef = readJson(EVENT_DEF);
  assert.equal(
    eventDef.producer,
    'ARC-031',
    `${EVENT_DEF} debe declarar producer=ARC-031`,
  );
  assert.equal(
    eventDef.publish_after_commit,
    true,
    `${EVENT_DEF} debe declarar publish_after_commit=true (publicación tras el commit de la baja)`,
  );
});

test('El canal del evento está declarado en asyncapi.yaml', () => {
  // asyncapi.yaml se lee como TEXTO a propósito: no hay parser YAML en
  // devDependencies y este test no debe añadir dependencias.
  const yaml = fs.readFileSync(path.join(ROOT, 'asyncapi.yaml'), 'utf8');

  assert.ok(
    yaml.includes(`${CHANNEL}:`),
    `asyncapi.yaml debe declarar el canal ${CHANNEL}`,
  );
  assert.ok(
    yaml.includes('SubscriptionCancelled'),
    'asyncapi.yaml debe declarar el mensaje SubscriptionCancelled en el canal de bajas',
  );

  const eventDef = readJson(EVENT_DEF);
  assert.equal(
    eventDef.topic,
    CHANNEL,
    `el topic de ${EVENT_DEF} debe ser el canal declarado en asyncapi.yaml`,
  );

  const pubsub = readJson(PUBSUB);
  assert.equal(
    pubsub.channel,
    CHANNEL,
    `el channel de ${PUBSUB} debe ser ${CHANNEL}: ningún canal huérfano`,
  );
  for (const entry of pubsub.events) {
    assert.equal(
      entry.topic,
      CHANNEL,
      `la entrada ${entry.operation} de ${PUBSUB} debe apuntar al canal ${CHANNEL}, apunta a: ${JSON.stringify(entry.topic)}`,
    );
  }
});
