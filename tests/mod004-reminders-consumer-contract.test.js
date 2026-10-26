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
    sub.channel ?? component.channel,
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
