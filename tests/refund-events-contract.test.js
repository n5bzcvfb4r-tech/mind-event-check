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

/** Esquema Avro del payload de RefundCompleted (EVT-012). */
const REFUND_COMPLETED_AVSC = 'sources/schemas/refund_completed.avsc';

/** Definición funcional del evento RefundCompleted (EVT-012). */
const REFUND_COMPLETED_DEF = 'sources/events/refund_completed.json';

/**
 * Payload RefundCompleted completo y válido (13 campos).
 * Devuelve un objeto NUEVO en cada llamada para que los tests que lo mutan
 * (delete de un campo, null) no se contaminen entre sí.
 */
function validRefundCompleted() {
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
  };
}

test(`AC-REE-06: un payload RefundCompleted completo es válido contra ${REFUND_COMPLETED_AVSC}`, () => {
  const type = avsc.Type.forSchema(readJson(REFUND_COMPLETED_AVSC));

  assert.equal(
    type.isValid(validRefundCompleted()),
    true,
    `${REFUND_COMPLETED_AVSC}: el payload de control con los 13 campos debe ser válido; si falla aquí, el rechazo del test negativo no probaría nada`,
  );
});

test('AC-REE-06: un payload RefundCompleted SIN refund_ledger_id es RECHAZADO por el contrato (sin asiento REFUND no hay COMPLETED)', () => {
  const type = avsc.Type.forSchema(readJson(REFUND_COMPLETED_AVSC));

  const payload = validRefundCompleted();
  delete payload.refund_ledger_id;

  assert.equal(
    type.isValid(payload),
    false,
    'refund_ledger_id es obligatorio: sin asiento REFUND en transaction_ledger la orden no puede emitirse como COMPLETED (AC-REE-06)',
  );

  assert.equal(
    type.isValid({ ...validRefundCompleted(), refund_ledger_id: null }),
    false,
    'refund_ledger_id no admite null: un asiento REFUND nulo equivaldría a COMPLETED sin asiento (AC-REE-06)',
  );
});

test(`AC-REE-06: refund_ledger_id se declara obligatorio en el esquema y en ${REFUND_COMPLETED_DEF}`, () => {
  const raw = readJson(REFUND_COMPLETED_AVSC);
  const field = raw.fields.find((f) => f.name === 'refund_ledger_id');

  assert.ok(field, `${REFUND_COMPLETED_AVSC}: falta el campo refund_ledger_id`);
  assert.equal(
    Object.prototype.hasOwnProperty.call(field, 'default'),
    false,
    `${REFUND_COMPLETED_AVSC}: refund_ledger_id es obligatorio, no puede declarar default`,
  );
  assert.equal(
    Array.isArray(field.type) && field.type.includes('null'),
    false,
    `${REFUND_COMPLETED_AVSC}: refund_ledger_id es obligatorio, no puede ser una unión con "null"`,
  );

  const def = readJson(REFUND_COMPLETED_DEF);

  assert.ok(
    def.payload.required_fields.includes('refund_ledger_id'),
    `${REFUND_COMPLETED_DEF}: refund_ledger_id debe estar en payload.required_fields`,
  );
  assert.equal(
    (def.payload.optional_fields || []).includes('refund_ledger_id'),
    false,
    `${REFUND_COMPLETED_DEF}: refund_ledger_id no puede figurar como opcional`,
  );
});

/** Nombres de campo prohibidos por PCI/GDPR (PAN, CVV, tokens, IBAN completo). */
const FORBIDDEN =
  /^(pan|card_?number|full_pan|card_pan|cvv2?|cvc2?|security_code|token|card_token|access_token|refresh_token|auth_token|api_?key|iban|full_iban|bank_account_number|account_number)$/i;

/** Esquemas Avro de los dos contratos de reembolso de TSK-014. */
const REFUND_SCHEMAS = ['sources/schemas/refund_completed.avsc', 'sources/schemas/refund_failed.avsc'];

/** Definiciones funcionales de los dos eventos de reembolso de TSK-014. */
const REFUND_EVENTS = ['sources/events/refund_completed.json', 'sources/events/refund_failed.json'];

test('AC-DEV-10: ningún campo de los esquemas Avro de reembolso admite token, PAN, CVV ni IBAN completo', () => {
  for (const relPath of REFUND_SCHEMAS) {
    const type = avsc.Type.forSchema(readJson(relPath));

    const offenders = type.fields.map((f) => f.name).filter((name) => FORBIDDEN.test(name));
    assert.deepEqual(
      offenders,
      [],
      `${relPath}: campos con nombre prohibido por PCI/GDPR (AC-DEV-10): ${offenders.join(', ')}`,
    );

    for (const field of readJson(relPath).fields) {
      if (field.type && typeof field.type === 'object' && field.type.type === 'enum') {
        const badSymbols = (field.type.symbols || []).filter((symbol) => FORBIDDEN.test(symbol));
        assert.deepEqual(
          badSymbols,
          [],
          `${relPath}: el enum del campo ${field.name} expone símbolos prohibidos por PCI/GDPR (AC-DEV-10): ${badSymbols.join(', ')}`,
        );
      }
    }
  }
});

test('AC-DEV-10: ningún campo declarado en las definiciones de evento de reembolso admite token, PAN, CVV ni IBAN completo', () => {
  for (const relPath of REFUND_EVENTS) {
    const def = readJson(relPath);

    const declared = [...def.payload.required_fields, ...(def.payload.optional_fields || [])];
    const offenders = declared.filter((name) => FORBIDDEN.test(name));

    assert.deepEqual(
      offenders,
      [],
      `${relPath}: campos declarados con nombre prohibido por PCI/GDPR (AC-DEV-10): ${offenders.join(', ')}`,
    );
  }
});

test('AC-DEV-10: el contrato de los eventos de reembolso es CERRADO: los campos declarados coinciden exactamente con los del .avsc', () => {
  for (const relPath of REFUND_EVENTS) {
    const def = readJson(relPath);

    const declared = [...def.payload.required_fields, ...(def.payload.optional_fields || [])]
      .slice()
      .sort();

    const avroFields = avsc.Type.forSchema(readJson(def.payload_schema))
      .fields.map((f) => f.name)
      .slice()
      .sort();

    assert.deepEqual(
      declared,
      avroFields,
      `${relPath}: el contrato debe ser CERRADO frente a ${def.payload_schema}. Cualquier campo presente en el .avsc y no declarado (o declarado y ausente del .avsc) abre la puerta a un payload no auditado, por el que podría viajar token, PAN, CVV o IBAN completo sin pasar por el filtro de nombres de AC-DEV-10.`,
    );
  }
});
