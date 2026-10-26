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

/** Componente consumidor de los resultados de cobro de MOD-003 (ARC-031). */
const CONSUMER_DEF = 'sources/components/mod002_billing_payment_results_consumer.json';

/** Definición funcional del evento PaymentAuthorized (EVT-003). */
const PAYMENT_AUTHORIZED_DEF = 'sources/events/payment_authorized.json';

/** Esquema Avro del payload de PaymentAuthorized (EVT-003). */
const PAYMENT_AUTHORIZED_AVSC = 'sources/schemas/payment_authorized.avsc';

/** Código del evento PaymentAuthorized dentro de la lista de suscripciones del consumidor. */
const EVT_AUTHORIZED = 'EVT-003';

/**
 * Devuelve el JSON del componente consumidor bajo prueba (ARC-031).
 * Se relee en cada llamada para que ningún test pueda contaminar a otro mutando el objeto.
 */
function consumer() {
  return readJson(CONSUMER_DEF);
}

/**
 * Resuelve la clave de idempotencia DECLARADA por el consumidor sobre un payload concreto.
 *
 * Para cada campo canónico de `idempotency_key` (p. ej. "payment_transaction_id", el nombre
 * de la columna invoices.payment_transaction_id de T.5) busca su nombre FÍSICO en el
 * `field_mapping` del evento y toma el valor de ese campo en el payload entregado.
 *
 * @param {object} componentEvent entrada de `consumer().events` del evento entregado.
 * @param {object} payload entrega real recibida por el consumidor.
 * @returns {string} clave estable y determinista con forma `campo_canonico=valor` unidos por `|`.
 * @throws {Error} si algún campo canónico no está mapeado o no viene en el payload: una clave
 *   de idempotencia que no se puede resolver no sirve como clave y no deduplica nada.
 */
function resolveIdempotencyKey(componentEvent, payload) {
  const canonicalFields = consumer().idempotency_key;
  const mapping = (componentEvent && componentEvent.field_mapping) || {};

  return canonicalFields
    .map((canonical) => {
      const physical = mapping[canonical];
      if (!physical) {
        throw new Error(
          `${CONSUMER_DEF}: el evento ${componentEvent && componentEvent.event_code} no mapea el campo canónico de idempotencia "${canonical}"; sin nombre físico la clave de RN REQ-118 no se puede resolver sobre la entrega`,
        );
      }
      if (!Object.prototype.hasOwnProperty.call(payload, physical) || payload[physical] === null || payload[physical] === undefined) {
        throw new Error(
          `la entrega no trae valor para el campo físico "${physical}" (canónico "${canonical}"); una clave de idempotencia no resoluble no vale como clave (RN REQ-118)`,
        );
      }
      return `${canonical}=${payload[physical]}`;
    })
    .join('|');
}

/**
 * Entrega real de PaymentAuthorized: el `payload.example` publicado en la definición del evento.
 * Devuelve una COPIA NUEVA en cada llamada para que los tests que la mutan
 * (nuevo event_id, nuevo timestamp, otra transacción) no se contaminen entre sí.
 */
function authorizedDelivery() {
  return structuredClone(readJson(PAYMENT_AUTHORIZED_DEF).payload.example);
}

/** Esquema Avro del payload de PaymentRecovered (EVT-014), el aviso que entrega esta tarea. */
const PAYMENT_RECOVERED_AVSC = 'sources/schemas/payment_recovered.avsc';

/** Esquema Avro del payload de PaymentFailed (EVT-004). */
const PAYMENT_FAILED_AVSC = 'sources/schemas/payment_failed.avsc';

/** Definición funcional del evento PaymentRecovered (EVT-014). */
const PAYMENT_RECOVERED_DEF = 'sources/events/payment_recovered.json';

/** Código del evento PaymentProcessed dentro de la lista de suscripciones del consumidor. */
const EVT_PROCESSED = 'EVT-005';

/** Código del evento PaymentFailed dentro de la lista de suscripciones del consumidor. */
const EVT_FAILED = 'EVT-004';

/** Código del evento PaymentRecovered dentro de la lista de suscripciones del consumidor. */
const EVT_RECOVERED = 'EVT-014';

/**
 * Resultados de cobro que PUEDEN dejar la factura en PAID: para todos ellos el contrato
 * tiene que transportar un importe comparable con el de la factura (RN REQ-118 / AC-EST-06).
 */
const EVENTOS_QUE_PUEDEN_PAGAR = [EVT_AUTHORIZED, EVT_PROCESSED, EVT_RECOVERED];

/** Los cuatro resultados de cobro a los que está suscrito el consumidor ARC-031. */
const EVENTOS_SUSCRITOS = [EVT_AUTHORIZED, EVT_PROCESSED, EVT_FAILED, EVT_RECOVERED];

/** Devuelve la entrada de `consumer().events` del evento indicado, o `undefined`. */
function componentEventOf(eventCode) {
  return consumer().events.find((e) => e.event_code === eventCode);
}

/**
 * Resuelve la ruta del `.avsc` de un evento a partir de su definición funcional
 * (`sources/events/*.json`), localizada por `event_code`. No se adivina el nombre del fichero:
 * se lee el `payload_schema` que declara el propio evento.
 */
function payloadSchemaPathOf(eventCode) {
  const dir = 'sources/events';
  const files = fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const def = readJson(path.posix.join(dir, file));
    if (def.event_code === eventCode) {
      assert.ok(
        def.payload_schema,
        `${dir}/${file}: el evento ${eventCode} no declara payload_schema; sin esquema el contrato no es verificable`,
      );
      return def.payload_schema;
    }
  }
  throw new Error(`no existe ninguna definición en ${dir} con event_code ${eventCode}`);
}

/** Nombres de los campos del record Avro del payload del evento indicado. */
function avroFieldNamesOf(eventCode) {
  return avsc.Type.forSchema(readJson(payloadSchemaPathOf(eventCode))).fields.map((f) => f.name);
}

/** Definición cruda (JSON tal cual) del campo `fieldName` dentro de un `.avsc`, o `undefined`. */
function rawAvroField(avscPath, fieldName) {
  return readJson(avscPath).fields.find((f) => f.name === fieldName);
}

/** `true` si el tipo Avro declarado es una unión que admite `"null"` (campo nullable). */
function esUnionConNull(type) {
  return Array.isArray(type) && type.some((t) => t === 'null' || (t && t.type === 'null'));
}

/**
 * Resuelve el IMPORTE declarado por el consumidor sobre una entrega concreta: busca el nombre
 * físico mapeado a la clave canónica `amount` y devuelve su valor en el payload.
 *
 * @throws {Error} si el evento no mapea `amount` o la entrega no trae ese campo: un importe
 *   no resoluble hace que AMOUNT_MISMATCH (AC-EST-06) sea indetectable.
 */
function resolveAmount(componentEvent, payload) {
  const physical = componentEvent && componentEvent.field_mapping && componentEvent.field_mapping.amount;
  if (!physical) {
    throw new Error(
      `${CONSUMER_DEF}: el evento ${componentEvent && componentEvent.event_code} no mapea el campo canónico "amount"; sin importe no se puede comparar con el de la factura y AMOUNT_MISMATCH (AC-EST-06) sería indetectable`,
    );
  }
  if (!Object.prototype.hasOwnProperty.call(payload, physical) || payload[physical] === null || payload[physical] === undefined) {
    throw new Error(
      `la entrega no trae valor para el campo físico de importe "${physical}"; sin importe la factura no puede pasar a PAID con comprobación de coincidencia exacta (RN REQ-118)`,
    );
  }
  return payload[physical];
}

/**
 * Entrega real de PaymentRecovered: el `payload.example` publicado en la definición del evento.
 * Copia nueva en cada llamada para no mutar el original ni contaminar otros tests.
 */
function recoveredDelivery() {
  return structuredClone(readJson(PAYMENT_RECOVERED_DEF).payload.example);
}

test(`AC-EST-05: el payload de ejemplo de payment_authorized es válido contra ${PAYMENT_AUTHORIZED_AVSC}`, () => {
  const type = avsc.Type.forSchema(readJson(PAYMENT_AUTHORIZED_AVSC));

  assert.equal(
    type.isValid(authorizedDelivery()),
    true,
    `${PAYMENT_AUTHORIZED_DEF}: el payload.example debe ser una entrega REAL válida contra ${PAYMENT_AUTHORIZED_AVSC}; si no lo fuera, los asserts de idempotencia serían vacuamente verdes sobre un payload inventado`,
  );
});

test('AC-EST-05: el consumidor declara una ÚNICA clave de idempotencia, payment_transaction_id', () => {
  const key = consumer().idempotency_key;

  assert.ok(Array.isArray(key), `${CONSUMER_DEF}: idempotency_key debe ser un array de campos canónicos`);
  assert.equal(
    key.length,
    1,
    `${CONSUMER_DEF}: idempotency_key debe tener exactamente 1 campo; con más de un campo la clave dejaría de ser la declarada por RN REQ-118 ("un mismo payment_transaction_id se aplica como máximo una vez") y dos entregas del mismo cobro podrían aplicarse dos veces`,
  );
  assert.deepEqual(
    key,
    ['payment_transaction_id'],
    `${CONSUMER_DEF}: la clave de idempotencia debe ser el nombre canónico payment_transaction_id (columna invoices.payment_transaction_id de T.5), no un alias físico de un evento concreto`,
  );
});

test('AC-EST-05: la clave de idempotencia declarada se resuelve sobre el payload real de payment_authorized', () => {
  const componentEvent = consumer().events.find((e) => e.event_code === EVT_AUTHORIZED);

  assert.ok(
    componentEvent,
    `${CONSUMER_DEF}: falta la suscripción a ${EVT_AUTHORIZED} (PaymentAuthorized); sin ella AC-EST-05 no tiene consumidor que aplique el resultado de éxito`,
  );

  const physical = componentEvent.field_mapping && componentEvent.field_mapping.payment_transaction_id;

  assert.ok(
    physical,
    `${CONSUMER_DEF}: la suscripción a ${EVT_AUTHORIZED} debe mapear el campo canónico payment_transaction_id a su nombre físico en el payload`,
  );

  const avroFields = avsc.Type.forSchema(readJson(PAYMENT_AUTHORIZED_AVSC)).fields.map((f) => f.name);

  assert.ok(
    avroFields.includes(physical),
    `${CONSUMER_DEF}: el nombre físico mapeado ("${physical}") no existe entre los campos de ${PAYMENT_AUTHORIZED_AVSC} (${avroFields.join(', ')}). Una clave de idempotencia que apunta a un campo inexistente es decorativa y no deduplica nada`,
  );

  const key = resolveIdempotencyKey(componentEvent, authorizedDelivery());

  assert.equal(typeof key, 'string', 'la clave de idempotencia resuelta debe ser una cadena');
  assert.notEqual(
    key.length,
    0,
    `${CONSUMER_DEF}: la clave de idempotencia resuelta sobre la entrega real de ${EVT_AUTHORIZED} no puede ser vacía; una clave vacía colisionaría para todos los cobros`,
  );
});

test('AC-EST-05: la MISMA entrega de payment_authorized recibida dos veces produce la MISMA clave de idempotencia (estable)', () => {
  const componentEvent = consumer().events.find((e) => e.event_code === EVT_AUTHORIZED);
  assert.ok(componentEvent, `${CONSUMER_DEF}: falta la suscripción a ${EVT_AUTHORIZED}`);

  const primeraEntrega = authorizedDelivery();
  const segundaEntrega = authorizedDelivery();

  assert.notEqual(
    primeraEntrega,
    segundaEntrega,
    'las dos entregas deben ser objetos DISTINTOS con el mismo contenido, como lo son dos mensajes duplicados en el topic',
  );

  assert.equal(
    resolveIdempotencyKey(componentEvent, segundaEntrega),
    resolveIdempotencyKey(componentEvent, primeraEntrega),
    `${CONSUMER_DEF}: la misma entrega duplicada debe resolver a la MISMA clave; si no, el segundo mensaje se aplicaría como un cobro nuevo y la factura cambiaría de estado dos veces (AC-EST-05 exige un solo cambio de estado)`,
  );

  // Reenvío del MISMO hecho de negocio con sobre nuevo: cambia event_id y timestamp.
  segundaEntrega.event_id = 'c0ffee00-dead-4bee-8fed-0123456789ab';
  segundaEntrega.timestamp = '2026-10-26T11:47:12.000Z';

  assert.equal(
    resolveIdempotencyKey(componentEvent, segundaEntrega),
    resolveIdempotencyKey(componentEvent, primeraEntrega),
    `${CONSUMER_DEF}: RN REQ-118 deduplica por payment_transaction_id, NO por event_id ni por timestamp. Un reenvío con sobre nuevo es el MISMO hecho de negocio y solo puede aplicarse una vez; si la clave dependiera del event_id, cada reintento del productor provocaría un segundo cambio de estado de la factura`,
  );
});

test('AC-EST-05: dos cobros distintos producen claves de idempotencia DISTINTAS (única)', () => {
  const componentEvent = consumer().events.find((e) => e.event_code === EVT_AUTHORIZED);
  assert.ok(componentEvent, `${CONSUMER_DEF}: falta la suscripción a ${EVT_AUTHORIZED}`);

  const physical = componentEvent.field_mapping.payment_transaction_id;

  const cobroOriginal = authorizedDelivery();
  const otroCobro = authorizedDelivery();
  otroCobro[physical] = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

  assert.notEqual(
    resolveIdempotencyKey(componentEvent, otroCobro),
    resolveIdempotencyKey(componentEvent, cobroOriginal),
    `${CONSUMER_DEF}: dos transacciones distintas deben resolver a claves distintas; si colisionaran en la misma clave, el segundo cobro legítimo se descartaría como duplicado y su factura se quedaría sin pasar a PAID (AC-EST-05)`,
  );
});

test(`AC-EST-06: ${PAYMENT_RECOVERED_AVSC} expone amount como campo obligatorio`, () => {
  const amount = rawAvroField(PAYMENT_RECOVERED_AVSC, 'amount');

  assert.ok(
    amount,
    `${PAYMENT_RECOVERED_AVSC}: falta el campo amount. Sin importe en el aviso RECOVERED no se puede comparar con el de la factura y AMOUNT_MISMATCH (AC-EST-06) sería indetectable`,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(amount, 'default'),
    false,
    `${PAYMENT_RECOVERED_AVSC}: amount no puede declarar "default"; con valor por defecto una entrega sin importe se leería como un importe inventado y la factura pasaría a PAID sin haber comparado nada (AC-EST-06)`,
  );
  assert.equal(
    esUnionConNull(amount.type),
    false,
    `${PAYMENT_RECOVERED_AVSC}: amount no puede ser una unión con "null"; un importe nulo deja la comprobación de coincidencia exacta de RN REQ-118 sin nada que comparar y AMOUNT_MISMATCH sería indetectable`,
  );
});

test('AC-EST-06: todo resultado de cobro que puede dejar la factura en PAID declara un importe resoluble', () => {
  for (const eventCode of EVENTOS_QUE_PUEDEN_PAGAR) {
    const componentEvent = componentEventOf(eventCode);

    assert.ok(
      componentEvent,
      `${CONSUMER_DEF}: falta la suscripción a ${eventCode}; es un resultado de cobro que puede dejar la factura en PAID y sin consumidor no hay quien compruebe el importe (AC-EST-06)`,
    );

    const physical = componentEvent.field_mapping && componentEvent.field_mapping.amount;

    assert.ok(
      physical,
      `${CONSUMER_DEF}: la suscripción a ${eventCode} debe mapear la clave canónica "amount" a su nombre físico; sin importe declarado no se puede exigir coincidencia exacta con el de la factura y AMOUNT_MISMATCH (AC-EST-06) nunca se abriría`,
    );

    const schemaPath = payloadSchemaPathOf(eventCode);
    const avroFields = avroFieldNamesOf(eventCode);

    assert.ok(
      avroFields.includes(physical),
      `${CONSUMER_DEF}: el importe de ${eventCode} se mapea a "${physical}", que NO existe entre los campos de ${schemaPath} (${avroFields.join(', ')}). Un importe que apunta a un campo inexistente haría la comprobación de AMOUNT_MISMATCH inejecutable`,
    );
  }
});

test('AC-EST-06: un cobro por importe distinto se distingue del importe exacto', () => {
  const componentEvent = componentEventOf(EVT_RECOVERED);
  assert.ok(componentEvent, `${CONSUMER_DEF}: falta la suscripción a ${EVT_RECOVERED} (PaymentRecovered)`);

  const importeDeLaFactura = readJson(PAYMENT_RECOVERED_DEF).payload.example.amount;

  const cobroExacto = recoveredDelivery();
  const cobroPorImporteDistinto = recoveredDelivery();
  cobroPorImporteDistinto[componentEvent.field_mapping.amount] = '99.99';

  const resueltoExacto = resolveAmount(componentEvent, cobroExacto);
  const resueltoDistinto = resolveAmount(componentEvent, cobroPorImporteDistinto);

  assert.notEqual(
    resueltoDistinto,
    resueltoExacto,
    `${CONSUMER_DEF}: el importe resuelto de un cobro por importe distinto debe diferir del exacto. Si el contrato no transportase el importe, los dos casos serían indistinguibles y el cobro por importe distinto pasaría a PAID en vez de abrir AMOUNT_MISMATCH (AC-EST-06)`,
  );
  assert.equal(
    resueltoExacto,
    importeDeLaFactura,
    `${CONSUMER_DEF}: el importe resuelto sobre la entrega real debe ser exactamente el del payload.example de ${PAYMENT_RECOVERED_DEF} ("${importeDeLaFactura}"); si no coincidiera, la comparación exacta de RN REQ-118 abriría AMOUNT_MISMATCH sobre cobros legítimos`,
  );
});

test('AC-EST-06: PaymentFailed aporta el codigo de fallo normalizado y NO aporta importe', () => {
  const componentEvent = componentEventOf(EVT_FAILED);

  assert.ok(
    componentEvent,
    `${CONSUMER_DEF}: falta la suscripción a ${EVT_FAILED} (PaymentFailed); sin ella la factura no recibiría su last_failure_code (AC-EST-06)`,
  );

  const physical = componentEvent.field_mapping && componentEvent.field_mapping.failure_code;

  assert.ok(
    physical,
    `${CONSUMER_DEF}: la suscripción a ${EVT_FAILED} debe mapear "failure_code"; AC-EST-06 exige que la factura siga pendiente CON su last_failure_code normalizado`,
  );

  const avroFields = avroFieldNamesOf(EVT_FAILED);

  assert.ok(
    avroFields.includes(physical),
    `${CONSUMER_DEF}: el código de fallo se mapea a "${physical}", que NO existe entre los campos de ${PAYMENT_FAILED_AVSC} (${avroFields.join(', ')}); last_failure_code se quedaría sin origen`,
  );

  const campoAvro = rawAvroField(PAYMENT_FAILED_AVSC, physical);

  assert.ok(campoAvro, `${PAYMENT_FAILED_AVSC}: falta el campo "${physical}"`);
  assert.ok(
    typeof campoAvro.doc === 'string' && campoAvro.doc.includes('cat_payment_error_codes'),
    `${PAYMENT_FAILED_AVSC}: el doc de "${physical}" debe dejar escrito que es un código canónico YA NORMALIZADO contra el catálogo cat_payment_error_codes; si el contrato admitiera el código bruto del proveedor, last_failure_code guardaría valores no normalizados (AC-EST-06). doc actual: ${JSON.stringify(campoAvro.doc)}`,
  );

  assert.equal(
    Object.prototype.hasOwnProperty.call(componentEvent.field_mapping, 'amount'),
    false,
    `${CONSUMER_DEF}: ${EVT_FAILED} NO debe mapear "amount". Un fallo mantiene la factura en PENDING_PAYMENT con su last_failure_code normalizado y nunca la paga, así que no necesita importe; declararlo sugeriría que un cobro fallido puede entrar en la comparación de AMOUNT_MISMATCH`,
  );
});

test('AC-EST-06: todo field_mapping del consumidor resuelve a un campo que existe de verdad en su .avsc', () => {
  const offenders = [];

  for (const eventCode of EVENTOS_SUSCRITOS) {
    const componentEvent = componentEventOf(eventCode);
    assert.ok(componentEvent, `${CONSUMER_DEF}: falta la suscripción a ${eventCode}`);

    const schemaPath = payloadSchemaPathOf(eventCode);
    const avroFields = avroFieldNamesOf(eventCode);

    for (const [canonical, physical] of Object.entries(componentEvent.field_mapping || {})) {
      if (!avroFields.includes(physical)) {
        offenders.push(`${eventCode}.${canonical} -> "${physical}" no existe en ${schemaPath} (campos: ${avroFields.join(', ')})`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `${CONSUMER_DEF}: hay correspondencias que apuntan a campos fantasma. Una correspondencia que apunta a un campo inexistente convierte idempotency_key y correlation_field en declaraciones decorativas: ni deduplican ni emparejan factura`,
  );
});

test('AC-EST-07: el aviso RECOVERED se empareja por el correlation_field declarado', () => {
  const correlationField = consumer().correlation_field;

  assert.equal(
    correlationField,
    'invoice_id',
    `${CONSUMER_DEF}: el consumidor debe declarar correlation_field = "invoice_id"; es el campo con el que localiza la factura sobre la que aplica el resultado de cobro`,
  );

  const componentEvent = componentEventOf(EVT_RECOVERED);
  assert.ok(componentEvent, `${CONSUMER_DEF}: falta la suscripción a ${EVT_RECOVERED} (PaymentRecovered)`);

  const physical = componentEvent.field_mapping && componentEvent.field_mapping[correlationField];

  assert.ok(
    physical,
    `${CONSUMER_DEF}: la suscripción a ${EVT_RECOVERED} debe mapear el correlation_field "${correlationField}"; AC-EST-07 exige localizar la factura UNPAID para dejarla en PAID con paid_late y sin emparejamiento no hay factura que actualizar`,
  );

  const campoAvro = rawAvroField(PAYMENT_RECOVERED_AVSC, physical);

  assert.ok(
    campoAvro,
    `${PAYMENT_RECOVERED_AVSC}: falta el campo "${physical}". Sin invoice_id en el aviso RECOVERED no hay emparejamiento con la factura UNPAID (AC-EST-07)`,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(campoAvro, 'default'),
    false,
    `${PAYMENT_RECOVERED_AVSC}: "${physical}" no puede declarar "default"; un emparejamiento por defecto aplicaría el pago tardío sobre la factura equivocada (AC-EST-07)`,
  );
  assert.equal(
    esUnionConNull(campoAvro.type),
    false,
    `${PAYMENT_RECOVERED_AVSC}: "${physical}" no puede ser una unión con "null"; sin invoice_id obligatorio en el aviso no hay emparejamiento y la factura UNPAID nunca pasaría a PAID con paid_late (AC-EST-07)`,
  );
});
