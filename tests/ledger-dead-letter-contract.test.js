'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const avsc = require('avsc');

const ROOT = path.resolve(__dirname, '..');

/** Lee un fichero de texto del repo a partir de una ruta relativa a ROOT. */
function readText(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

/** Lee y parsea un fichero JSON (o .avsc) del repo a partir de una ruta relativa a ROOT. */
function readJson(relPath) {
  return JSON.parse(readText(relPath));
}

/** Definición funcional del evento LedgerDeadLetter (EVT-014). */
const DEAD_LETTER_EVENT = 'sources/events/ledger_dead_letter.json';

/** Esquema Avro del payload de LedgerDeadLetter (EVT-014). */
const DEAD_LETTER_SCHEMA = 'sources/schemas/ledger_dead_letter.avsc';

/** Componente del consumidor del ledger MOD-005 (ARC-035), productor del canal de cuarentena. */
const LEDGER_COMPONENT = 'sources/components/mod005_ledger_consumer.json';

/** Canal de cuarentena del ledger (REQ-069, AC-TRX-03). */
const DEAD_LETTER_TOPIC = 'gymusers.ledger.dead-letter.v1';

test('REQ-069 / AC-TRX-03: el canal de cuarentena publica un asiento válido contra su .avsc', () => {
  const def = readJson(DEAD_LETTER_EVENT);

  assert.equal(
    def.topic,
    DEAD_LETTER_TOPIC,
    `${DEAD_LETTER_EVENT}: el evento de cuarentena debe publicarse en ${DEAD_LETTER_TOPIC}`,
  );
  assert.equal(
    def.producer,
    'ARC-035',
    `${DEAD_LETTER_EVENT}: el productor del canal de cuarentena es el consumidor del ledger MOD-005 (ARC-035)`,
  );
  assert.equal(
    def.payload_schema,
    DEAD_LETTER_SCHEMA,
    `${DEAD_LETTER_EVENT}: payload_schema debe apuntar a ${DEAD_LETTER_SCHEMA}`,
  );

  assert.ok(
    def.payload && def.payload.example,
    `${DEAD_LETTER_EVENT}: payload.example es obligatorio; sin asiento de ejemplo el contrato no es verificable`,
  );

  const type = avsc.Type.forSchema(readJson(def.payload_schema));

  assert.equal(
    type.isValid(def.payload.example),
    true,
    `${def.payload_schema}: el asiento de cuarentena de ejemplo declarado en ${DEAD_LETTER_EVENT} debe ser válido contra el esquema Avro`,
  );

  const decoded = type.fromBuffer(type.toBuffer(def.payload.example));

  for (const field of def.payload.required_fields) {
    assert.deepEqual(
      decoded[field],
      def.payload.example[field],
      `${def.payload_schema}: el campo obligatorio ${field} no sobrevive al round-trip Avro (toBuffer/fromBuffer); un asiento de cuarentena que pierde datos al serializar equivale a perder el evento rechazado (REQ-069)`,
    );
  }

  const component = readJson(LEDGER_COMPONENT);
  const published = (component.events || []).find(
    (e) => e.topic === DEAD_LETTER_TOPIC && e.operation === 'publish',
  );

  assert.ok(
    published,
    `${LEDGER_COMPONENT}: ARC-035 debe declarar ${DEAD_LETTER_TOPIC} con operation "publish"; sin productor montado el canal de cuarentena sería huérfano y los eventos rechazados se perderían (AC-TRX-03)`,
  );
});

/** Instante fijo de puesta en cuarentena: hace el asiento determinista y comparable en los asserts. */
const QUARANTINE_INSTANT = new Date('2026-10-26T10:35:30.000Z').toISOString();

/** Nombres de campo de importe admitidos por los canales económicos que consume ARC-035. */
const AMOUNT_FIELD_NAMES = ['amount_cents', 'amount'];

/** Un campo se considera ausente del evento crudo si no está o viene a null. */
function isMissing(rawEvent, field) {
  return !Object.prototype.hasOwnProperty.call(rawEvent, field) || rawEvent[field] === null;
}

/** Devuelve el nombre del campo de importe que declara un .avsc de canal principal, o null si no declara ninguno. */
function amountFieldOf(mainSchemaPath) {
  const fields = (readJson(mainSchemaPath).fields || []).map((f) => f.name);
  return AMOUNT_FIELD_NAMES.find((name) => fields.includes(name)) || null;
}

/**
 * Enrutado declarado por el contrato de cuarentena (REQ-069, AC-TRX-03): un evento que no valida
 * contra el esquema de su canal principal no llega al ledger, se desvía al canal de cuarentena.
 * Devuelve { topic, quarantined } y, cuando hay cuarentena, el asiento `record` de EVT-014.
 */
function routeToQuarantine(mainSchemaPath, rawEvent, originalTopic) {
  const type = avsc.Type.forSchema(readJson(mainSchemaPath));

  if (type.isValid(rawEvent) === true) {
    return { topic: originalTopic, quarantined: false };
  }

  const amountField = amountFieldOf(mainSchemaPath);

  let rejectReason = 'INVALID_STATE_TRANSITION';
  if (isMissing(rawEvent, 'user_id')) {
    rejectReason = 'MISSING_USER_ID';
  } else if (amountField !== null && isMissing(rawEvent, amountField)) {
    rejectReason = 'MISSING_AMOUNT';
  }

  return {
    topic: DEAD_LETTER_TOPIC,
    quarantined: true,
    record: {
      event_id: rawEvent.event_id,
      event_type: 'ledger.deadletter',
      timestamp: QUARANTINE_INSTANT,
      correlation_id: rawEvent.correlation_id,
      original_topic: originalTopic,
      raw_payload: JSON.stringify(rawEvent),
      reject_reason: rejectReason,
      quarantined_at: QUARANTINE_INSTANT,
      alert_target: 'ADMIN',
    },
  };
}

/**
 * Descubre los canales principales que consume ARC-035 leyendo sus events[] con operation "subscribe"
 * y resolviendo cada payload_schema por topic contra sources/events/*.json. Así el test sigue al
 * contrato en vez de a una lista escrita a mano.
 */
function discoverMainChannels() {
  const component = readJson(LEDGER_COMPONENT);
  const definitions = fs
    .readdirSync(path.join(ROOT, 'sources/events'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({ relPath: `sources/events/${name}`, def: readJson(`sources/events/${name}`) }));

  return (component.events || [])
    .filter((e) => e.operation === 'subscribe')
    .map((e) => {
      const found = definitions.find((d) => d.def.topic === e.topic);
      assert.ok(
        found,
        `${LEDGER_COMPONENT}: ARC-035 se suscribe a ${e.topic} pero ningún fichero de sources/events/ declara ese topic; sin definición no hay esquema contra el que validar el evento entrante (REQ-069)`,
      );
      assert.ok(
        found.def.payload_schema,
        `${found.relPath}: el canal ${e.topic} debe declarar payload_schema; sin él no se puede comprobar qué eventos NO validan contra el canal principal (AC-TRX-03)`,
      );
      assert.ok(
        found.def.payload && found.def.payload.example,
        `${found.relPath}: el canal ${e.topic} debe declarar payload.example; sin evento de ejemplo no hay punto de partida para el escenario de cuarentena (AC-TRX-03)`,
      );
      return {
        topic: e.topic,
        eventPath: found.relPath,
        schemaPath: found.def.payload_schema,
        example: found.def.payload.example,
      };
    });
}

/** El canal de cuarentena debe ser el mismo en la constante, en la definición del evento y en el componente. */
function assertQuarantineTopicIsContractual() {
  assert.equal(
    readJson(DEAD_LETTER_EVENT).topic,
    DEAD_LETTER_TOPIC,
    `${DEAD_LETTER_EVENT}: el topic del canal de cuarentena debe seguir siendo ${DEAD_LETTER_TOPIC}; si el contrato cambia de canal, el enrutado de los eventos rechazados deja de apuntar a donde escucha ADMIN (REQ-069)`,
  );
  assert.equal(
    readJson(LEDGER_COMPONENT).channel,
    DEAD_LETTER_TOPIC,
    `${LEDGER_COMPONENT}: el channel de ARC-035 debe ser ${DEAD_LETTER_TOPIC}; componente y evento deben apuntar al mismo canal de cuarentena (AC-TRX-03)`,
  );
}

test('REQ-069 / AC-TRX-03: un evento sin user_id no valida contra el canal principal y se enruta a la cuarentena con MISSING_USER_ID', () => {
  assertQuarantineTopicIsContractual();

  const channels = discoverMainChannels();
  assert.equal(
    channels.length,
    3,
    `${LEDGER_COMPONENT}: ARC-035 debe consumir exactamente 3 canales principales (PaymentAuthorized, PaymentFailed, PaymentProcessed); con la lista vacía o incompleta este test pasaría en falso sin ejercitar el enrutado a cuarentena (REQ-069)`,
  );

  const deadLetterType = avsc.Type.forSchema(readJson(DEAD_LETTER_SCHEMA));

  for (const channel of channels) {
    const mainType = avsc.Type.forSchema(readJson(channel.schemaPath));
    const roto = { ...channel.example };
    delete roto.user_id;

    assert.equal(
      mainType.isValid(roto),
      false,
      `${channel.schemaPath}: un evento de ${channel.topic} sin user_id NO debe validar contra el esquema del canal principal; si validara entraría en transaction_ledger sin titular (REQ-069)`,
    );
    assert.throws(
      () => mainType.toBuffer(roto),
      `${channel.schemaPath}: serializar un evento de ${channel.topic} sin user_id debe fallar; un asiento sin titular no puede viajar por el canal principal (AC-TRX-03)`,
    );

    const routed = routeToQuarantine(channel.schemaPath, roto, channel.topic);

    assert.equal(
      routed.topic,
      DEAD_LETTER_TOPIC,
      `${channel.topic}: un evento sin user_id debe enrutarse al canal de cuarentena ${DEAD_LETTER_TOPIC}, no al ledger (AC-TRX-03)`,
    );
    assert.equal(
      routed.quarantined,
      true,
      `${channel.topic}: un evento sin user_id debe quedar marcado como puesto en cuarentena (REQ-069)`,
    );
    assert.equal(
      routed.record.reject_reason,
      'MISSING_USER_ID',
      `${channel.topic}: el motivo de rechazo de un evento sin user_id debe ser MISSING_USER_ID (REQ-069)`,
    );
    assert.equal(
      routed.record.alert_target,
      'ADMIN',
      `${channel.topic}: todo asiento de cuarentena debe alertar a ADMIN (AC-TRX-03)`,
    );
    assert.equal(
      routed.record.original_topic,
      channel.topic,
      `${channel.topic}: el asiento de cuarentena debe conservar el canal de procedencia del evento rechazado (REQ-069)`,
    );
    assert.equal(
      routed.record.event_id,
      channel.example.event_id,
      `${channel.topic}: el asiento de cuarentena debe heredar el event_id del evento original (clave de idempotencia, REQ-069)`,
    );
    assert.equal(
      routed.record.correlation_id,
      channel.example.correlation_id,
      `${channel.topic}: el asiento de cuarentena debe heredar el correlation_id del evento original para poder trazar el rechazo (REQ-069)`,
    );
    assert.deepEqual(
      JSON.parse(routed.record.raw_payload),
      roto,
      `${channel.topic}: raw_payload debe conservar el payload original rechazado; sin él el evento se habría perdido (REQ-069)`,
    );

    assert.equal(
      deadLetterType.isValid(routed.record),
      true,
      `${DEAD_LETTER_SCHEMA}: el asiento de cuarentena generado desde ${channel.topic} debe validar contra el esquema del canal de cuarentena; si no valida, el evento rechazado se pierde (AC-TRX-03)`,
    );
    const decoded = deadLetterType.fromBuffer(deadLetterType.toBuffer(routed.record));
    for (const field of Object.keys(routed.record)) {
      assert.deepEqual(
        decoded[field],
        routed.record[field],
        `${DEAD_LETTER_SCHEMA}: el campo ${field} del asiento de cuarentena generado desde ${channel.topic} no sobrevive al round-trip Avro; un asiento que pierde datos al serializar equivale a perder el evento rechazado (REQ-069)`,
      );
    }
  }
});

/**
 * Nombres de campo prohibidos por RN-03 en cualquier contrato de evento del repo (misma regex que
 * tests/event-validation.test.js y tests/schema-validation.test.js): PAN, CVV/CVC, tokens, IBAN.
 */
const FORBIDDEN =
  /^(pan|card_?number|full_pan|card_pan|cvv2?|cvc2?|security_code|token|card_token|access_token|refresh_token|auth_token|api_?key|iban|full_iban|bank_account_number|account_number)$/i;

/** Nombres de campo que el contrato de cuarentena debe declarar explícitamente como prohibidos. */
const MUST_BE_FORBIDDEN = [
  'pan',
  'cvv',
  'cvc',
  'card_number',
  'token',
  'card_token',
  'access_token',
  'iban',
];

/** Devuelve todas las claves de objeto declaradas en una estructura JSON, recursivamente. */
function collectObjectKeys(node, acc = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectObjectKeys(item, acc);
    return acc;
  }
  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      acc.push(key);
      collectObjectKeys(value, acc);
    }
  }
  return acc;
}

/** Devuelve la restricción declarada para un campo en payload.field_constraints, o undefined. */
function fieldConstraintOf(def, field) {
  return (def.payload.field_constraints || []).find((c) => c.field === field);
}

test('RN-03 / REQ-069: ningún campo del contrato de cuarentena admite PAN, CVV ni tokens', () => {
  const schema = readJson(DEAD_LETTER_SCHEMA);
  const def = readJson(DEAD_LETTER_EVENT);
  const component = readJson(LEDGER_COMPONENT);

  const schemaFieldNames = (schema.fields || []).map((f) => f.name);
  assert.ok(
    schemaFieldNames.length > 0,
    `${DEAD_LETTER_SCHEMA}: el esquema de cuarentena no declara campos; sin campos este test pasaría en falso sin comprobar nada (RN-03)`,
  );
  for (const name of schemaFieldNames) {
    assert.equal(
      FORBIDDEN.test(name),
      false,
      `${DEAD_LETTER_SCHEMA}: el campo "${name}" es un dato de tarjeta/token prohibido por RN-03; el asiento de cuarentena no puede transportar PAN, CVV ni tokens`,
    );
  }

  const declaredPayloadFields = [
    ...(def.payload.required_fields || []),
    ...(def.payload.optional_fields || []),
  ];
  assert.ok(
    declaredPayloadFields.length > 0,
    `${DEAD_LETTER_EVENT}: payload.required_fields no puede estar vacío; sin campos declarados este test pasaría en falso (RN-03)`,
  );
  for (const name of declaredPayloadFields) {
    assert.equal(
      FORBIDDEN.test(name),
      false,
      `${DEAD_LETTER_EVENT}: el campo "${name}" declarado en el payload es un dato de tarjeta/token prohibido por RN-03`,
    );
  }

  const componentNames = [
    ...(component.events || []).map((e) => e.name),
    ...collectObjectKeys(component),
  ];
  for (const name of componentNames) {
    assert.equal(
      FORBIDDEN.test(name),
      false,
      `${LEDGER_COMPONENT}: el nombre "${name}" declarado por ARC-035 es un dato de tarjeta/token prohibido por RN-03`,
    );
  }

  const forbiddenNames = (component.payload_constraints || {}).forbidden_field_names;
  assert.ok(
    Array.isArray(forbiddenNames),
    `${LEDGER_COMPONENT}: ARC-035 debe declarar payload_constraints.forbidden_field_names; sin lista explícita nada impide que un futuro campo del payload saneado traiga PAN o token (RN-03)`,
  );
  for (const name of MUST_BE_FORBIDDEN) {
    assert.ok(
      forbiddenNames.includes(name),
      `${LEDGER_COMPONENT}: payload_constraints.forbidden_field_names debe incluir "${name}"; es un dato de tarjeta/token que RN-03 prohíbe en el payload de cuarentena`,
    );
  }

  const rawPayloadConstraint = fieldConstraintOf(def, 'raw_payload');
  assert.ok(
    rawPayloadConstraint && typeof rawPayloadConstraint.pattern === 'string',
    `${DEAD_LETTER_EVENT}: raw_payload debe declarar un pattern en payload.field_constraints; prohibir el NOMBRE del campo no basta, hay que rechazar el DATO (un PAN) dentro del payload saneado (RN-03)`,
  );

  const sanitized = new RegExp(rawPayloadConstraint.pattern);

  assert.equal(
    sanitized.test('{"card_number":"4111111111111111"}'),
    false,
    `${DEAD_LETTER_EVENT}: el pattern declarado para raw_payload debe RECHAZAR un payload con un PAN de 16 dígitos; si lo acepta, el canal de cuarentena publicaría tarjetas en claro (RN-03)`,
  );
  assert.equal(
    sanitized.test('{"numero":"1234567890123"}'),
    false,
    `${DEAD_LETTER_EVENT}: el pattern declarado para raw_payload debe RECHAZAR una secuencia de 13 dígitos (el PAN más corto); el límite inferior de la regla RN-03 es 13 dígitos`,
  );
  assert.equal(
    sanitized.test(def.payload.example.raw_payload),
    true,
    `${DEAD_LETTER_EVENT}: el pattern declarado para raw_payload debe ACEPTAR el payload saneado del ejemplo real; si lo rechaza, ningún evento podría ponerse en cuarentena y se perderían (REQ-069)`,
  );
});

test('REQ-069 / AC-TRX-03: un evento sin importe no valida contra el canal principal y se enruta a la cuarentena con MISSING_AMOUNT', () => {
  assertQuarantineTopicIsContractual();

  const channels = discoverMainChannels();
  assert.equal(
    channels.length,
    3,
    `${LEDGER_COMPONENT}: ARC-035 debe consumir exactamente 3 canales principales (PaymentAuthorized, PaymentFailed, PaymentProcessed); con la lista vacía o incompleta este test pasaría en falso sin ejercitar el enrutado a cuarentena (REQ-069)`,
  );

  const deadLetterType = avsc.Type.forSchema(readJson(DEAD_LETTER_SCHEMA));
  const channelsWithAmount = channels.filter((c) => amountFieldOf(c.schemaPath) !== null);

  assert.ok(
    channelsWithAmount.length > 0,
    `ninguno de los canales que consume ARC-035 declara campo de importe (${AMOUNT_FIELD_NAMES.join(' / ')}); el escenario MISSING_AMOUNT de AC-TRX-03 quedaría sin ejercitar`,
  );

  for (const channel of channels) {
    const amountField = amountFieldOf(channel.schemaPath);

    if (amountField === null) {
      assert.equal(
        channel.topic,
        'pagos.cobros.fallido.v1',
        `${channel.schemaPath}: el canal ${channel.topic} no declara campo de importe (${AMOUNT_FIELD_NAMES.join(' / ')}); solo el canal de cobro fallido puede carecer de importe, cualquier otro canal económico sin importe dejaría el escenario MISSING_AMOUNT sin cubrir (REQ-069)`,
      );
      continue;
    }

    const mainType = avsc.Type.forSchema(readJson(channel.schemaPath));
    const roto = { ...channel.example };
    delete roto[amountField];

    assert.equal(
      mainType.isValid(roto),
      false,
      `${channel.schemaPath}: un evento de ${channel.topic} sin ${amountField} NO debe validar contra el esquema del canal principal; si validara entraría en transaction_ledger sin importe (REQ-069)`,
    );
    assert.throws(
      () => mainType.toBuffer(roto),
      `${channel.schemaPath}: serializar un evento de ${channel.topic} sin ${amountField} debe fallar; un asiento sin importe no puede viajar por el canal principal (AC-TRX-03)`,
    );

    const routed = routeToQuarantine(channel.schemaPath, roto, channel.topic);

    assert.equal(
      routed.topic,
      DEAD_LETTER_TOPIC,
      `${channel.topic}: un evento sin ${amountField} debe enrutarse al canal de cuarentena ${DEAD_LETTER_TOPIC}, no al ledger (AC-TRX-03)`,
    );
    assert.equal(
      routed.quarantined,
      true,
      `${channel.topic}: un evento sin ${amountField} debe quedar marcado como puesto en cuarentena (REQ-069)`,
    );
    assert.equal(
      routed.record.reject_reason,
      'MISSING_AMOUNT',
      `${channel.topic}: el motivo de rechazo de un evento sin ${amountField} debe ser MISSING_AMOUNT (REQ-069)`,
    );
    assert.equal(
      routed.record.alert_target,
      'ADMIN',
      `${channel.topic}: todo asiento de cuarentena debe alertar a ADMIN (AC-TRX-03)`,
    );
    assert.equal(
      routed.record.original_topic,
      channel.topic,
      `${channel.topic}: el asiento de cuarentena debe conservar el canal de procedencia del evento rechazado (REQ-069)`,
    );
    assert.deepEqual(
      JSON.parse(routed.record.raw_payload),
      roto,
      `${channel.topic}: raw_payload debe conservar el payload original rechazado; sin él el evento se habría perdido (REQ-069)`,
    );

    assert.equal(
      deadLetterType.isValid(routed.record),
      true,
      `${DEAD_LETTER_SCHEMA}: el asiento de cuarentena generado desde ${channel.topic} debe validar contra el esquema del canal de cuarentena; si no valida, el evento rechazado se pierde (AC-TRX-03)`,
    );
    const decoded = deadLetterType.fromBuffer(deadLetterType.toBuffer(routed.record));
    for (const field of Object.keys(routed.record)) {
      assert.deepEqual(
        decoded[field],
        routed.record[field],
        `${DEAD_LETTER_SCHEMA}: el campo ${field} del asiento de cuarentena generado desde ${channel.topic} no sobrevive al round-trip Avro; un asiento que pierde datos al serializar equivale a perder el evento rechazado (REQ-069)`,
      );
    }
  }
});

/** UNIQUE compuesto de transaction_ledger (T.5): el orden importa, es el mismo índice. */
const LEDGER_KEY_FIELDS = ['payment_method', 'provider_transaction_id', 'transaction_type'];

/** Asiento de ejemplo proyectado en transaction_ledger desde pagos.cobros.autorizado.v1. */
const LEDGER_ENTRY = {
  payment_method: 'CARD',
  provider_transaction_id: 'ch_3Q1aXy2eZvKYlo2C0abcdEfg',
  transaction_type: 'PAYMENT',
  status: 'AUTHORIZED',
};

/** Construye la clave de idempotencia de un asiento uniendo los key_fields que declara el contrato. */
function ledgerKey(entry, keyFields) {
  return keyFields.map((field) => entry[field]).join('|');
}

/** Proyecta un asiento en el ledger aplicando la política on_conflict declarada por el contrato. */
function projectEntry(ledger, entry, keyFields, onConflict) {
  const key = ledgerKey(entry, keyFields);
  if (!ledger.has(key)) {
    ledger.set(key, { ...entry });
    return;
  }
  if (onConflict === 'update') {
    ledger.set(key, { ...ledger.get(key), ...entry });
  }
}

test('AC-TRX-01: tres reentregas del mismo evento producen un único asiento en transaction_ledger', () => {
  const component = readJson(LEDGER_COMPONENT);
  const idempotency = component.idempotency || {};

  assert.equal(
    idempotency.table,
    'transaction_ledger',
    `${LEDGER_COMPONENT}: idempotency.table debe ser transaction_ledger; es la tabla donde ARC-035 proyecta cada operación económica (AC-TRX-01)`,
  );
  assert.deepEqual(
    idempotency.key_fields,
    LEDGER_KEY_FIELDS,
    `${LEDGER_COMPONENT}: idempotency.key_fields debe ser exactamente ${JSON.stringify(LEDGER_KEY_FIELDS)}, el mismo UNIQUE compuesto de transaction_ledger (T.5); con otra clave una reentrega duplicaría el asiento (AC-TRX-01)`,
  );
  assert.equal(
    idempotency.on_conflict,
    'update',
    `${LEDGER_COMPONENT}: idempotency.on_conflict debe ser "update"; una reentrega del mismo evento actualiza el asiento existente, nunca inserta uno nuevo (AC-TRX-01)`,
  );

  const ledger = new Map();

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    projectEntry(ledger, LEDGER_ENTRY, idempotency.key_fields, idempotency.on_conflict);
    assert.equal(
      ledger.size,
      1,
      `transaction_ledger: tras la reentrega nº ${attempt} del MISMO evento debe seguir habiendo UN solo asiento; dos asientos para un mismo cobro descuadran la contabilidad (AC-TRX-01)`,
    );
  }

  const stored = ledger.get(ledgerKey(LEDGER_ENTRY, idempotency.key_fields));
  assert.equal(
    stored.status,
    'AUTHORIZED',
    `transaction_ledger: tras tres reentregas el asiento debe conservar status AUTHORIZED; on_conflict "update" actualiza el asiento, no lo corrompe (AC-TRX-01)`,
  );

  const refund = { ...LEDGER_ENTRY, transaction_type: 'REFUND' };
  assert.notEqual(
    ledgerKey(refund, idempotency.key_fields),
    ledgerKey(LEDGER_ENTRY, idempotency.key_fields),
    `transaction_ledger: dos asientos que difieren solo en transaction_type deben tener claves distintas; si la clave fuera solo provider_transaction_id, la devolución pisaría el cobro (AC-TRX-01)`,
  );

  projectEntry(ledger, refund, idempotency.key_fields, idempotency.on_conflict);
  assert.equal(
    ledger.size,
    2,
    `transaction_ledger: una devolución con el mismo provider_transaction_id debe crear su propio asiento (la clave es compuesta de verdad); con un solo asiento la devolución habría sobrescrito el cobro (AC-TRX-01)`,
  );
});

/** Política de reintentos contractual del consumidor del ledger (AC-TRX-03): 1s, 2s, 4s. */
const BACKOFF_INTERVALS = [1, 2, 4];

test('AC-TRX-03: la política de escritura del ledger reintenta con backoff 1s/2s/4s', () => {
  const component = readJson(LEDGER_COMPONENT);
  const delivery = component.delivery || {};

  assert.ok(
    delivery.backoff,
    `${LEDGER_COMPONENT}: ARC-035 debe declarar delivery.backoff; sin política de reintentos un fallo transitorio de escritura perdería la operación económica (AC-TRX-03)`,
  );
  assert.deepEqual(
    delivery.backoff.intervals_seconds,
    BACKOFF_INTERVALS,
    `${LEDGER_COMPONENT}: delivery.backoff.intervals_seconds debe ser exactamente ${JSON.stringify(BACKOFF_INTERVALS)} (1s/2s/4s); otra escalera incumple la política de escritura de AC-TRX-03`,
  );
  assert.equal(
    delivery.backoff.strategy,
    'exponential',
    `${LEDGER_COMPONENT}: delivery.backoff.strategy debe ser "exponential"; 1s/2s/4s es una escalera exponencial (AC-TRX-03)`,
  );
  assert.equal(
    delivery.retries,
    3,
    `${LEDGER_COMPONENT}: delivery.retries debe ser 3, uno por cada intervalo declarado (1s/2s/4s); con otro número la política queda incoherente (AC-TRX-03)`,
  );
  assert.equal(
    delivery.retries,
    BACKOFF_INTERVALS.length,
    `${LEDGER_COMPONENT}: delivery.retries (${delivery.retries}) debe coincidir con el número de intervalos declarados (${BACKOFF_INTERVALS.length}); sobran o faltan reintentos (AC-TRX-03)`,
  );
  assert.ok(
    typeof delivery.timeout_s === 'number' && delivery.timeout_s > 0,
    `${LEDGER_COMPONENT}: delivery.timeout_s debe ser un número mayor que 0; sin timeout una escritura colgada bloquearía el consumidor indefinidamente (AC-TRX-03)`,
  );

  const def = readJson(DEAD_LETTER_EVENT);
  assert.ok(
    def.delivery && def.delivery.backoff,
    `${DEAD_LETTER_EVENT}: el evento de cuarentena debe declarar delivery.backoff; la publicación en cuarentena sigue la misma política de reintentos que la escritura (AC-TRX-03)`,
  );
  assert.deepEqual(
    def.delivery.backoff.intervals_seconds,
    BACKOFF_INTERVALS,
    `${DEAD_LETTER_EVENT}: delivery.backoff.intervals_seconds del canal de cuarentena debe ser ${JSON.stringify(BACKOFF_INTERVALS)}, la misma política que ${LEDGER_COMPONENT}; dos escaleras distintas dejan el reintento sin contrato único (AC-TRX-03)`,
  );
  assert.equal(
    def.delivery.backoff.strategy,
    delivery.backoff.strategy,
    `${DEAD_LETTER_EVENT}: la estrategia de backoff del canal de cuarentena debe ser la misma que la del componente ARC-035 (AC-TRX-03)`,
  );
  assert.equal(
    def.delivery.retries,
    delivery.retries,
    `${DEAD_LETTER_EVENT}: los reintentos del canal de cuarentena deben coincidir con los de ARC-035 (AC-TRX-03)`,
  );
  assert.ok(
    typeof def.delivery.timeout_s === 'number' && def.delivery.timeout_s > 0,
    `${DEAD_LETTER_EVENT}: delivery.timeout_s del canal de cuarentena debe ser un número mayor que 0 (AC-TRX-03)`,
  );
});

/** Canales económicos que ARC-035 consume sin redeclarar su esquema (definidos en TSK-02). */
const SUBSCRIBED_EVENT_CODES = ['EVT-003', 'EVT-004', 'EVT-005'];

/** Claves con las que un componente estaría redeclarando el esquema de un canal ajeno. */
const SCHEMA_REDECLARATION_KEYS = ['payload_schema', 'schema', 'payload', 'fields'];

test('AC-TRX-03: el evento permanece en event_outbox hasta la entrega, con escalado a ADMIN', () => {
  const component = readJson(LEDGER_COMPONENT);
  const events = component.events || [];

  assert.ok(
    events.length > 0,
    `${LEDGER_COMPONENT}: ARC-035 debe declarar eventos; con events[] vacío este test pasaría en falso sin comprobar el outbox (AC-TRX-03)`,
  );

  for (const event of events) {
    const outbox = event.outbox || {};
    assert.equal(
      outbox.table,
      'event_outbox',
      `${LEDGER_COMPONENT}: el evento ${event.event_code} (${event.topic}) debe declarar outbox.table "event_outbox"; sin outbox el evento se perdería si el broker no está disponible (AC-TRX-03)`,
    );
    assert.equal(
      outbox.persist_until_delivered,
      true,
      `${LEDGER_COMPONENT}: el evento ${event.event_code} debe declarar outbox.persist_until_delivered true; el evento permanece en event_outbox HASTA la entrega (AC-TRX-03)`,
    );
    assert.equal(
      outbox.escalation_target,
      'ADMIN',
      `${LEDGER_COMPONENT}: el evento ${event.event_code} debe escalar a ADMIN al agotar los intentos; sin escalado nadie se entera de que el evento no se entregó (AC-TRX-03)`,
    );
    assert.ok(
      typeof outbox.max_attempts === 'number' && outbox.max_attempts > 0 && outbox.max_attempts <= 10,
      `${LEDGER_COMPONENT}: el evento ${event.event_code} debe declarar outbox.max_attempts entre 1 y 10 (declara ${outbox.max_attempts}); más intentos retrasarían indefinidamente el escalado a ADMIN (AC-TRX-03)`,
    );
    assert.ok(
      typeof outbox.attempt_interval_seconds === 'number' && outbox.attempt_interval_seconds > 0,
      `${LEDGER_COMPONENT}: el evento ${event.event_code} debe declarar outbox.attempt_interval_seconds mayor que 0; con intervalo 0 el reintento sería un bucle cerrado (AC-TRX-03)`,
    );
  }

  const subscribed = events.filter((e) => e.operation === 'subscribe');
  assert.deepEqual(
    subscribed.map((e) => e.event_code).sort(),
    [...SUBSCRIBED_EVENT_CODES].sort(),
    `${LEDGER_COMPONENT}: ARC-035 debe consumir exactamente los canales ${SUBSCRIBED_EVENT_CODES.join(', ')} (PaymentAuthorized, PaymentFailed, PaymentProcessed); con otra lista quedarían operaciones económicas sin proyectar en el ledger (REQ-069)`,
  );

  const definitions = fs
    .readdirSync(path.join(ROOT, 'sources/events'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({ relPath: `sources/events/${name}`, def: readJson(`sources/events/${name}`) }));

  for (const event of subscribed) {
    for (const key of SCHEMA_REDECLARATION_KEYS) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(event, key),
        false,
        `${LEDGER_COMPONENT}: el canal consumido ${event.event_code} no puede declarar "${key}"; su esquema es el de TSK-02 en sources/events/ y redeclararlo crearía un segundo contrato divergente (REQ-069)`,
      );
    }

    const owner = definitions.find((d) => d.def.event_code === event.event_code);
    assert.ok(
      owner,
      `sources/events/: ningún fichero declara el evento ${event.event_code} que ARC-035 consume; sin la definición de TSK-02 el consumidor escucha un canal sin contrato (REQ-069)`,
    );
    assert.equal(
      owner.def.topic,
      event.topic,
      `${LEDGER_COMPONENT}: el topic declarado para ${event.event_code} (${event.topic}) no coincide con el de ${owner.relPath} (${owner.def.topic}); ARC-035 escucharía un canal distinto al contratado (REQ-069)`,
    );
    assert.ok(
      fs.existsSync(path.join(ROOT, owner.def.payload_schema)),
      `${owner.relPath}: el esquema ${owner.def.payload_schema} del canal ${event.topic} debe existir en disco; sin .avsc no hay contra qué validar el evento entrante (REQ-069)`,
    );
    assert.doesNotThrow(
      () => avsc.Type.forSchema(readJson(owner.def.payload_schema)),
      `${owner.def.payload_schema}: el esquema del canal ${event.topic} debe ser un Avro válido (REQ-069)`,
    );
  }
});
