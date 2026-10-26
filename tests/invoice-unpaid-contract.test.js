'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const avsc = require('avsc');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const ROOT = path.resolve(__dirname, '..');

/** Lee y parsea un JSON del repo a partir de una ruta relativa a ROOT. */
function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
}

/** Campos del sobre canónico (sources/schemas/common/event_envelope.avsc). */
const ENVELOPE_FIELDS = ['event_id', 'event_type', 'timestamp', 'correlation_id'];

/**
 * EXACTAMENTE los seis campos de negocio que AC-EST-09 (REQ-119) fija para
 * InvoiceUnpaid: ni uno más (el payload no admite datos de pago) ni uno menos.
 */
const AC_EST_09_FIELDS = [
  'invoice_id',
  'invoice_number',
  'user_id',
  'amount_cents',
  'due_date',
  'modality_code',
];

/**
 * Valida el contrato AC-EST-09 de una definición de evento InvoiceUnpaid.
 * Es el MISMO validador para el caso positivo (definición real del repo) y
 * para el caso negativo (fixture inválido): devuelve un array de strings con
 * los incumplimientos encontrados; array vacío = contrato cumplido.
 *
 * @param {object} def definición de evento ya parseada
 * @returns {string[]} errores de contrato (vacío si cumple)
 */
function invoiceUnpaidContractErrors(def) {
  const errors = [];

  const declared = [...def.payload.required_fields, ...(def.payload.optional_fields || [])];
  const business = declared.filter((name) => !ENVELOPE_FIELDS.includes(name));

  for (const name of business) {
    if (!AC_EST_09_FIELDS.includes(name)) {
      errors.push(
        `campo extra prohibido en InvoiceUnpaid: ${name} — AC-EST-09 fija exactamente seis campos y el payload no admite datos de pago`,
      );
    }
  }

  for (const name of AC_EST_09_FIELDS) {
    if (!business.includes(name)) {
      errors.push(
        `campo obligatorio ausente en InvoiceUnpaid: ${name} — AC-EST-09 fija exactamente seis campos de negocio`,
      );
    }
  }

  for (const name of ENVELOPE_FIELDS) {
    if (!def.payload.required_fields.includes(name)) {
      errors.push(
        `campo del sobre canónico ausente en payload.required_fields: ${name}`,
      );
    }
  }

  const key = def.idempotency_key;
  const keyOk = Array.isArray(key) && key.length === 1 && key[0] === 'invoice_id';
  if (!keyOk) {
    errors.push(
      `idempotency_key debe ser exactamente ["invoice_id"]: la unicidad de InvoiceUnpaid se declara por invoice_id (RN REQ-119), recibido ${JSON.stringify(key)}`,
    );
  }

  return errors;
}

test('sources/events/invoice_unpaid.json cumple el contrato de AC-EST-09', () => {
  const def = readJson('sources/events/invoice_unpaid.json');
  assert.deepEqual(invoiceUnpaidContractErrors(def), []);
});

test('el payload de invoice_unpaid.avsc declara el sobre canónico y EXACTAMENTE los seis campos de AC-EST-09', () => {
  const type = avsc.Type.forSchema(readJson('sources/schemas/invoice_unpaid.avsc'));
  const fieldNames = type.fields.map((f) => f.name);

  assert.deepEqual(
    fieldNames,
    [...ENVELOPE_FIELDS, ...AC_EST_09_FIELDS],
    `sources/schemas/invoice_unpaid.avsc debe declarar el sobre canónico y los seis campos de AC-EST-09 en ese orden, tiene: ${fieldNames.join(', ')}`,
  );
});

test('InvoiceUnpaid declara su unicidad por invoice_id y un único evento por factura (RN REQ-119)', () => {
  const def = readJson('sources/events/invoice_unpaid.json');
  assert.deepEqual(
    def.idempotency_key,
    ['invoice_id'],
    'la unicidad de InvoiceUnpaid se declara por invoice_id',
  );

  const producer = readJson('sources/components/mod002_billing_producer.json');
  const evt = (producer.events || []).find((e) => e.event_code === 'EVT-010');
  assert.ok(evt, 'ARC-031 debe declarar el evento EVT-010 (InvoiceUnpaid)');
  assert.equal(
    evt.max_events_per_invoice,
    1,
    'por cada factura se publica como máximo UN evento InvoiceUnpaid (RN REQ-119)',
  );
});

test('NEGATIVO: un invoice_unpaid con campos de pago DEBE ser rechazado por el contrato de AC-EST-09', () => {
  const doc = readJson('tests/fixtures/invalid/invoice_unpaid_with_payment_fields.json');
  const errors = invoiceUnpaidContractErrors(doc);

  assert.notDeepEqual(
    errors,
    [],
    'una definición de InvoiceUnpaid con datos de pago en el payload NO puede cumplir el contrato de AC-EST-09',
  );

  assert.ok(
    errors.some((e) => e.includes('payment_transaction_id')),
    `el contrato debe señalar payment_transaction_id como campo de pago prohibido, errores: ${errors.join(' | ')}`,
  );

  assert.ok(
    errors.some((e) => e.includes('last_four_digits')),
    `el contrato debe señalar last_four_digits como campo de pago prohibido, errores: ${errors.join(' | ')}`,
  );
});

test('NEGATIVO: el esquema genérico de definición de evento NO basta para detectar los campos de pago de InvoiceUnpaid', () => {
  // El fixture es ESTRUCTURALMENTE válido: payment_transaction_id y
  // last_four_digits no figuran en la lista PCI/GDPR del esquema genérico, así
  // que .config/schemas/event-definition.schema.json lo acepta sin rechistar.
  // Por eso existe este fichero de test: el contrato específico de AC-EST-09
  // (invoiceUnpaidContractErrors) es la única red que atrapa esos campos.
  const doc = readJson('tests/fixtures/invalid/invoice_unpaid_with_payment_fields.json');

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(readJson('.config/schemas/event-definition.schema.json'));

  assert.equal(
    validate(doc),
    true,
    `el fixture con datos de pago DEBE pasar el esquema genérico de definición de evento: eso demuestra que el esquema genérico no detecta payment_transaction_id ni last_four_digits y que hace falta el contrato específico de AC-EST-09. Errores AJV: ${JSON.stringify(validate.errors)}`,
  );
});
