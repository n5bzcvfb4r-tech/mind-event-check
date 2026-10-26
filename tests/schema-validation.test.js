'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { globSync } = require('glob');
const avsc = require('avsc');

const ROOT = path.resolve(__dirname, '..');

/** Lee un fichero de texto del repo a partir de una ruta relativa a ROOT. */
function readText(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

/** Todos los esquemas Avro versionados del repo (orden estable). */
const AVSC_FILES = globSync('sources/schemas/**/*.avsc', { cwd: ROOT }).sort();

/** Sobre canónico obligatorio de todo evento de dominio. */
const ENVELOPE = 'sources/schemas/common/event_envelope.avsc';

/** Campos del sobre canónico, en su orden y con sus nombres físicos exactos. */
const ENVELOPE_FIELDS = ['event_id', 'event_type', 'timestamp', 'correlation_id'];

/** Nombres de campo prohibidos por PCI/GDPR (PAN, CVV, tokens, IBAN completo). */
const FORBIDDEN =
  /^(pan|card_?number|full_pan|card_pan|cvv2?|cvc2?|security_code|token|card_token|access_token|refresh_token|auth_token|api_?key|iban|full_iban|bank_account_number|account_number)$/i;

/**
 * Compila un .avsc con avsc. A propósito SIN try/catch: si el esquema es
 * inválido el test positivo debe petar en lugar de pasar en silencio.
 */
function parseAvro(relPath) {
  return avsc.Type.forSchema(JSON.parse(readText(relPath)));
}

/** Nombre del tipo Avro de un campo, de forma robusta frente a uniones y tipos complejos. */
function fieldTypeName(field) {
  if (field && field.type && typeof field.type.typeName === 'string') {
    return field.type.typeName;
  }
  return String(field && field.type);
}

test('el glob sources/schemas/**/*.avsc encuentra al menos un esquema Avro', () => {
  assert.ok(AVSC_FILES.length >= 1, 'glob vacío: la validación sería vacuamente verde');
  assert.ok(
    AVSC_FILES.includes(ENVELOPE),
    `el sobre canónico ${ENVELOPE} no está entre los esquemas encontrados: ${AVSC_FILES.join(', ')}`,
  );
});

for (const file of AVSC_FILES) {
  test(`${file} es JSON válido`, () => {
    assert.doesNotThrow(() => JSON.parse(readText(file)), `${file} no es JSON parseable`);
  });

  test(`${file} es un esquema Avro válido`, () => {
    const type = parseAvro(file);

    assert.equal(typeof type.name, 'string', `${file}: el tipo Avro debe tener nombre`);
    assert.ok(type.name.length > 0, `${file}: el nombre del tipo Avro no puede estar vacío`);

    if (type.typeName === 'record') {
      assert.ok(
        Array.isArray(type.fields) && type.fields.length >= 1,
        `${file}: un record debe declarar al menos un campo`,
      );
    }
  });

  test(`${file} no declara campos con PAN, CVV, token ni IBAN completo`, () => {
    const type = parseAvro(file);

    if (type.typeName !== 'record') {
      return;
    }

    const offenders = type.fields.map((f) => f.name).filter((name) => FORBIDDEN.test(name));
    assert.deepEqual(
      offenders,
      [],
      `${file}: nombres prohibidos por PCI/GDPR: ${offenders.join(', ')}`,
    );
  });
}

test('el sobre canónico event_envelope.avsc define los cuatro campos obligatorios con sus nombres físicos', () => {
  const type = parseAvro(ENVELOPE);
  const raw = JSON.parse(readText(ENVELOPE));

  assert.deepEqual(
    type.fields.map((f) => f.name),
    ENVELOPE_FIELDS,
    `${ENVELOPE}: los nombres físicos y su orden son ley del DoD`,
  );

  for (const name of ['event_id', 'correlation_id']) {
    const rawField = raw.fields.find((f) => f.name === name);
    assert.ok(rawField, `${ENVELOPE}: falta el campo ${name}`);
    assert.equal(
      rawField.type && rawField.type.type,
      'string',
      `${ENVELOPE}: ${name} debe ser de tipo string`,
    );
    assert.equal(
      rawField.type && rawField.type.logicalType,
      'uuid',
      `${ENVELOPE}: ${name} debe declarar logicalType uuid`,
    );
    assert.equal(fieldTypeName(type.field(name)), 'string', `${ENVELOPE}: ${name} debe ser string`);
  }

  for (const name of ['event_type', 'timestamp']) {
    const rawField = raw.fields.find((f) => f.name === name);
    assert.ok(rawField, `${ENVELOPE}: falta el campo ${name}`);
    assert.equal(rawField.type, 'string', `${ENVELOPE}: ${name} debe ser de tipo "string"`);
  }

  const timestamp = raw.fields.find((f) => f.name === 'timestamp');
  assert.equal(typeof timestamp.doc, 'string', `${ENVELOPE}: timestamp debe documentar su formato`);
  assert.ok(
    timestamp.doc.includes('ISO-8601'),
    `${ENVELOPE}: el doc de timestamp debe mencionar ISO-8601, dice: ${timestamp.doc}`,
  );

  for (const name of ENVELOPE_FIELDS) {
    const rawField = raw.fields.find((f) => f.name === name);
    assert.equal(
      Object.prototype.hasOwnProperty.call(rawField, 'default'),
      false,
      `${ENVELOPE}: ${name} es obligatorio, no puede declarar default`,
    );
    assert.equal(
      Array.isArray(rawField.type) && rawField.type.includes('null'),
      false,
      `${ENVELOPE}: ${name} es obligatorio, no puede ser una unión con "null"`,
    );
  }
});

test('todo esquema de payload incorpora los cuatro campos del sobre canónico', () => {
  for (const file of AVSC_FILES) {
    if (file === ENVELOPE) {
      continue;
    }

    const type = parseAvro(file);
    if (type.typeName !== 'record') {
      continue;
    }

    const names = type.fields.map((f) => f.name);
    const missing = ENVELOPE_FIELDS.filter((name) => !names.includes(name));
    assert.deepEqual(
      missing,
      [],
      `${file}: faltan campos del sobre canónico: ${missing.join(', ')}`,
    );
  }
});

test('NEGATIVO: un .avsc malformado DEBE fallar la validación', () => {
  const relPath = 'tests/fixtures/invalid/malformed_schema.avsc';

  assert.throws(
    () => JSON.parse(readText(relPath)),
    `${relPath} no es JSON parseable: la validación tiene que romper`,
  );
});

test('NEGATIVO: un record Avro sin fields DEBE fallar la validación', () => {
  const relPath = 'tests/fixtures/invalid/record_without_fields.avsc';

  const raw = JSON.parse(readText(relPath));
  assert.equal(raw.type, 'record', `${relPath}: el fixture debe declararse como record`);

  assert.throws(
    () => avsc.Type.forSchema(raw),
    `${relPath} es JSON válido pero Avro inválido: avsc debe rechazarlo`,
  );
});
